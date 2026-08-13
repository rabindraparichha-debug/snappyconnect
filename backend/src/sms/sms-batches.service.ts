import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import { Role } from '../common/enums';
import { User } from '../users/user.entity';
import { SmsBatch, SmsBatchItem, SmsBatchStatus } from './sms-batch.entity';
import { SmsService } from './sms.service';

// ---- Hard limits (server-side; the UI mirrors them but cannot loosen them) --
export const BATCH_LIMITS = {
  /** Max recipients per batch — also the unit that spreads over one hour. */
  maxContacts: 50,
  /** Max characters of the recruiter's text (the STOP notice is added on
   * top); keeps every message to at most two billed segments. */
  maxMessageChars: 250,
  /** Max messages one recruiter may schedule per calendar day. */
  dailyPerUser: 200,
  /** Seconds between sends — 50 contacts take exactly one hour. */
  dripIntervalSec: 72,
  /** TCPA-safe sending window, recipient-side US Eastern. */
  windowStartHour: 8,
  windowEndHour: 21,
};

const WORKER_TICK_MS = 30_000;

function easternHour(date: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
    }).format(date),
  );
}

@Injectable()
export class SmsBatchesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SmsBatchesService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    @InjectRepository(SmsBatch)
    private readonly batchesRepo: Repository<SmsBatch>,
    @InjectRepository(SmsBatchItem)
    private readonly itemsRepo: Repository<SmsBatchItem>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly smsService: SmsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), WORKER_TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- creation ----------

  async create(
    user: User,
    dto: { message: string; startAt: string; contacts: Array<{ phone: string; name?: string }> },
  ) {
    if (!(user.regions ?? []).includes('usa')) {
      throw new ForbiddenException('Scheduled messages need USA access.');
    }

    const message = dto.message.trim();
    if (!message) throw new BadRequestException('Message is required');
    if (message.length > BATCH_LIMITS.maxMessageChars) {
      throw new BadRequestException(
        `Message too long: ${message.length}/${BATCH_LIMITS.maxMessageChars} characters. ` +
          'Shorter messages cost less and read better.',
      );
    }

    // Dedupe and normalise recipients.
    const seen = new Set<string>();
    const contacts: Array<{ phone: string; name: string | null }> = [];
    for (const c of dto.contacts) {
      const digits = (c.phone ?? '').replace(/[^\d+]/g, '');
      const phone = digits.startsWith('+')
        ? digits
        : digits.length === 10
          ? `+1${digits}`
          : digits.length === 11 && digits.startsWith('1')
            ? `+${digits}`
            : '';
      if (!/^\+1\d{10}$/.test(phone)) {
        throw new BadRequestException(`${c.phone} is not a valid US number`);
      }
      if (seen.has(phone)) continue;
      seen.add(phone);
      contacts.push({ phone, name: c.name?.trim() || null });
    }
    if (!contacts.length) throw new BadRequestException('No valid contacts');
    if (contacts.length > BATCH_LIMITS.maxContacts) {
      throw new BadRequestException(
        `Too many contacts: ${contacts.length}. The limit is ${BATCH_LIMITS.maxContacts} per batch.`,
      );
    }

    const start = new Date(dto.startAt);
    if (Number.isNaN(start.getTime())) throw new BadRequestException('Invalid start time');
    if (start.getTime() < Date.now() - 60_000) {
      throw new BadRequestException('Start time is in the past');
    }
    const end = new Date(start.getTime() + contacts.length * BATCH_LIMITS.dripIntervalSec * 1000);
    for (const moment of [start, end]) {
      const hour = easternHour(moment);
      if (hour < BATCH_LIMITS.windowStartHour || hour >= BATCH_LIMITS.windowEndHour) {
        throw new BadRequestException(
          'Messages may only go out 8:00–21:00 US Eastern (including the drip window). ' +
            'Pick a start time that keeps the whole batch inside that window.',
        );
      }
    }

    // Per-recruiter daily cap across all their batches.
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todays = await this.itemsRepo
      .createQueryBuilder('item')
      .innerJoin(SmsBatch, 'batch', 'batch.id = item."batchId"')
      .where('batch."userId" = :uid', { uid: user.id })
      .andWhere('item."sendAt" >= :dayStart', { dayStart })
      .andWhere("item.status != 'canceled'")
      .getCount();
    if (todays + contacts.length > BATCH_LIMITS.dailyPerUser) {
      throw new BadRequestException(
        `Daily limit reached: ${todays} of ${BATCH_LIMITS.dailyPerUser} messages already ` +
          'scheduled today. This protects the numbers from being spam-flagged.',
      );
    }

    const batch = await this.batchesRepo.save(
      this.batchesRepo.create({
        userId: user.id,
        message,
        scheduledAt: start,
        status: SmsBatchStatus.SCHEDULED,
        total: contacts.length,
      }),
    );
    await this.itemsRepo.save(
      contacts.map((c, i) =>
        this.itemsRepo.create({
          batchId: batch.id,
          phoneNumber: c.phone,
          contactName: c.name,
          sendAt: new Date(start.getTime() + i * BATCH_LIMITS.dripIntervalSec * 1000),
          status: 'pending',
        }),
      ),
    );
    this.logger.log(`Batch ${batch.id}: ${contacts.length} messages from ${start.toISOString()}`);
    return this.view(batch);
  }

  // ---------- listing / cancel ----------

  async list(user: User) {
    const where = user.role === Role.ADMIN ? {} : { userId: user.id };
    const batches = await this.batchesRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: 30,
    });
    const owners = new Map(
      (await this.usersRepo.find()).map((u) => [u.id, u.name] as const),
    );
    return batches.map((b) => ({ ...this.view(b), owner: owners.get(b.userId) ?? '—' }));
  }

  async cancel(user: User, id: string) {
    const batch = await this.batchesRepo.findOne({ where: { id } });
    if (!batch) throw new NotFoundException('Batch not found');
    if (user.role !== Role.ADMIN && batch.userId !== user.id) {
      throw new ForbiddenException('You can only cancel your own batches');
    }
    if (batch.status === SmsBatchStatus.COMPLETED) {
      throw new BadRequestException('Batch already completed');
    }
    batch.status = SmsBatchStatus.CANCELED;
    await this.batchesRepo.save(batch);
    await this.itemsRepo.update(
      { batchId: batch.id, status: 'pending' },
      { status: 'canceled' },
    );
    return this.view(batch);
  }

  private view(b: SmsBatch) {
    return {
      id: b.id,
      message: b.message,
      scheduledAt: b.scheduledAt,
      status: b.status,
      total: b.total,
      sent: b.sent,
      failed: b.failed,
      skipped: b.skipped,
    };
  }

  // ---------- the drip worker ----------

  private async tick(): Promise<void> {
    if (this.ticking) return; // never overlap sends
    this.ticking = true;
    try {
      // Safety net: even if a batch was scheduled oddly, nothing leaves
      // outside the calling window.
      const hour = easternHour(new Date());
      if (hour < BATCH_LIMITS.windowStartHour || hour >= BATCH_LIMITS.windowEndHour) return;

      const due = await this.itemsRepo.find({
        where: { status: 'pending', sendAt: LessThanOrEqual(new Date()) },
        order: { sendAt: 'ASC' },
        take: 3, // per tick — keeps the drip gentle even after downtime
      });
      if (!due.length) return;

      const batches = new Map<string, SmsBatch>();
      for (const item of due) {
        let batch = batches.get(item.batchId) ?? undefined;
        if (!batch) {
          batch = (await this.batchesRepo.findOne({ where: { id: item.batchId } })) ?? undefined;
          if (!batch) continue;
          batches.set(item.batchId, batch);
        }
        if (batch.status === SmsBatchStatus.CANCELED) continue;
        if (batch.status === SmsBatchStatus.SCHEDULED) {
          batch.status = SmsBatchStatus.SENDING;
          await this.batchesRepo.save(batch);
        }

        const owner = await this.usersRepo.findOne({ where: { id: batch.userId } });
        if (!owner) continue;

        const body = batch.message
          .replaceAll('{{name}}', item.contactName || 'there')
          .replaceAll('{{Name}}', item.contactName || 'there');
        try {
          await this.smsService.send(owner, { to: item.phoneNumber, body });
          item.status = 'sent';
          batch.sent += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'send failed';
          // DNC / opt-out refusals are expected policy, not failures.
          if (/Do Not Call|opted out/i.test(message)) {
            item.status = 'skipped';
            batch.skipped += 1;
          } else {
            item.status = 'failed';
            batch.failed += 1;
          }
          item.error = message.slice(0, 250);
        }
        await this.itemsRepo.save(item);

        const remaining = await this.itemsRepo.count({
          where: { batchId: batch.id, status: 'pending' },
        });
        if (remaining === 0) batch.status = SmsBatchStatus.COMPLETED;
        await this.batchesRepo.save(batch);
      }
    } catch (err) {
      this.logger.error('batch tick failed', err instanceof Error ? err.stack : err);
    } finally {
      this.ticking = false;
    }
  }
}
