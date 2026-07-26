import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role } from '../common/enums';
import { User } from '../users/user.entity';
import {
  ContactItemStatus,
  ContactList,
  ContactListItem,
} from './contact-list.entity';
import { normalizePhone, parseCsv } from './csv.util';
import {
  CreateContactListDto,
  ImportCsvDto,
  UpdateContactItemDto,
  UpdateContactListDto,
} from './dto/contact-list.dto';

export interface ImportResult {
  imported: number;
  duplicates: number;
  invalid: number;
  blocked: number;
}

@Injectable()
export class ContactListsService {
  constructor(
    @InjectRepository(ContactList)
    private readonly listsRepo: Repository<ContactList>,
    @InjectRepository(ContactListItem)
    private readonly itemsRepo: Repository<ContactListItem>,
  ) {}

  async findAll(user: User) {
    const qb = this.listsRepo
      .createQueryBuilder('list')
      .leftJoinAndSelect('list.owner', 'owner')
      .orderBy('list.createdAt', 'DESC');
    if (user.role !== Role.ADMIN) {
      qb.where('list.ownerId = :uid', { uid: user.id });
    }
    const lists = await qb.getMany();

    // Counts per list so the index can show progress without loading items.
    const counts = await this.itemsRepo
      .createQueryBuilder('item')
      .select('item.listId', 'listId')
      .addSelect('COUNT(*)::int', 'total')
      .addSelect(
        `COUNT(*) FILTER (WHERE item.status = '${ContactItemStatus.CALLED}')::int`,
        'called',
      )
      .where('item.listId IN (:...ids)', { ids: lists.map((l) => l.id).length ? lists.map((l) => l.id) : [null] })
      .groupBy('item.listId')
      .getRawMany();

    const byId = new Map(counts.map((c) => [c.listId, c]));
    return lists.map((list) => ({
      ...list,
      totalContacts: byId.get(list.id)?.total ?? 0,
      calledContacts: byId.get(list.id)?.called ?? 0,
    }));
  }

  async create(user: User, dto: CreateContactListDto): Promise<ContactList> {
    return this.listsRepo.save(
      this.listsRepo.create({
        name: dto.name,
        description: dto.description ?? null,
        ownerId: user.id,
      }),
    );
  }

  async update(user: User, id: string, dto: UpdateContactListDto): Promise<ContactList> {
    const list = await this.getOwn(user, id);
    if (dto.name !== undefined) list.name = dto.name;
    if (dto.description !== undefined) list.description = dto.description;
    return this.listsRepo.save(list);
  }

  async remove(user: User, id: string): Promise<void> {
    const list = await this.getOwn(user, id);
    await this.listsRepo.remove(list);
  }

  async items(user: User, listId: string, status?: ContactItemStatus) {
    await this.getOwn(user, listId);
    const where: Record<string, unknown> = { listId };
    if (status) where.status = status;
    return this.itemsRepo.find({ where, order: { position: 'ASC' }, take: 1000 });
  }

