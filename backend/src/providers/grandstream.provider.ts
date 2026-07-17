import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import * as https from 'https';
import { Repository } from 'typeorm';
import { CallDirection, CallingProvider, CallStatus } from '../common/enums';
import { CallLog } from '../calls/call-log.entity';
import { SettingsService } from '../settings/settings.service';
import {
  CallingProviderStrategy,
  InitiateCallInput,
  InitiateCallResult,
} from './provider.interface';

/**
 * Grandstream UCM PBX + Dinstar gateway (UAE).
 *
 * Outbound calls are originated through the UCM HTTPS API: the PBX first
 * rings the user's extension, then dials the destination through the trunk
 * (Dinstar GSM/FXO gateway). The Dinstar itself is registered to the PBX as
 * a trunk, so no direct Dinstar API calls are needed for calling — its
 * connection details are stored in Settings for reference.
 */
@Injectable()
export class GrandstreamProvider implements CallingProviderStrategy {
  readonly key = CallingProvider.GRANDSTREAM;
  private readonly logger = new Logger(GrandstreamProvider.name);

  constructor(
    private readonly settings: SettingsService,
    @InjectRepository(CallLog)
    private readonly callLogsRepo: Repository<CallLog>,
  ) {}

  async initiateCall(input: InitiateCallInput): Promise<InitiateCallResult> {
    const cfg = await this.settings.getProviderSettings('grandstream');
    if (!cfg.host || !cfg.username || !cfg.password) {
      throw new BadRequestException(
        'Grandstream PBX is not configured. Ask an admin to add PBX details in Settings.',
      );
    }
    const extension: string | undefined = input.user.providerConfig?.extension;
    if (!extension) {
      throw new BadRequestException(
        'No PBX extension assigned to this user. An admin can set it in User Management.',
      );
    }

    await this.dialViaUcm(cfg, extension, input.phoneNumber);

    const log = await this.callLogsRepo.save(
      this.callLogsRepo.create({
        userId: input.user.id,
        phoneNumber: input.phoneNumber,
        provider: this.key,
        direction: CallDirection.OUTBOUND,
        status: CallStatus.INITIATED,
        startedAt: new Date(),
        metadata: { extension, source: input.source },
      }),
    );

    return {
      action: 'pbx_originated',
      provider: this.key,
      phoneNumber: input.phoneNumber,
      callLogId: log.id,
      message: `PBX is ringing extension ${extension}; answer to connect to ${input.phoneNumber}.`,
    };
  }

  /**
   * UCM62xx/63xx HTTPS API: challenge -> login (md5(challenge+password)) -> dial.
   * Note: the dial action name can differ per firmware ("dialOutbound" on
   * recent UCM63xx firmware); adjust here if your PBX uses another action.
   */
  private async dialViaUcm(
    cfg: Record<string, any>,
    extension: string,
    phoneNumber: string,
  ): Promise<void> {
    const host = cfg.host as string;
    const port = Number(cfg.port ?? 8089);
    const user = cfg.username as string;

    const challengeResp = await this.ucmRequest(host, port, {
      request: { action: 'challenge', user, version: '1.0' },
    });
    const challenge = challengeResp?.response?.challenge;
    if (!challenge) {
      throw new BadRequestException('PBX challenge failed — check host/username in Settings.');
    }

    const token = createHash('md5').update(challenge + cfg.password).digest('hex');
    const loginResp = await this.ucmRequest(host, port, {
      request: { action: 'login', user, token },
    });
    const cookie = loginResp?.response?.cookie;
    if (!cookie) {
      throw new BadRequestException('PBX login failed — check the API password in Settings.');
    }

    const outbound = (cfg.callerPrefix ?? '') + phoneNumber;
    const dialResp = await this.ucmRequest(host, port, {
      request: {
        action: 'dialOutbound',
        cookie,
        caller: extension,
        outbound,
      },
    });
    if (dialResp?.status !== 0 && dialResp?.response?.need_apply !== undefined) {
      this.logger.warn(`UCM dial returned: ${JSON.stringify(dialResp)}`);
    }
    if (dialResp?.status !== undefined && dialResp.status !== 0) {
      throw new BadRequestException(
        `PBX rejected the call (status ${dialResp.status}). Verify the extension and outbound route.`,
      );
    }
  }

  /** UCM APIs use self-signed certificates, so TLS verification is relaxed for this call only. */
  private ucmRequest(host: string, port: number, body: unknown): Promise<any> {
    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host,
          port,
          path: '/api',
          method: 'POST',
          rejectUnauthorized: false,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          timeout: 10000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ raw: data });
            }
          });
        },
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new BadRequestException('PBX did not respond within 10s.'));
      });
      req.on('error', (err) =>
        reject(new BadRequestException(`Could not reach the PBX: ${err.message}`)),
      );
      req.write(payload);
      req.end();
    });
  }
}
