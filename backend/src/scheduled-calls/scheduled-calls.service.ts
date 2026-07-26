import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../common/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { User } from '../users/user.entity';
import {
  CreateScheduledCallDto,
  UpdateScheduledCallDto,
} from './dto/scheduled-call.dto';
import { ScheduledCall, ScheduledCallStatus } from './scheduled-call.entity';

@Injectable()
export class ScheduledCallsService {
  private readonly logger = new Logger(ScheduledCallsService.name);

  constructor(
    @InjectRepository(ScheduledCall)
    private readonly repo: Repository<ScheduledCall>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(user: User, dto: CreateScheduledCallDto): Promise<ScheduledCall> {
    return this.repo.save(
      this.repo.create({
        userId: user.id,
        phoneNumber: dto.phoneNumber,
        contactName: dto.contactName ?? null,
        scheduledAt: new Date(dto.scheduledAt),
        notes: dto.notes ?? null,
        region: dto.region ?? null,
        status: ScheduledCallStatus.PENDING,
      }),
    );
  }

  async findAll(user: User, from?: string, to?: string): Promise<ScheduledCall[]> {
    const qb = this.repo
      .createQueryBuilder('sc')
      .leftJoinAndSelect('sc.user', 'user')
      .orderBy('sc.scheduledAt', 'ASC');

    if (user.role !== Role.ADMIN) {
      qb.andWhere('sc.userId = :uid', { uid: user.id });
    }
    if (from) qb.andWhere('sc.scheduledAt >= :from', { from: new Date(from) });
    if (to) qb.andWhere('sc.scheduledAt < :to', { to: new Date(new Date(to).getTime() + 86_400_000) });

    return qb.getMany();
  }

  async upcoming(user: User, limit = 10): Promise<ScheduledCall[]> {
    const qb = this.repo
      .createQueryBuilder('sc')
      .leftJoinAndSelect('sc.user', 'user')
      .where('sc.status = :pending', { pending: ScheduledCallStatus.PENDING })
      .andWhere('sc.scheduledAt >= now()')
      .orderBy('sc.scheduledAt', 'ASC')
      .take(limit);

    if (user.role !== Role.ADMIN) {
      qb.andWhere('sc.userId = :uid', { uid: user.id });
    }
    return qb.getMany();
  }

  async update(user: User, id: string, dto: UpdateScheduledCallDto): Promise<ScheduledCall> {
    const item = await this.getOwn(user, id);
    if (dto.phoneNumber !== undefined) item.phoneNumber = dto.phoneNumber;
    if (dto.contactName !== undefined) item.contactName = dto.contactName;
    if (dto.scheduledAt !== undefined) item.scheduledAt = new Date(dto.scheduledAt);
    if (dto.notes !== undefined) item.notes = dto.notes;
    if (dto.region !== undefined) item.region = dto.region;
    if (dto.status !== undefined) item.status = dto.status;
    return this.repo.save(item);
  }

  async remove(user: User, id: string): Promise<void> {
    const item = await this.getOwn(user, id);
    await this.repo.remove(item);
  }

  /** Notify owners of pending calls due within the next 15 minutes. */
  async sendDueReminders(): Promise<number> {
    const due = await this.repo
      .createQueryBuilder('sc')
      .where('sc.status = :pending', { pending: ScheduledCallStatus.PENDING })
      .andWhere('sc.reminderSent = false')
      .andWhere(`sc.scheduledAt <= now() + interval '15 minutes'`)
      .andWhere(`sc.scheduledAt >= now() - interval '1 hour'`)
      .getMany();

    for (const item of due) {
      await this.notificationsService
        .create(
          item.userId,
          NotificationType.FOLLOW_UP_DUE,
          `Scheduled call: ${item.contactName ?? item.phoneNumber}`,
          item.notes ?? undefined,
          item.id,
        )
        .catch((err) => this.logger.warn('Failed to create reminder', err));
      item.reminderSent = true;
    }
    if (due.length) await this.repo.save(due);
    return due.length;
  }

  private async getOwn(user: User, id: string): Promise<ScheduledCall> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Scheduled call not found');
    if (user.role !== Role.ADMIN && item.userId !== user.id) {
      throw new ForbiddenException('Not your scheduled call');
    }
    return item;
  }
}
