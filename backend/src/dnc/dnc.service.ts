import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { toE164 } from '../contact-lists/csv.util';
import { User } from '../users/user.entity';
import { DncEntry } from './dnc-entry.entity';

/**
 * Suppression list. Blocked numbers are held in memory as well as in the
 * database so a dial-time check — and bulk import screening — never costs a
 * query per number. The cache is refreshed on every write.
 *
 * Everything is compared in E.164. A STOP arrives as "+16305551234"; with
 * punctuation-only matching, a recruiter typing "630-555-1234" slipped past
 * the block and could text someone who had opted out.
 */
@Injectable()
export class DncService implements OnModuleInit {
  private blocked = new Set<string>();

  constructor(
    @InjectRepository(DncEntry)
    private readonly repo: Repository<DncEntry>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh().catch(() => undefined);
  }

  async findAll(q?: string): Promise<DncEntry[]> {
    const qb = this.repo.createQueryBuilder('d').orderBy('d.createdAt', 'DESC').take(500);
    if (q?.trim()) {
      qb.where('d.phoneNumber ILIKE :q', { q: `%${q.trim()}%` });
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
    this.blocked.add(normalized);
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
    this.blocked.delete(toE164(entry.phoneNumber));
  }

  isBlocked(phoneNumber: string): boolean {
    return this.blocked.has(toE164(phoneNumber));
  }

  async refresh(): Promise<void> {
    const all = await this.repo.find({ select: { phoneNumber: true } });
    // Normalized on load too, so entries saved in older formats still match.
    this.blocked = new Set(all.map((e) => toE164(e.phoneNumber)));
  }
}