  /**
   * Append CSV rows to a list. Numbers already in the list are counted as
   * duplicates rather than inserted twice, and rows without a usable phone
   * number are reported back so the importer can show what was dropped.
   */
  async importCsv(
    user: User,
    listId: string,
    dto: ImportCsvDto,
    isBlocked: (phone: string) => boolean,
  ): Promise<ImportResult> {
    await this.getOwn(user, listId);

    const rows = parseCsv(dto.csv);
    if (rows.length < 2) {
      throw new BadRequestException('CSV needs a header row and at least one data row');
    }

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const phoneIdx = header.indexOf(dto.phoneColumn.trim().toLowerCase());
    if (phoneIdx === -1) {
      throw new BadRequestException(`Column "${dto.phoneColumn}" not found in the CSV header`);
    }
    const idxOf = (col?: string) =>
      col ? header.indexOf(col.trim().toLowerCase()) : -1;
    const nameIdx = idxOf(dto.nameColumn);
    const emailIdx = idxOf(dto.emailColumn);
    const notesIdx = idxOf(dto.notesColumn);

    const existing = await this.itemsRepo.find({
      where: { listId },
      select: { phoneNumber: true },
    });
    const seen = new Set(existing.map((e) => e.phoneNumber));

    const maxRow = await this.itemsRepo
      .createQueryBuilder('item')
      .select('COALESCE(MAX(item.position), -1)', 'max')
      .where('item.listId = :listId', { listId })
      .getRawOne<{ max: string }>();
    let position = Number(maxRow?.max ?? -1) + 1;

    const result: ImportResult = { imported: 0, duplicates: 0, invalid: 0, blocked: 0 };
    const toInsert: ContactListItem[] = [];

    for (const row of rows.slice(1)) {
      const phone = normalizePhone(row[phoneIdx] ?? '');
      if (!phone || phone.replace('+', '').length < 6) {
        result.invalid++;
        continue;
      }
      if (seen.has(phone)) {
        result.duplicates++;
        continue;
      }
      seen.add(phone);

      const blocked = isBlocked(phone);
      if (blocked) result.blocked++;

      toInsert.push(
        this.itemsRepo.create({
          listId,
          phoneNumber: phone,
          name: nameIdx >= 0 ? row[nameIdx]?.trim() || null : null,
          email: emailIdx >= 0 ? row[emailIdx]?.trim() || null : null,
          notes: notesIdx >= 0 ? row[notesIdx]?.trim() || null : null,
          status: blocked ? ContactItemStatus.BLOCKED : ContactItemStatus.PENDING,
          position: position++,
        }),
      );
      result.imported++;
    }

    if (toInsert.length) await this.itemsRepo.save(toInsert, { chunk: 200 });
    return result;
  }

  async updateItem(user: User, itemId: string, dto: UpdateContactItemDto): Promise<ContactListItem> {
    const item = await this.itemsRepo.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Contact not found');
    await this.getOwn(user, item.listId);

    if (dto.name !== undefined) item.name = dto.name;
    if (dto.phoneNumber !== undefined) item.phoneNumber = normalizePhone(dto.phoneNumber);
    if (dto.email !== undefined) item.email = dto.email;
    if (dto.notes !== undefined) item.notes = dto.notes;
    if (dto.status !== undefined) {
      item.status = dto.status;
      if (dto.status === ContactItemStatus.CALLED) item.lastCalledAt = new Date();
    }
    return this.itemsRepo.save(item);
  }

  async removeItem(user: User, itemId: string): Promise<void> {
    const item = await this.itemsRepo.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Contact not found');
    await this.getOwn(user, item.listId);
    await this.itemsRepo.remove(item);
  }

  /** Next contact the power dialer should offer, or null when the list is done. */
  async nextPending(user: User, listId: string): Promise<ContactListItem | null> {
    await this.getOwn(user, listId);
    return this.itemsRepo.findOne({
      where: { listId, status: ContactItemStatus.PENDING },
      order: { position: 'ASC' },
    });
  }

  async progress(user: User, listId: string) {
    await this.getOwn(user, listId);
    const rows = await this.itemsRepo
      .createQueryBuilder('item')
      .select('item.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .where('item.listId = :listId', { listId })
      .groupBy('item.status')
      .getRawMany();

    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.count]));
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    return {
      total,
      pending: byStatus[ContactItemStatus.PENDING] ?? 0,
      called: byStatus[ContactItemStatus.CALLED] ?? 0,
      skipped: byStatus[ContactItemStatus.SKIPPED] ?? 0,
      blocked: byStatus[ContactItemStatus.BLOCKED] ?? 0,
    };
  }

  /** Re-queue every non-pending contact so a list can be worked again. */
  async resetList(user: User, listId: string): Promise<{ reset: number }> {
    await this.getOwn(user, listId);
    const res = await this.itemsRepo.update(
      { listId, status: In([ContactItemStatus.CALLED, ContactItemStatus.SKIPPED]) },
      { status: ContactItemStatus.PENDING },
    );
    return { reset: res.affected ?? 0 };
  }

  private async getOwn(user: User, id: string): Promise<ContactList> {
    const list = await this.listsRepo.findOne({ where: { id } });
    if (!list) throw new NotFoundException('List not found');
    if (user.role !== Role.ADMIN && list.ownerId !== user.id) {
      throw new ForbiddenException('Not your list');
    }
    return list;
  }
}
