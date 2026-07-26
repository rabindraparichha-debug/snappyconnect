import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Role } from '../common/enums';
import { User } from '../users/user.entity';
import { Notification, NotificationType } from './notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
  ) {}

  async create(
    userId: string,
    type: NotificationType,
    title: string,
    body?: string,
    referenceId?: string,
  ): Promise<Notification> {
    return this.repo.save(
      this.repo.create({ userId, type, title, body: body ?? null, referenceId: referenceId ?? null }),
    );
  }

  async findForUser(userId: string, limit = 20): Promise<Notification[]> {
    return this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.repo.count({ where: { userId, read: false } });
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.repo.update({ id, userId }, { read: true });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.repo.update({ userId, read: false }, { read: true });
  }

  async createFollowUpReminders(): Promise<number> {
    // This would be called by a cron or on dashboard load
    // For now, follow-up reminders are shown directly on the dashboard
    return 0;
  }
}
