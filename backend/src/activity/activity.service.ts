import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ActivityLog, ActivityType } from './activity.entity';
import { InjectTenantRepository } from '../common/tenant-orm.module';

@Injectable()
export class ActivityService {
  constructor(
    @InjectTenantRepository(ActivityLog)
    private readonly repo: Repository<ActivityLog>,
  ) {}

  async log(
    type: ActivityType,
    summary: string,
    userId?: string | null,
    referenceId?: string | null,
  ): Promise<void> {
    await this.repo.save(
      this.repo.create({
        type,
        summary,
        userId: userId ?? null,
        referenceId: referenceId ?? null,
      }),
    );
  }

  async recent(limit = 20): Promise<ActivityLog[]> {
    return this.repo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
