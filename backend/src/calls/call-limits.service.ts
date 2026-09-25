import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallDirection, CallingProvider, REGION_PROVIDER, Region } from '../common/enums';
import { SettingsService } from '../settings/settings.service';
import { User } from '../users/user.entity';
import { CallLog } from './call-log.entity';

export type CallKind = 'manual' | 'ai';

export interface LimitUsage {
  used: number;
  limit: number | null; // null = unlimited
  remaining: number | null;
}

export interface RegionAllowance {
  region: Region;
  manual: { daily: LimitUsage; monthly: LimitUsage };
  ai: { daily: LimitUsage; monthly: LimitUsage };
}

/** Settings key for one bucket, e.g. usaManualDaily. */
function limitKey(region: Region, kind: CallKind, period: 'Daily' | 'Monthly'): string {
  const r = region === Region.USA ? 'usa' : region === Region.INDIA ? 'india' : 'uae';
  return `${r}${kind === 'ai' ? 'Ai' : 'Manual'}${period}`;
}

/** Blank, zero or nonsense all mean "no limit" — never "no calls". */
function parseLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * How many calls a recruiter may place, per region, per day and per month.
 *
 * Limits are set once for everyone in Settings and can be overridden per
 * person. Counting is done from the call log rather than a separate counter:
 * one source of truth, and a limit that cannot drift from what actually
 * happened.
 */
@Injectable()
export class CallLimitsService {
  constructor(
    @InjectRepository(CallLog)
    private readonly logs: Repository<CallLog>,
    private readonly settings: SettingsService,
  ) {}

  async limitFor(
    user: User,
    region: Region,
    kind: CallKind,
    period: 'Daily' | 'Monthly',
  ): Promise<number | null> {
    const key = limitKey(region, kind, period);
    // A person's own limit wins over the shared one, including "unlimited".
    const own = (user.providerConfig as any)?.callLimits?.[key];
    if (own !== undefined && own !== null && own !== '') return parseLimit(own);
    const global = await this.settings.getProviderSettings('limits');
    return parseLimit(global?.[key]);
  }

  async used(user: User, region: Region, kind: CallKind, since: Date): Promise<number> {
    const provider = REGION_PROVIDER[region];
    const rows = await this.logs
      .createQueryBuilder('log')
      .where('log.userId = :userId', { userId: user.id })
      .andWhere('log.provider = :provider', { provider })
      .andWhere('log.direction = :direction', { direction: CallDirection.OUTBOUND })
      .andWhere('log.createdAt >= :since', { since })
      // AI calls carry a marker in metadata; everything else is a person dialling.
      .andWhere(
        kind === 'ai'
          ? `log.metadata ->> 'ai' = 'true'`
          : `(log.metadata ->> 'ai' IS NULL OR log.metadata ->> 'ai' <> 'true')`,
      )
      .getCount();
    return rows;
  }

  /** Refuses the call when the limit is already reached. */
  async assertAllowed(user: User, region: Region, kind: CallKind): Promise<void> {
    for (const period of ['Daily', 'Monthly'] as const) {
      const limit = await this.limitFor(user, region, kind, period);
      if (limit === null) continue;
      const used = await this.used(user, region, kind, startOf(period));
      if (used >= limit) {
        const window = period === 'Daily' ? 'today' : 'this month';
        throw new ForbiddenException(
          `${kind === 'ai' ? 'AI call' : 'Call'} limit reached: ${used} of ${limit} ${window} for ${region.toUpperCase()}. Ask an admin to raise it.`,
        );
      }
    }
  }

  /** Everything the apps need to show a counter and stop before dialling. */
  async allowance(user: User): Promise<RegionAllowance[]> {
    const regions = (user.regions ?? []) as Region[];
    const out: RegionAllowance[] = [];
    for (const region of regions) {
      if (!REGION_PROVIDER[region]) continue;
      out.push({
        region,
        manual: {
          daily: await this.bucket(user, region, 'manual', 'Daily'),
          monthly: await this.bucket(user, region, 'manual', 'Monthly'),
        },
        ai: {
          daily: await this.bucket(user, region, 'ai', 'Daily'),
          monthly: await this.bucket(user, region, 'ai', 'Monthly'),
        },
      });
    }
    return out;
  }

  private async bucket(
    user: User,
    region: Region,
    kind: CallKind,
    period: 'Daily' | 'Monthly',
  ): Promise<LimitUsage> {
    const limit = await this.limitFor(user, region, kind, period);
    const used = await this.used(user, region, kind, startOf(period));
    return {
      used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - used),
    };
  }
}

/** Local midnight, and the first of the local month. */
function startOf(period: 'Daily' | 'Monthly'): Date {
  const now = new Date();
  return period === 'Daily'
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : new Date(now.getFullYear(), now.getMonth(), 1);
}

export { CallingProvider };
