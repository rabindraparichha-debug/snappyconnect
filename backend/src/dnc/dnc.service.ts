import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { toE164 } from '../contact-lists/csv.util';
import { TenantContext } from '../common/tenant-context';
import { User } from '../users/user.entity';
import { DncEntry } from './dnc-entry.entity';
import { InjectTenantRepository } from '../common/tenant-orm.module';

/**
 * Suppression list. Blocked numbers are held in memory as well as in the
 * database so a dial-time check — and bulk import screening — never costs a
 * query per number.
 *
 * The cache is keyed by tenant. A single shared set would apply one customer's
 * suppression list to every other customer, and let them infer its contents by
 * watching which numbers came back blocked.
 *
 * Everything is compared in E.164. A STOP arrives as "+16305551234"; with
 * punctuation-only matching, a recruiter typing "630-555-1234" slipped past
 * the block and could text someone who had opted out.
 */
@Injectable()
export class DncService {
  private readonly blockedByTenant = new Map<string, Set<string>>();

  constructor(
    @InjectTenantRepository(DncEntry)
    private readonly repo: Repository<DncEntry>,
    private readonly tenantContext: TenantContext,
  ) {}

  /**
   * The calling tenant's blocked numbers, loaded on first use and kept until a
   * write invalidates it. Loaded lazily rather than at boot because there is no
   * tenant in scope during startup.
   */
  async blockedSet(): Promise<Set<string>> {
    const tenantId = this.tenantContext.requireTenantId();
    const cached = this.blockedByTenant.get(tenantId);
    if (cached) return cached;

    const all = await this.repo.find({ select: { phoneNumber: true } });
    // Normalized on load too, so entries saved in older formats still match.
    const set = new Set(all.map((e) => toE164(e.phoneNumber)));
    this.blockedByTenant.set(tenantId, set);
    return set;
  }

  async isBlocked(phoneNumber: string): Promise<boolean> {
    return (await this.blockedSet()).has(toE164(phoneNumber));
  }

  async findAll(q?: string): Promise<DncEntry[]> {
    const qb = this.repo.createQueryBuilder('d').orderBy('d.createdAt', 'DESC').take(500);
    if (q?.trim()) {
      qb.andWhere('d.phoneNumber ILIKE :q', { q: `%${q.trim()}%` });
    }
    return qb.getMany();
  }

  async add(user: User, phoneNumber: string, reason?: string): Promise<DncEntry> {
    const normalized = toE164(phoneNumber);
    if (!normalized) throw new NotFoundException('A phone number is required');

    const existing = await this.repo.findOne({ where: { phoneNumber: normalized } });
    if (existing) throw new ConflictException('That number is already on the Do Not Call list');

    const entry = await this.repo.save(
      this.repo.create({
        phoneNumber: normalized,
        reason: reason ?? null,
        addedById: user.id,
      }),
    );
    (await this.blockedSet()).add(normalized);
    return entry;
  }

  async findOne(id: string): Promise<DncEntry> {
    const entry = await this.repo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Entry not found');
    return entry;
  }

  async remove(id: string): Promise<void> {
    const entry = await this.findOne(id);
    await this.repo.remove(entry);
    (await this.blockedSet()).delete(toE164(entry.phoneNumber));
  }

  /** Drop the calling tenant's cache so the next check re-reads the table. */
  async refresh(): Promise<void> {
    this.blockedByTenant.delete(this.tenantContext.requireTenantId());
    await this.blockedSet();
  }
}
