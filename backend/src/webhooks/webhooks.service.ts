import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac } from 'crypto';
import { Repository } from 'typeorm';
import { decryptString, encryptString } from '../common/crypto.util';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';
import { Webhook, WebhookEvent } from './webhook.entity';

const TIMEOUT_MS = 8000;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(Webhook)
    private readonly repo: Repository<Webhook>,
    private readonly config: ConfigService,
  ) {}

  async findAll(): Promise<Array<Omit<Webhook, 'secret'> & { hasSecret: boolean }>> {
    const hooks = await this.repo.find({ order: { createdAt: 'ASC' } });
    return hooks.map(({ secret, ...rest }) => ({ ...rest, hasSecret: Boolean(secret) }));
  }

  async create(dto: CreateWebhookDto): Promise<Webhook> {
    return this.repo.save(
      this.repo.create({
        name: dto.name,
        url: dto.url,
        events: dto.events,
        secret: dto.secret ? this.encrypt(dto.secret) : null,
        active: dto.active ?? true,
      }),
    );
  }

  async update(id: string, dto: UpdateWebhookDto): Promise<Webhook> {
    const hook = await this.get(id);
    if (dto.name !== undefined) hook.name = dto.name;
    if (dto.url !== undefined) hook.url = dto.url;
    if (dto.events !== undefined) hook.events = dto.events;
    if (dto.active !== undefined) hook.active = dto.active;
    // An empty string clears the secret; omitting the field keeps the stored one.
    if (dto.secret !== undefined) {
      hook.secret = dto.secret ? this.encrypt(dto.secret) : null;
    }
    return this.repo.save(hook);
  }

  async remove(id: string): Promise<void> {
    const hook = await this.get(id);
    await this.repo.remove(hook);
  }

  async test(id: string): Promise<{ statusCode: number | null; error: string | null }> {
    const hook = await this.get(id);
    await this.deliver(hook, WebhookEvent.CALL_COMPLETED, {
      test: true,
      message: 'Test delivery from SnappyConnect',
    });
    const refreshed = await this.get(id);
    return { statusCode: refreshed.lastStatusCode, error: refreshed.lastError };
  }

  /**
   * Fan an event out to every active subscriber. Never throws — webhook
   * delivery must not affect the call or message flow that triggered it.
   */
  async dispatch(event: WebhookEvent, payload: Record<string, any>): Promise<void> {
    let hooks: Webhook[];
    try {
      hooks = await this.repo.find({ where: { active: true } });
    } catch (err) {
      this.logger.warn(`Could not load webhooks for ${event}`, err as Error);
      return;
    }
    await Promise.all(
      hooks
        .filter((h) => h.events.includes(event))
        .map((h) => this.deliver(h, event, payload)),
    );
  }

  private async deliver(hook: Webhook, event: WebhookEvent, payload: Record<string, any>): Promise<void> {
    const body = JSON.stringify({ event, firedAt: new Date().toISOString(), data: payload });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'SnappyConnect-Webhook/1',
    };
    if (hook.secret) {
      const signature = createHmac('sha256', this.decrypt(hook.secret)).update(body).digest('hex');
      headers['X-SnappyConnect-Signature'] = `sha256=${signature}`;
    }

    let statusCode: number | null = null;
    let error: string | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      statusCode = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 250) : 'Delivery failed';
    } finally {
      clearTimeout(timer);
    }

    await this.repo
      .update(hook.id, { lastFiredAt: new Date(), lastStatusCode: statusCode, lastError: error })
      .catch(() => undefined);

    if (error) this.logger.warn(`Webhook "${hook.name}" -> ${hook.url}: ${error}`);
  }

  private async get(id: string): Promise<Webhook> {
    const hook = await this.repo.findOne({ where: { id } });
    if (!hook) throw new NotFoundException('Webhook not found');
    return hook;
  }

  private encrypt(value: string): string {
    return encryptString(value, this.secretKey());
  }

  private decrypt(value: string): string {
    return decryptString(value, this.secretKey());
  }

  private secretKey(): string {
    return this.config.get<string>('SETTINGS_ENCRYPTION_KEY', 'dev-insecure-key');
  }
}
