import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallingProvider, Region, Role, SmsDirection, SmsStatus } from '../common/enums';
import { toUsE164 } from '../common/phone.util';
import { ActivityService } from '../activity/activity.service';
import { ActivityType } from '../activity/activity.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { TelnyxProvider } from '../providers/telnyx.provider';
import { User } from '../users/user.entity';
import { WebhooksService } from '../webhooks/webhooks.service';
import { WebhookEvent } from '../webhooks/webhook.entity';
import { SendSmsDto } from './dto/send-sms.dto';
import { SmsLog } from './sms-log.entity';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    @InjectRepository(SmsLog)
    private readonly smsRepo: Repository<SmsLog>,
    private readonly telnyxProvider: TelnyxProvider,
    private readonly notificationsService: NotificationsService,
    private readonly activityService: ActivityService,
    private readonly webhooksService: WebhooksService,
  ) {}

  async send(user: User, dto: SendSmsDto): Promise<SmsLog> {
    if (!this.canSendSms(user)) {
      throw new BadRequestException(
        'SMS is only available to users with USA calling access. Ask an admin to enable it.',
      );
    }

    const to = toUsE164(dto.to);
    const log = this.smsRepo.create({
      userId: user.id,
      phoneNumber: to,
      direction: SmsDirection.OUTBOUND,
      body: dto.body,
      status: SmsStatus.QUEUED,
    });

    try {
      const { externalId } = await this.telnyxProvider.sendSms(to, dto.body);
      log.externalId = externalId;
      log.status = SmsStatus.SENT;
    } catch (err) {
      log.status = SmsStatus.FAILED;
      log.error = friendlyTelnyxError(err);
      await this.smsRepo.save(log);
      // Re-throw the readable reason, not the raw Telnyx JSON blob.
      throw new BadRequestException(`Could not send to ${to}: ${log.error}`);
    }
    const saved = await this.smsRepo.save(log);
    this.activityService.log(ActivityType.SMS_SENT, `SMS sent to ${to}`, user.id, saved.id).catch(() => {});
    return saved;
  }


  /**
   * Telnyx message webhook: store inbound SMS and reconcile outbound delivery
   * status. Non-message events are ignored (call events are handled elsewhere).
   */
  async handleTelnyxWebhook(event: any): Promise<void> {
    const eventType: string | undefined = event?.data?.event_type;
    const payload = event?.data?.payload;
    if (!eventType?.startsWith('message.') || !payload) return;

    if (eventType === 'message.received') {
      const fromNumber = payload.from?.phone_number ?? 'unknown';
      const sms = await this.smsRepo.save(
        this.smsRepo.create({
          userId: null,
          phoneNumber: fromNumber,
          direction: SmsDirection.INBOUND,
          body: payload.text ?? '',
          status: SmsStatus.RECEIVED,
          externalId: payload.id ?? null,
        }),
      );

      this.activityService.log(ActivityType.SMS_RECEIVED, `SMS received from ${fromNumber}`, null, sms.id).catch(() => {});

      this.webhooksService.dispatch(WebhookEvent.SMS_RECEIVED, {
        smsId: sms.id,
        from: fromNumber,
        body: sms.body,
        receivedAt: sms.createdAt,
      });

      const admins = await this.smsRepo.manager
        .getRepository(User)
        .find({ where: { role: Role.ADMIN } });
      for (const admin of admins) {
        this.notificationsService.create(
          admin.id,
          NotificationType.INBOUND_SMS,
          `New SMS from ${fromNumber}`,
          (payload.text ?? '').slice(0, 100),
          sms.id,
        ).catch((err) => this.logger.warn('Failed to create SMS notification', err));
      }
      return;
    }

    // Outbound lifecycle (message.sent / message.finalized): update by provider id.
    if (!payload.id) return;
    const log = await this.smsRepo.findOne({ where: { externalId: payload.id } });
    if (!log || log.direction !== SmsDirection.OUTBOUND) return;
    const to = Array.isArray(payload.to) ? payload.to[0] : payload.to;
    const status: string | undefined = to?.status ?? payload.status;
    if (status === 'delivered') log.status = SmsStatus.DELIVERED;
    else if (['sending_failed', 'delivery_failed', 'failed'].includes(status ?? '')) {
      log.status = SmsStatus.FAILED;
      const errors = Array.isArray(payload.errors) ? payload.errors : [];
      log.error =
        errors.map((e: any) => e?.detail ?? e?.title).filter(Boolean).join('; ') ||
        `Carrier reported: ${status}`;
    }
    await this.smsRepo.save(log);
  }

  async findAll(user: User, page = 1, limit = 20) {
    const qb = this.smsRepo
      .createQueryBuilder('sms')
      .leftJoinAndSelect('sms.user', 'user')
      .orderBy('sms.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (user.role !== Role.ADMIN) {
      qb.andWhere('sms.userId = :id', { id: user.id });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }

  /**
   * Conversation list for the shared company number: one entry per contact with
   * the most recent message. The number is shared by the team, so inbound
   * replies are visible to everyone with SMS access (like a shared inbox).
   */
  async threads(user: User): Promise<
    Array<{ phoneNumber: string; lastMessage: string; lastAt: Date; direction: SmsDirection; total: number }>
  > {
    this.assertSmsAccess(user);
    const rows = await this.smsRepo
      .createQueryBuilder('sms')
      .select('sms.phoneNumber', 'phoneNumber')
      .addSelect('MAX(sms.createdAt)', 'lastAt')
      .addSelect('COUNT(*)', 'total')
      .groupBy('sms.phoneNumber')
      .orderBy('MAX(sms.createdAt)', 'DESC')
      .limit(200)
      .getRawMany();

    return Promise.all(
      rows.map(async (row) => {
        const last = await this.smsRepo.findOne({
          where: { phoneNumber: row.phoneNumber },
          order: { createdAt: 'DESC' },
        });
        return {
          phoneNumber: row.phoneNumber,
          lastMessage: last?.body ?? '',
          lastAt: new Date(row.lastAt),
          direction: last?.direction ?? SmsDirection.OUTBOUND,
          total: Number(row.total),
        };
      }),
    );
  }

  /** Full message history with one contact, oldest first (chat order). */
  async thread(user: User, phoneNumber: string): Promise<SmsLog[]> {
    this.assertSmsAccess(user);
    return this.smsRepo.find({
      where: { phoneNumber },
      order: { createdAt: 'ASC' },
      take: 500,
    });
  }

  /** SMS runs on the USA (Telnyx) line, so USA access is what grants it. */
  private canSendSms(user: User): boolean {
    if (user.role === Role.ADMIN) return true;
    if (user.regions?.includes(Region.USA)) return true;
    return user.provider === CallingProvider.TELNYX;
  }

  private assertSmsAccess(user: User): void {
    if (!this.canSendSms(user)) {
      throw new BadRequestException(
        'SMS is only available to users with USA calling access. Ask an admin to enable it.',
      );
    }
  }
}

