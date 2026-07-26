import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { AuditAction, AuditLog } from './audit-log.entity';

export interface AuditContext {
  targetId?: string | null;
  targetLabel?: string | null;
  ipAddress?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  /**
   * Never throws: an audit write must not be able to fail the action it is
   * recording. Failures are logged so they still surface in the API logs.
   */
  async record(
    actor: User | null,
    action: AuditAction,
    summary: string,
    ctx: AuditContext = {},
  ): Promise<void> {
    try {
      await this.repo.save(
        this.repo.create({
          actorId: actor?.id ?? null,
          actorEmail: actor?.email ?? null,
          action,
          summary: summary.slice(0, 500),
          targetId: ctx.targetId ?? null,
          targetLabel: ctx.targetLabel ?? null,
          ipAddress: ctx.ipAddress ?? null,
        }),
      );
    } catch (err) {
      this.logger.warn(`Failed to write audit entry for ${action}`, err as Error);
    }
  }

  async findAll(query: { action?: AuditAction; q?: string; limit?: number }) {
    const qb = this.repo
      .createQueryBuilder('a')
      .orderBy('a.createdAt', 'DESC')
      .take(Math.min(query.limit ?? 100, 500));

    if (query.action) qb.andWhere('a.action = :action', { action: query.action });
    if (query.q?.trim()) {
      qb.andWhere(
        '(a.summary ILIKE :q OR a.actorEmail ILIKE :q OR a.targetLabel ILIKE :q)',
        { q: `%${query.q.trim()}%` },
      );
    }
    return qb.getMany();
  }

  /** Summarise which fields changed, without ever recording secret values. */
  static describeChanges(
    before: Record<string, any>,
    after: Record<string, any>,
    fields: string[],
    secretFields: string[] = [],
  ): string {
    const parts: string[] = [];
    for (const field of fields) {
      const from = before?.[field];
      const to = after?.[field];
      if (to === undefined || JSON.stringify(from) === JSON.stringify(to)) continue;
      if (secretFields.includes(field)) {
        parts.push(`${field} changed`);
      } else {
        parts.push(`${field}: ${format(from)} → ${format(to)}`);
      }
    }
    return parts.length ? parts.join(', ') : 'no field changes';
  }
}

function format(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (Array.isArray(value)) return value.length ? value.join('/') : '(none)';
  return String(value);
}
