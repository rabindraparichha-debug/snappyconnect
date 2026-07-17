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
  Role,
} from '../common/enums';
import { ProvidersService } from '../providers/providers.service';
import { InitiateCallResult } from '../providers/provider.interface';
import { User } from '../users/user.entity';
import { CallLog } from './call-log.entity';
import { CallRequest } from './call-request.entity';
import { CompleteRequestDto } from './dto/complete-request.dto';
import { LogCallDto, UpdateCallLogDto } from './dto/log-call.dto';
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
  ) {}

  // ---------- Initiation ----------

  async initiate(
    user: User,
    phoneNumber: string,
    source: CallSource = CallSource.WEB,
  ): Promise<InitiateCallResult> {
    const strategy = this.providersService.getStrategy(user.provider);
    return strategy.initiateCall({ user, phoneNumber: phoneNumber.trim(), source });
  }

  // ---------- Client-reported logs (web dialer / mobile Telnyx) ----------

  async logCall(user: User, dto: LogCallDto): Promise<CallLog> {
    return this.callLogsRepo.save(
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
      }),
    );
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
    return this.callLogsRepo.save(log);
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

    const header = ['Date', 'Time', 'User', 'Phone Number', 'Provider', 'Direction', 'Duration (s)', 'Status'];
    const lines = [header.join(',')];
    for (const row of rows) {
      const at = row.startedAt ?? row.createdAt;
      lines.push(
        [
          at.toISOString().slice(0, 10),
          at.toISOString().slice(11, 19),
          row.user ? `${row.user.name} <${row.user.email}>` : '',
          row.phoneNumber,
          row.provider,
          row.direction,
          String(row.durationSeconds),
          row.status,
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