/**
 * Telnyx failures arrive as 'Telnyx SMS failed (4xx): {"errors":[...]}'. Pull
 * out the human-readable detail so the UI can show why a message failed
 * instead of the raw JSON blob.
 */
/** Plain-English guidance for Telnyx error codes recruiters actually hit. */
const TELNYX_ERROR_HINTS: Record<string, string> = {
  '10002':
    'This is not a real, reachable phone number — check the digits (the area code may not exist), or add the country code (e.g. +371...) if it is an international number.',
  '40010': 'US carriers require 10DLC registration for this number — register the brand/campaign in the Telnyx portal.',
  '40011': 'US carriers require 10DLC registration for this number — register the brand/campaign in the Telnyx portal.',
  '40310': 'The phone number is not in a valid format.',
};

function friendlyTelnyxError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const jsonStart = message.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(message.slice(jsonStart));
      const details = (parsed?.errors ?? [])
        .map((e: any) => {
          const base = e?.detail ?? e?.title;
          const hint = TELNYX_ERROR_HINTS[String(e?.code)];
          return hint ? `${base} ${hint}` : base;
        })
        .filter(Boolean)
        .join('; ');
      if (details) return details;
    } catch {
      // fall through to the raw message
    }
  }
  return message.slice(0, 500);
}
