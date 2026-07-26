import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Socket } from 'net';
import { SettingsService } from '../settings/settings.service';

export type AmiEvent = Record<string, string>;

/**
 * Minimal Asterisk Manager Interface (AMI) client.
 *
 * AMI is a line protocol: `Key: Value\r\n` pairs terminated by a blank line.
 * The backend and Asterisk run on the same VPS, so this connects over
 * localhost and Asterisk only accepts 127.0.0.1 (see manager.conf).
 *
 * Used for two things:
 *  - Originate: click-to-call (ring the recruiter, then dial the candidate)
 *  - Cdr events: write finished calls into call history automatically
 */
@Injectable()
export class AsteriskAmiService implements OnModuleDestroy {
  private readonly logger = new Logger(AsteriskAmiService.name);

  private socket: Socket | null = null;
  private buffer = '';
  private actionId = 0;
  private loggedIn = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connecting: Promise<void> | null = null;

  /** Pending Originate/other actions awaiting their response. */
  private readonly pending = new Map<string, (event: AmiEvent) => void>();
  /** Listeners for asynchronous events (Cdr, etc). */
  private readonly listeners = new Set<(event: AmiEvent) => void>();

  constructor(private readonly settings: SettingsService) {}

  onModuleDestroy(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.destroy();
  }

  onEvent(listener: (event: AmiEvent) => void): void {
    this.listeners.add(listener);
  }

  /**
   * Ring `channel` (the recruiter's SIP endpoint); when they pick up, Asterisk
   * runs the dialplan at context/exten, which dials the candidate. Returns once
   * Asterisk accepts the request — the call itself proceeds asynchronously.
   */
  async originate(params: {
    channel: string;
    context: string;
    exten: string;
    callerId: string;
    timeoutMs?: number;
    variables?: Record<string, string>;
  }): Promise<AmiEvent> {
    const fields: Record<string, string> = {
      Action: 'Originate',
      Channel: params.channel,
      Context: params.context,
      Exten: params.exten,
      Priority: '1',
      CallerID: params.callerId,
      Timeout: String(params.timeoutMs ?? 45000),
      Async: 'true',
    };
    if (params.variables) {
      fields.Variable = Object.entries(params.variables)
        .map(([k, v]) => `${k}=${v}`)
        .join(',');
    }
    return this.send(fields);
  }

  /** Send an action and resolve with its Response event. */
  private async send(fields: Record<string, string>): Promise<AmiEvent> {
    await this.ensureConnected();
    const id = `snappy-${++this.actionId}`;
    const payload =
      Object.entries({ ...fields, ActionID: id })
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n') + '\r\n\r\n';

    return new Promise<AmiEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Asterisk did not respond in time'));
      }, 10000);

      this.pending.set(id, (event) => {
        clearTimeout(timer);
        this.pending.delete(id);
        if (event.Response === 'Error') {
          reject(new Error(event.Message || 'Asterisk rejected the request'));
        } else {
          resolve(event);
        }
      });

      this.socket?.write(payload);
    });
  }

  /** Connect + log in, reusing an in-flight attempt. */
  async ensureConnected(): Promise<void> {
    if (this.loggedIn && this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;

    this.connecting = this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    // Settings (admin UI) win; otherwise fall back to the server environment,
    // which the deploy script fills in — Asterisk runs on this same host, so
    // the credentials never need to travel or be pasted anywhere.
    const cfg = await this.settings.getProviderSettings('asterisk');
    const host: string = cfg.amiHost || process.env.ASTERISK_AMI_HOST || '127.0.0.1';
    const port = Number(cfg.amiPort || process.env.ASTERISK_AMI_PORT || 5038);
    const username: string | undefined = cfg.amiUsername || process.env.ASTERISK_AMI_USERNAME;
    const password: string | undefined = cfg.amiPassword || process.env.ASTERISK_AMI_PASSWORD;
    if (!username || !password) {
      throw new Error(
        'Asterisk AMI is not configured. Set the AMI username/password in Settings → Asterisk.',
      );
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new Socket();
      this.socket = socket;
      this.buffer = '';

      const onError = (err: Error) => {
        socket.destroy();
        reject(err);
      };
      socket.once('error', onError);

      socket.connect(port, host, () => {
        socket.off('error', onError);
        socket.write(
          `Action: Login\r\nUsername: ${username}\r\nSecret: ${password}\r\nEvents: on\r\n\r\n`,
        );
        resolve();
      });

      socket.on('data', (chunk) => this.consume(chunk.toString()));
      socket.on('close', () => {
        this.loggedIn = false;
        this.scheduleReconnect();
      });
      socket.on('error', (err) => {
        this.logger.warn(`AMI socket error: ${err.message}`);
        this.loggedIn = false;
      });
    });

    this.loggedIn = true;
    this.logger.log(`Connected to Asterisk AMI at ${host}:${port}`);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected().catch((err) =>
        this.logger.warn(`AMI reconnect failed: ${err.message}`),
      );
    }, 5000);
  }

  /** Split the stream into blank-line-delimited blocks and dispatch them. */
  private consume(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf('\r\n\r\n')) !== -1) {
      const block = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 4);
      if (!block.trim()) continue;

      const event: AmiEvent = {};
      for (const line of block.split('\r\n')) {
        const sep = line.indexOf(':');
        if (sep > 0) event[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
      }

      const handler = event.ActionID ? this.pending.get(event.ActionID) : undefined;
      if (handler) {
        handler(event);
      } else if (event.Event) {
        for (const listener of this.listeners) {
          try {
            listener(event);
          } catch (err) {
            this.logger.warn(`AMI listener failed: ${(err as Error).message}`);
          }
        }
      }
    }
  }
}
