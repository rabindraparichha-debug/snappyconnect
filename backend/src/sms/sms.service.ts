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
import { toE164 } from '../contact-lists/csv.util';
import { WebhooksService } from '../webhooks/webhooks.service';
import { WebhookEvent } from '../webhooks/webhook.entity';
import { DncService } from '../dnc/dnc.service';
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
    private readonly dncService: DncService,
  ) {}

  async send(user: User, dto: SendSmsDto): Promise<SmsLog> {
    if (!this.canSendSms(user)) {
      throw new BadRequestException(
        'SMS is only available to users with USA calling access. Ask an admin to enable it.',
      );
    }

    // Store and compare in E.164: replies arrive as "+1…", so a number typed
    // "630-555-1234" must become the same string, or its replies (and a STOP)
    // would never match this conversation. Invalid input is rejected here
    // with a readable message.
    const to = toUsE164(dto.to);

    // A prior STOP is binding — TCPA and the 10DLC campaign terms both
    // require it to be honored permanently, not per-thread.
    if (this.dncService.isBlocked(to)) {
      throw new BadRequestException(
        `${to} has opted out of messages (STOP) or is on the Do Not Call list.`,
      );
    }

    // 10DLC campaigns require an opt-out notice; append it unless the
    // message already carries one.
    let body = dto.body;
    if (!/\bSTOP\b/i.test(body)) {
      body = `${body.trimEnd()}\n\nReply STOP to opt out.`;
    }

    const log = this.smsRepo.create({
      userId: user.id,
      phoneNumber: to,
      direction: SmsDirection.OUTBOUND,
      body,
      status: SmsStatus.QUEUED,
    });

    try {
      const { externalId } = await this.telnyxProvider.sendSms(to, body);
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
      const fromNumber = toE164(payload.from?.phone_number ?? '') || 'unknown';

      // Carrier-required opt-out handling: STOP (and friends) permanently
      // suppresses the number for messages and calls alike.
      const text: string = (payload.text ?? '').trim().toUpperCase();
      if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(text)) {
        const admins0 = await this.smsRepo.manager
          .getRepository(User)
          .find({ where: { role: Role.ADMIN } });
        if (admins0[0]) {
          await this.dncService
            .add(admins0[0], fromNumber, 'SMS opt-out (STOP reply)')
            .catch(() => undefined);
        }
        this.logger.log(`STOP received from ${fromNumber} — suppressed`);
      }
      // Everyone texts from one shared company number, so a reply can't be
      // routed by the number it arrived on. It belongs to the recruiter who
      // last texted this contact; with no such recruiter it stays unowned and
      // only admins see it.
      const lastOutbound = await this.smsRepo
        .createQueryBuilder('sms')
        .where('sms.phoneNumber = :phone', { phone: fromNumber })
        .andWhere('sms.direction = :dir', { dir: SmsDirection.OUTBOUND })
        .andWhere('sms.userId IS NOT NULL')
        .orderBy('sms.createdAt', 'DESC')
        .getOne();
      const ownerId = lastOutbound?.userId ?? null;

      const sms = await this.smsRepo.save(
        this.smsRepo.create({
          userId: ownerId,
          phoneNumber: fromNumber,
          direction: SmsDirection.INBOUND,
          body: payload.text ?? '',
          status: SmsStatus.RECEIVED,
          externalId: payload.id ?? null,
        }),
      );

      this.activityService.log(ActivityType.SMS_RECEIVED, `SMS received from ${fromNumber}`, ownerId, sms.id).catch(() => {});

      this.webhooksService.dispatch(WebhookEvent.SMS_RECEIVED, {
        smsId: sms.id,
        from: fromNumber,
        body: sms.body,
        receivedAt: sms.createdAt,
      });

      // Notify the recruiter whose conversation this is, plus the admins —
      // otherwise a recruiter would never learn a candidate had replied.
      const admins = await this.smsRepo.manager
        .getRepository(User)
        .find({ where: { role: Role.ADMIN } });
      const recipients = new Set(admins.map((admin) => admin.id));
      if (ownerId) recipients.add(ownerId);
      for (const recipientId of recipients) {
        this.notificationsService.create(
          recipientId,
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
   * Conversation list: one entry per contact with the most recent message.
   *
   * Recruiters see only their own conversations. Everyone texts from one
   * shared company number, so replies can't be told apart by the number they
   * arrive on — inbound messages are attributed to the recruiter who last
   * texted that contact (see handleTelnyxWebhook). Admins see every thread,
   * including replies from contacts nobody has messaged.
   */
  async threads(user: User): Promise<
    Array<{ phoneNumber: string; lastMessage: string; lastAt: Date; direction: SmsDirection; total: number }>
  > {
    this.assertSmsAccess(user);
    const ownerId = this.scopeFor(user);
    const qb = this.smsRepo
      .createQueryBuilder('sms')
      .select('sms.phoneNumber', 'phoneNumber')
      .addSelect('MAX(sms.createdAt)', 'lastAt')
      .addSelect('COUNT(*)', 'total')
      .groupBy('sms.phoneNumber')
      .orderBy('MAX(sms.createdAt)', 'DESC')
      .limit(200);
    if (ownerId) qb.where('sms.userId = :ownerId', { ownerId });
    const rows = await qb.getRawMany();

    return Promise.all(
      rows.map(async (row) => {
        // Scoped as well: on a contact two recruiters share, the preview must
        // not show the other recruiter's latest message.
        const last = await this.smsRepo.findOne({
          where: ownerId
            ? { phoneNumber: row.phoneNumber, userId: ownerId }
            : { phoneNumber: row.phoneNumber },
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

  /**
   * Full message history with one contact, oldest first (chat order).
   * A recruiter gets only their own side of it — asking for another
   * recruiter's contact returns nothing rather than their conversation.
   */
  async thread(user: User, phoneNumber: string): Promise<SmsLog[]> {
    this.assertSmsAccess(user);
    const ownerId = this.scopeFor(user);
    // Clients pass the number as typed; stored numbers are E.164.
    const phone = toE164(phoneNumber);
    return this.smsRepo.find({
      where: ownerId ? { phoneNumber: phone, userId: ownerId } : { phoneNumber: phone },
      order: { createdAt: 'ASC' },
      take: 500,
    });
  }

  /**
   * Has anyone already contacted this candidate, and did they reply?
   *
   * Lets a recruiter see a colleague is already talking to a candidate before
   * texting them too. Deliberately metadata only — who, when, whether they
   * replied — never message text: conversations stay private to their
   * recruiter.
   */
  async contactStatus(user: User, phoneNumber: string) {
    this.assertSmsAccess(user);
    const phone = toE164(phoneNumber);
    if (!phone) throw new BadRequestException('A valid phone number is required.');

    const rows: Array<{
      userId: string;
      name: string | null;
      lastSentAt: Date | null;
      sent: string;
      lastReplyAt: Date | null;
    }> = await this.smsRepo
      .createQueryBuilder('sms')
      .leftJoin('sms.user', 'u')
      .select('sms.userId', 'userId')
      .addSelect('MAX(u.name)', 'name')
      .addSelect('MAX(CASE WHEN sms.direction = :dirOut THEN sms.createdAt END)', 'lastSentAt')
      .addSelect('COUNT(CASE WHEN sms.direction = :dirOut THEN 1 END)', 'sent')
      .addSelect('MAX(CASE WHEN sms.direction = :dirIn THEN sms.createdAt END)', 'lastReplyAt')
      .where('sms.phoneNumber = :phone', { phone })
      .andWhere('sms.userId IS NOT NULL')
      .setParameters({ dirOut: SmsDirection.OUTBOUND, dirIn: SmsDirection.INBOUND })
      .groupBy('sms.userId')
      .getRawMany();

    const activity = (r: (typeof rows)[number]) => ({
      lastSentAt: r.lastSentAt ? new Date(r.lastSentAt) : null,
      messagesSent: Number(r.sent),
      replied: r.lastReplyAt != null,
      lastReplyAt: r.lastReplyAt ? new Date(r.lastReplyAt) : null,
    });
    const mine = rows.find((r) => r.userId === user.id);
    return {
      phoneNumber: phone,
      optedOut: this.dncService.isBlocked(phone),
      you: mine ? activity(mine) : null,
      others: rows
        .filter((r) => r.userId !== user.id)
        .map((r) => ({ recruiter: r.name ?? 'Another recruiter', ...activity(r) })),
    };
  }

  /** Whose messages a request may see: the user's own, or everyone's for admins. */
  private scopeFor(user: User): string | null {
    return user.role === Role.ADMIN ? null : user.id;
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
