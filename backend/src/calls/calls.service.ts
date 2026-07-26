import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  CallDirection,
  CallingProvider,
  CallRequestStatus,
  CallSource,
  CallStatus,
  Region,
  REGION_PROVIDER,
  Role,
} from '../common/enums';
import { guessRegion } from '../common/region.util';
import { DncService } from '../dnc/dnc.service';
import { ActivityService } from '../activity/activity.service';
import { ActivityType } from '../activity/activity.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { ProvidersService } from '../providers/providers.service';
import { InitiateCallResult } from '../providers/provider.interface';
import { User } from '../users/user.entity';
import { WebhooksService } from '../webhooks/webhooks.service';
import { WebhookEvent } from '../webhooks/webhook.entity';
import { CallLog } from './call-log.entity';
import { CallRequest } from './call-request.entity';
import { CompleteRequestDto } from './dto/complete-request.dto';
import { BulkUpdateCallsDto, LogCallDto, UpdateCallLogDto } from './dto/log-call.dto';
import { QueryCallsDto } from './dto/query-calls.dto';
import { SyncCallsDto } from './dto/sync-calls.dto';

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    @InjectRepository(CallLog)
    private readonly callLogsRepo: Repository<CallLog>,
    @InjectRepository(CallRequest)
    private readonly requestsRepo: Repository<CallRequest>,
    private readonly providersService: ProvidersService,
    private readonly notificationsService: NotificationsService,
    private readonly activityService: ActivityService,
    private readonly webhooksService: WebhooksService,
    private readonly dncService: DncService,
  ) {}

  // ---------- Initiation ----------

  async initiate(
    user: User,
    phoneNumber: string,
    source: CallSource = CallSource.WEB,
    region?: Region,
  ): Promise<InitiateCallResult> {
    const number = phoneNumber.trim();
    if (this.dncService.isBlocked(number)) {
      throw new ForbiddenException(
        `${number} is on the Do Not Call list and cannot be dialled.`,
      );
    }
    const provider = this.resolveProvider(user, number, region);
    const strategy = this.providersService.getStrategy(provider);
    return strategy.initiateCall({ user, phoneNumber: number, source });
  }

  /**
   * Pick the provider for a call: the explicitly requested region wins, then
   * the region guessed from the number's dial code, then the user's single
   * legacy provider. Users may only call regions they were granted.
   */
  private resolveProvider(user: User, phoneNumber: string, region?: Region): CallingProvider | null {
    const allowed = this.allowedRegions(user);

    if (region) {
      if (!allowed.includes(region)) {
        throw new ForbiddenException(
          `You do not have access to ${region.toUpperCase()} calling. Ask an admin to enable it.`,
        );
      }
      return REGION_PROVIDER[region];
    }

    const guessed = guessRegion(phoneNumber);
    if (guessed && allowed.includes(guessed)) return REGION_PROVIDER[guessed];

    // Single-region users keep working without ever passing a region.
    if (allowed.length === 1) return REGION_PROVIDER[allowed[0]];
    return user.provider;
  }

  /** Regions a user may call in, falling back to the one implied by `provider`. */
  private allowedRegions(user: User): Region[] {
    const regions = (user.regions ?? []).filter((r): r is Region =>
      Object.values(Region).includes(r as Region),
    );
    if (regions.length) return regions;
    const implied = Object.entries(REGION_PROVIDER).find(([, p]) => p === user.provider);
    return implied ? [implied[0] as Region] : [];
  }

  // ---------- Client-reported logs (web dialer / mobile Telnyx) ----------

  async logCall(user: User, dto: LogCallDto): Promise<CallLog> {
    const log = await this.callLogsRepo.save(
      this.callLogsRepo.create({
        userId: user.id,
        phoneNumber: dto.phoneNumber,
        provider: user.provider ?? CallingProvider.TELNYX,
        direction: dto.direction ?? CallDirection.OUTBOUND,
        status: dto.status,
        durationSeconds: dto.durationSeconds ?? 0,
        startedAt: dto.startedAt ? new Date(dto.startedAt) : new Date(),
        endedAt: dto.endedAt ? new Date(dto.endedAt) : null,
        externalId: dto.externalId ?? null,
        metadata: dto.metadata ?? null,
        contactName: dto.contactName ?? null,
        candidateId: dto.candidateId ?? null,
        jobId: dto.jobId ?? null,
        companyId: dto.companyId ?? null,
        region: dto.region ?? null,
        country: dto.country ?? null,
        source: dto.source ?? null,
        ringTimeSeconds: dto.ringTimeSeconds ?? 0,
        notes: dto.notes ?? null,
        followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : null,
        device: dto.device ?? null,
        ipAddress: dto.ipAddress ?? null,
      }),
    );

    const actType = dto.direction === CallDirection.INBOUND ? ActivityType.CALL_RECEIVED : ActivityType.CALL_MADE;
    this.activityService.log(actType, `${dto.direction} call to ${dto.phoneNumber}`, user.id, log.id).catch(() => {});

    this.webhooksService.dispatch(WebhookEvent.CALL_COMPLETED, {
      callId: log.id,
      phoneNumber: log.phoneNumber,
      contactName: log.contactName,
      direction: log.direction,
      status: log.status,
      durationSeconds: log.durationSeconds,
      region: log.region,
      startedAt: log.startedAt,
      user: { id: user.id, name: user.name, email: user.email },
    });

    if (dto.status === CallStatus.MISSED || dto.status === CallStatus.NO_ANSWER) {
      this.notificationsService.create(
        user.id,
        NotificationType.MISSED_CALL,
        `Missed call from ${dto.phoneNumber}`,
        dto.contactName ?? undefined,
        log.id,
      ).catch((err) => this.logger.warn('Failed to create notification', err));
    }

    return log;
  }

  async updateLog(user: User, id: string, dto: UpdateCallLogDto): Promise<CallLog> {
    const log = await this.callLogsRepo.findOne({ where: { id } });
    if (!log) throw new NotFoundException('Call log not found');
    if (user.role !== Role.ADMIN && log.userId !== user.id) {
      throw new ForbiddenException('You can only update your own calls');
    }
    if (dto.status) log.status = dto.status;
    if (dto.durationSeconds !== undefined) log.durationSeconds = dto.durationSeconds;
    if (dto.endedAt) log.endedAt = new Date(dto.endedAt);
    if (dto.externalId) log.externalId = dto.externalId;
    if (dto.contactName !== undefined) log.contactName = dto.contactName;
    if (dto.notes !== undefined) log.notes = dto.notes;
    if (dto.followUpDate !== undefined) log.followUpDate = dto.followUpDate ? new Date(dto.followUpDate) : null;
    if (dto.recordingUrl !== undefined) log.recordingUrl = dto.recordingUrl;
    if (dto.aiSummary !== undefined) log.aiSummary = dto.aiSummary;
    if (dto.transcript !== undefined) log.transcript = dto.transcript;
    if (dto.disposition !== undefined) log.disposition = dto.disposition;

    if (dto.notes !== undefined) {
      this.activityService.log(ActivityType.NOTE_ADDED, `Note added on ${log.phoneNumber}`, user.id, log.id).catch(() => {});
    }
    if (dto.followUpDate !== undefined) {
      this.activityService.log(ActivityType.FOLLOW_UP_SET, `Follow-up set for ${log.phoneNumber}`, user.id, log.id).catch(() => {});
    }
    if (dto.disposition !== undefined) {
      this.activityService.log(ActivityType.DISPOSITION_SET, `Disposition "${dto.disposition}" on ${log.phoneNumber}`, user.id, log.id).catch(() => {});
      this.webhooksService.dispatch(WebhookEvent.DISPOSITION_SET, {
        callId: log.id,
        phoneNumber: log.phoneNumber,
        contactName: log.contactName,
        disposition: dto.disposition,
        notes: log.notes,
        user: { id: user.id, name: user.name, email: user.email },
      });
    }

    return this.callLogsRepo.save(log);
  }

  async bulkUpdate(user: User, dto: BulkUpdateCallsDto): Promise<{ updated: number }> {
    const qb = this.callLogsRepo.createQueryBuilder('c').whereInIds(dto.ids);
    if (user.role !== Role.ADMIN) {
      qb.andWhere('c.userId = :uid', { uid: user.id });
    }
    const logs = await qb.getMany();
    for (const log of logs) {
      if (dto.notes !== undefined) log.notes = dto.notes;
      if (dto.contactName !== undefined) log.contactName = dto.contactName;
      if (dto.followUpDate !== undefined) log.followUpDate = dto.followUpDate ? new Date(dto.followUpDate) : null;
      if (dto.disposition !== undefined) log.disposition = dto.disposition;
    }
    await this.callLogsRepo.save(logs);
    return { updated: logs.length };
  }

  // ---------- History ----------

  async findAll(user: User, query: QueryCallsDto) {
    const { page = 1, limit = 20 } = query;
    const qb = this.buildHistoryQuery(user, query);
    qb.skip((page - 1) * limit).take(limit);
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }

  async exportCsv(user: User, query: QueryCallsDto): Promise<string> {
    const qb = this.buildHistoryQuery(user, query);
    qb.take(10000);
    const rows = await qb.getMany();

    const header = [
      'Date', 'Time', 'User', 'Phone Number', 'Contact', 'Provider',
      'Region', 'Direction', 'Source', 'Duration (s)', 'Ring (s)',
      'Status', 'Notes', 'Follow-up',
    ];
    const lines = [header.join(',')];
    for (const row of rows) {
      const at = row.startedAt ?? row.createdAt;
      lines.push(
        [
          at.toISOString().slice(0, 10),
          at.toISOString().slice(11, 19),
          row.user ? `${row.user.name} <${row.user.email}>` : '',
          row.phoneNumber,
          row.contactName ?? '',
          row.provider,
          row.region ?? '',
          row.direction,
          row.source ?? '',
          String(row.durationSeconds),
          String(row.ringTimeSeconds ?? 0),
          row.status,
          row.notes ?? '',
          row.followUpDate ? row.followUpDate.toISOString().slice(0, 10) : '',
        ]
          .map(csvEscape)
          .join(','),
      );
    }
    return lines.join('\r\n');
  }

  private buildHistoryQuery(user: User, query: QueryCallsDto): SelectQueryBuilder<CallLog> {
    const qb = this.callLogsRepo
      .createQueryBuilder('call')
      .leftJoinAndSelect('call.user', 'user')
      .orderBy('call.createdAt', 'DESC');

    // Non-admins only ever see their own history.
    if (user.role !== Role.ADMIN) {
      qb.andWhere('call.userId = :ownId', { ownId: user.id });
    } else if (query.userId) {
      qb.andWhere('call.userId = :userId', { userId: query.userId });
    }

    if (query.q) {
      qb.andWhere(
        '(call.phoneNumber ILIKE :q OR user.name ILIKE :q OR user.email ILIKE :q)',
        { q: `%${query.q}%` },
      );
    }
    if (query.provider) qb.andWhere('call.provider = :provider', { provider: query.provider });
    if (query.direction) qb.andWhere('call.direction = :direction', { direction: query.direction });
    if (query.status) qb.andWhere('call.status = :status', { status: query.status });
    if (query.disposition) qb.andWhere('call.disposition = :disposition', { disposition: query.disposition });
    if (query.from) qb.andWhere('call.createdAt >= :from', { from: new Date(query.from) });
    if (query.to) qb.andWhere('call.createdAt <= :to', { to: new Date(query.to) });

    return qb;
  }

  // ---------- Native-dialer call requests (mobile app) ----------

  async pendingRequests(user: User): Promise<CallRequest[]> {
    // Requests older than 2 minutes are considered stale.
    await this.requestsRepo
      .createQueryBuilder()
      .update()
      .set({ status: CallRequestStatus.EXPIRED })
      .where(
        `"userId" = :id AND status = :pending AND "createdAt" < now() - interval '2 minutes'`,
        { id: user.id, pending: CallRequestStatus.PENDING },
      )
      .execute();

    return this.requestsRepo.find({
      where: { userId: user.id, status: CallRequestStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
  }

  async ackRequest(user: User, id: string): Promise<CallRequest> {
    const request = await this.getOwnRequest(user, id);
    request.status = CallRequestStatus.DISPATCHED;
    request.dispatchedAt = new Date();
    return this.requestsRepo.save(request);
  }

  async completeRequest(user: User, id: string, dto: CompleteRequestDto): Promise<CallLog> {
    const request = await this.getOwnRequest(user, id);
    request.status = CallRequestStatus.COMPLETED;
    await this.requestsRepo.save(request);

    return this.callLogsRepo.save(
      this.callLogsRepo.create({
        userId: user.id,
        phoneNumber: request.phoneNumber,
        provider: CallingProvider.NATIVE_DIALER,
        direction: CallDirection.OUTBOUND,
        status: dto.status,
        durationSeconds: dto.durationSeconds,
        startedAt: dto.startedAt ? new Date(dto.startedAt) : request.dispatchedAt ?? new Date(),
        endedAt: new Date(),
        metadata: { requestId: request.id, source: request.source },
      }),
    );
  }

  async cancelRequest(user: User, id: string): Promise<CallRequest> {
    const request = await this.getOwnRequest(user, id);
    request.status = CallRequestStatus.CANCELED;
    return this.requestsRepo.save(request);
  }

  private async getOwnRequest(user: User, id: string): Promise<CallRequest> {
    const request = await this.requestsRepo.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Call request not found');
    if (request.userId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('Not your call request');
    }
    return request;
  }

  // ---------- Mobile bulk history sync (native dialer) ----------

  async syncCalls(user: User, dto: SyncCallsDto): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    for (const item of dto.calls) {
      const startedAt = new Date(item.startedAt);
      const exists = await this.callLogsRepo.findOne({
        where: {
          userId: user.id,
          phoneNumber: item.phoneNumber,
          startedAt,
          provider: CallingProvider.NATIVE_DIALER,
        },
      });
      if (exists) {
        skipped++;
        continue;
      }
      await this.callLogsRepo.save(
        this.callLogsRepo.create({
          userId: user.id,
          phoneNumber: item.phoneNumber,
          provider: CallingProvider.NATIVE_DIALER,
          direction: item.direction,
          status: item.status,
          durationSeconds: item.durationSeconds,
          startedAt,
          endedAt: new Date(startedAt.getTime() + item.durationSeconds * 1000),
          metadata: { syncedFromDevice: true },
        }),
      );
      imported++;
    }
    return { imported, skipped };
  }

  // ---------- Contacts timeline ----------

  async contacts(user: User, query: { q?: string; page?: number; limit?: number }) {
    const { page = 1, limit = 20 } = query;
    const qb = this.callLogsRepo
      .createQueryBuilder('call')
      .select('call.phoneNumber', 'phoneNumber')
      .addSelect('MAX(call.contactName)', 'contactName')
      .addSelect('COUNT(*)::int', 'totalCalls')
      .addSelect(
        `COUNT(*) FILTER (WHERE call.status IN ('completed','answered'))::int`,
        'connectedCalls',
      )
      .addSelect('SUM(call.durationSeconds)::int', 'totalTalkTime')
      .addSelect('MAX(call.createdAt)', 'lastCallAt')
      .addSelect('MIN(call.createdAt)', 'firstCallAt')
      .groupBy('call.phoneNumber')
      .orderBy('"lastCallAt"', 'DESC');

    if (user.role !== Role.ADMIN) {
      qb.andWhere('call.userId = :uid', { uid: user.id });
    }
    if (query.q) {
      qb.andWhere(
        '(call.phoneNumber ILIKE :q OR call.contactName ILIKE :q)',
        { q: `%${query.q}%` },
      );
    }

    const countQb = qb.clone();
    const totalResult = await this.callLogsRepo.query(
      `SELECT COUNT(*) as count FROM (${countQb.getQuery()}) sub`,
      countQb.getParameters() ? Object.values(countQb.getParameters()) : [],
    );
    const total = parseInt(totalResult?.[0]?.count ?? '0', 10);

    qb.offset((page - 1) * limit).limit(limit);
    const items = await qb.getRawMany();
    return { items, total, page, limit };
  }

  async contactHistory(user: User, phoneNumber: string) {
    const qb = this.callLogsRepo
      .createQueryBuilder('call')
      .leftJoinAndSelect('call.user', 'user')
      .where('call.phoneNumber = :phone', { phone: phoneNumber })
      .orderBy('call.createdAt', 'DESC');

    if (user.role !== Role.ADMIN) {
      qb.andWhere('call.userId = :uid', { uid: user.id });
    }
    return qb.getMany();
  }

  // ---------- Follow-ups ----------

  async upcomingFollowUps(user: User, limit = 10) {
    const qb = this.callLogsRepo
      .createQueryBuilder('call')
      .leftJoinAndSelect('call.user', 'user')
      .where('call.followUpDate IS NOT NULL')
      .andWhere('call.followUpDate >= :today', { today: new Date().toISOString().slice(0, 10) })
      .orderBy('call.followUpDate', 'ASC')
      .take(limit);

    if (user.role !== Role.ADMIN) {
      qb.andWhere('call.userId = :uid', { uid: user.id });
    }
    return qb.getMany();
  }

  // ---------- Telnyx webhooks ----------

  async handleTelnyxWebhook(event: any): Promise<void> {
    const eventType: string | undefined = event?.data?.event_type;
    const payload = event?.data?.payload;
    if (!eventType || !payload) return;

    const legId: string | undefined = payload.call_leg_id;
    if (!legId) return;

    const log = await this.callLogsRepo.findOne({ where: { externalId: legId } });
    if (!log) {
      this.logger.debug(`No call log for Telnyx leg ${legId} (${eventType})`);
      return;
    }

    switch (eventType) {
      case 'call.answered':
        log.status = CallStatus.ANSWERED;
        break;
      case 'call.hangup': {
        const start = payload.start_time ? new Date(payload.start_time) : log.startedAt;
        const end = payload.end_time ? new Date(payload.end_time) : new Date();
        log.endedAt = end;
        if (start) {
          log.durationSeconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
        }
        log.status =
          payload.hangup_cause === 'normal_clearing' && log.status === CallStatus.ANSWERED
            ? CallStatus.COMPLETED
            : this.mapHangupCause(payload.hangup_cause);
        break;
      }
      default:
        return;
    }
    await this.callLogsRepo.save(log);
  }

  private mapHangupCause(cause?: string): CallStatus {
    switch (cause) {
      case 'user_busy':
        return CallStatus.BUSY;
      case 'no_answer':
      case 'originator_cancel':
        return CallStatus.NO_ANSWER;
      case 'normal_clearing':
        return CallStatus.COMPLETED;
      default:
        return CallStatus.FAILED;
    }
  }
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
