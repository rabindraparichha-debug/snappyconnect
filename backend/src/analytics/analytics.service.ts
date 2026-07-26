import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { CallLog } from '../calls/call-log.entity';
import { CallDirection, CallStatus, Role } from '../common/enums';
import { User } from '../users/user.entity';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

const CONNECTED = [CallStatus.ANSWERED, CallStatus.COMPLETED];
const MISSED = [CallStatus.MISSED, CallStatus.NO_ANSWER];

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(CallLog) private readonly callLogsRepo: Repository<CallLog>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
  ) {}

  // ---------- Recruiter Analytics ----------

  async recruiterStats(user: User, query: AnalyticsQueryDto) {
    const qb = this.baseQuery(query);
    qb.andWhere('call.userId = :userId', { userId: query.userId ?? user.id });

    const [
      totalCalls,
      connectedCalls,
      missedCalls,
      busyCalls,
      rejectedCalls,
      durationAgg,
      uniqueCandidates,
      repeatCalls,
      todayCalls,
      weekCalls,
      monthCalls,
      outboundCalls,
      inboundCalls,
    ] = await Promise.all([
      this.count(qb),
      this.count(qb, 'call.status IN (:...connected)', { connected: CONNECTED }),
      this.count(qb, 'call.status IN (:...missed)', { missed: MISSED }),
      this.count(qb, 'call.status = :busy', { busy: CallStatus.BUSY }),
      this.count(qb, 'call.status = :canceled', { canceled: CallStatus.CANCELED }),
      this.aggregate(qb),
      this.countDistinct(qb, 'call.phoneNumber'),
      this.countRepeat(qb),
      this.countPeriod(qb, 'CURRENT_DATE'),
      this.countPeriod(qb, "date_trunc('week', CURRENT_DATE)"),
      this.countPeriod(qb, "date_trunc('month', CURRENT_DATE)"),
      this.count(qb, 'call.direction = :outDir', { outDir: CallDirection.OUTBOUND }),
      this.count(qb, 'call.direction = :inDir', { inDir: CallDirection.INBOUND }),
    ]);

    const avgDuration = connectedCalls > 0 ? Math.round(durationAgg.totalDuration / connectedCalls) : 0;
    const { from, to } = this.resolveDateRange(query);
    const hoursInRange = Math.max(1, (to.getTime() - from.getTime()) / 3_600_000);
    const avgCallsPerHour = +(totalCalls / hoursInRange).toFixed(2);

    const connectionRate = totalCalls > 0 ? +(connectedCalls / totalCalls * 100).toFixed(1) : 0;
    const productivityScore = this.calculateProductivity(totalCalls, connectedCalls, durationAgg.totalDuration);

    return {
      totalCalls,
      connectedCalls,
      missedCalls,
      busyCalls,
      rejectedCalls,
      outboundCalls,
      inboundCalls,
      connectionRate,
      averageDurationSeconds: avgDuration,
      totalTalkTimeSeconds: durationAgg.totalDuration,
      uniqueCandidatesContacted: uniqueCandidates,
      repeatCalls,
      callsToday: todayCalls,
      callsThisWeek: weekCalls,
      callsThisMonth: monthCalls,
      avgCallsPerHour,
      productivityScore,
      dailyCallTarget: user.dailyCallTarget ?? 0,
      weeklyCallTarget: user.weeklyCallTarget ?? 0,
    };
  }

  async recruiterTrend(user: User, query: AnalyticsQueryDto, granularity: 'day' | 'week' | 'month' = 'day') {
    const qb = this.baseQuery(query);
    qb.andWhere('call.userId = :userId', { userId: query.userId ?? user.id });

    const trunc = granularity === 'month' ? 'month' : granularity === 'week' ? 'week' : 'day';
    const rows = await qb
      .select(`date_trunc('${trunc}', call.startedAt)`, 'period')
      .addSelect('COUNT(*)', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE call.status IN ('answered','completed'))`, 'connected')
      .addSelect('COALESCE(SUM(call."durationSeconds"), 0)', 'talkTime')
      .groupBy('period')
      .orderBy('period', 'ASC')
      .getRawMany();

    return rows.map((r) => ({
      period: r.period,
      total: Number(r.total),
      connected: Number(r.connected),
      talkTimeSeconds: Number(r.talkTime),
    }));
  }

  // ---------- Team Analytics (admin) ----------

  async teamStats(query: AnalyticsQueryDto) {
    const qb = this.baseQuery(query);
    qb.andWhere('call.userId IS NOT NULL');

    const [
      totalCalls,
      connectedCalls,
      durationAgg,
      recruiterBreakdown,
      regionBreakdown,
      statusBreakdown,
      directionBreakdown,
    ] = await Promise.all([
      this.count(qb),
      this.count(qb, 'call.status IN (:...connected)', { connected: CONNECTED }),
      this.aggregate(qb),
      this.recruiterBreakdown(qb),
      this.groupByField(qb, 'call.region'),
      this.groupByField(qb, 'call.status'),
      this.groupByField(qb, 'call.direction'),
    ]);

    const connectionRate = totalCalls > 0 ? +(connectedCalls / totalCalls * 100).toFixed(1) : 0;
    const avgDuration = connectedCalls > 0 ? Math.round(durationAgg.totalDuration / connectedCalls) : 0;

    return {
      totalCalls,
      connectedCalls,
      connectionRate,
      averageDurationSeconds: avgDuration,
      totalTalkTimeSeconds: durationAgg.totalDuration,
      byRecruiter: recruiterBreakdown,
      byRegion: regionBreakdown,
      byStatus: statusBreakdown,
      byDirection: directionBreakdown,
    };
  }

  async leaderboard(query: AnalyticsQueryDto, metric: 'calls' | 'connected' | 'talkTime' = 'calls', limit = 10) {
    const qb = this.baseQuery(query);
    qb.andWhere('call.userId IS NOT NULL');

    let orderCol: string;
    switch (metric) {
      case 'connected':
        orderCol = 'connected';
        break;
      case 'talkTime':
        orderCol = 'talkTime';
        break;
      default:
        orderCol = 'total';
    }

    const rows = await qb
      .select('call.userId', 'userId')
      .addSelect('user.name', 'name')
      .addSelect('user.email', 'email')
      .addSelect('COUNT(*)', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE call.status IN ('answered','completed'))`, 'connected')
      .addSelect('COALESCE(SUM(call."durationSeconds"), 0)', 'talkTime')
      .addSelect(`COUNT(DISTINCT call."phoneNumber")`, 'uniqueContacts')
      .innerJoin('call.user', 'user')
      .groupBy('call.userId')
      .addGroupBy('user.name')
      .addGroupBy('user.email')
      .orderBy(`"${orderCol}"`, 'DESC')
      .limit(limit)
      .getRawMany();

    return rows.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      name: r.name,
      email: r.email,
      totalCalls: Number(r.total),
      connectedCalls: Number(r.connected),
      talkTimeSeconds: Number(r.talkTime),
      uniqueContacts: Number(r.uniqueContacts),
      connectionRate: Number(r.total) > 0 ? +(Number(r.connected) / Number(r.total) * 100).toFixed(1) : 0,
    }));
  }

  async teamTrend(query: AnalyticsQueryDto, granularity: 'day' | 'week' | 'month' = 'day') {
    const qb = this.baseQuery(query);
    const trunc = granularity === 'month' ? 'month' : granularity === 'week' ? 'week' : 'day';

    const rows = await qb
      .select(`date_trunc('${trunc}', call.startedAt)`, 'period')
      .addSelect('COUNT(*)', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE call.status IN ('answered','completed'))`, 'connected')
      .addSelect(`COUNT(*) FILTER (WHERE call.status IN ('missed','no_answer'))`, 'missed')
      .addSelect('COALESCE(SUM(call."durationSeconds"), 0)', 'talkTime')
      .groupBy('period')
      .orderBy('period', 'ASC')
      .getRawMany();

    return rows.map((r) => ({
      period: r.period,
      total: Number(r.total),
      connected: Number(r.connected),
      missed: Number(r.missed),
      talkTimeSeconds: Number(r.talkTime),
    }));
  }

  // ---------- Helpers ----------

  private baseQuery(query: AnalyticsQueryDto): SelectQueryBuilder<CallLog> {
    const qb = this.callLogsRepo.createQueryBuilder('call');
    const { from, to } = this.resolveDateRange(query);
    qb.where('call.startedAt >= :from', { from });
    qb.andWhere('call.startedAt < :to', { to });
    if (query.region) qb.andWhere('call.region = :region', { region: query.region });
    return qb;
  }

  private resolveDateRange(query: AnalyticsQueryDto): { from: Date; to: Date } {
    let to = query.to ? new Date(query.to) : new Date();
    if (query.to) to = new Date(to.getTime() + 86_400_000);
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86_400_000);
    return { from, to };
  }

  private async count(qb: SelectQueryBuilder<CallLog>, extra?: string, params?: Record<string, any>): Promise<number> {
    const clone = qb.clone();
    if (extra) clone.andWhere(extra, params);
    return clone.getCount();
  }

  private async aggregate(qb: SelectQueryBuilder<CallLog>) {
    const row = await qb.clone()
      .select('COALESCE(SUM(call."durationSeconds"), 0)', 'totalDuration')
      .addSelect('COALESCE(MAX(call."durationSeconds"), 0)', 'maxDuration')
      .getRawOne();
    return {
      totalDuration: Number(row?.totalDuration ?? 0),
      maxDuration: Number(row?.maxDuration ?? 0),
    };
  }

  private async countDistinct(qb: SelectQueryBuilder<CallLog>, field: string): Promise<number> {
    const row = await qb.clone()
      .select(`COUNT(DISTINCT ${field})`, 'cnt')
      .getRawOne();
    return Number(row?.cnt ?? 0);
  }

  private async countRepeat(qb: SelectQueryBuilder<CallLog>): Promise<number> {
    const rows = await qb.clone()
      .select('call.phoneNumber')
      .addSelect('COUNT(*)', 'cnt')
      .groupBy('call.phoneNumber')
      .having('COUNT(*) > 1')
      .getRawMany();
    return rows.length;
  }

  private async countPeriod(qb: SelectQueryBuilder<CallLog>, startExpr: string): Promise<number> {
    const clone = qb.clone();
    clone.andWhere(`call.startedAt >= ${startExpr}`);
    return clone.getCount();
  }

  private async recruiterBreakdown(qb: SelectQueryBuilder<CallLog>) {
    const rows = await qb.clone()
      .select('call.userId', 'userId')
      .addSelect('COUNT(*)', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE call.status IN ('answered','completed'))`, 'connected')
      .addSelect('COALESCE(SUM(call."durationSeconds"), 0)', 'talkTime')
      .groupBy('call.userId')
      .orderBy('"total"', 'DESC')
      .getRawMany();
    return rows.map((r) => ({
      userId: r.userId,
      totalCalls: Number(r.total),
      connectedCalls: Number(r.connected),
      talkTimeSeconds: Number(r.talkTime),
    }));
  }

  private async groupByField(qb: SelectQueryBuilder<CallLog>, field: string) {
    const rows = await qb.clone()
      .select(field, 'value')
      .addSelect('COUNT(*)', 'count')
      .groupBy(field)
      .orderBy('"count"', 'DESC')
      .getRawMany();
    return rows.map((r) => ({ value: r.value, count: Number(r.count) }));
  }

  private calculateProductivity(totalCalls: number, connected: number, talkTime: number): number {
    if (totalCalls === 0) return 0;
    const connectionWeight = 0.4;
    const volumeWeight = 0.3;
    const talkTimeWeight = 0.3;

    const connectionScore = Math.min(100, (connected / totalCalls) * 100);
    const volumeScore = Math.min(100, (totalCalls / 50) * 100);
    const talkScore = Math.min(100, (talkTime / 3600) * 100);

    return Math.round(
      connectionScore * connectionWeight +
      volumeScore * volumeWeight +
      talkScore * talkTimeWeight,
    );
  }
}
