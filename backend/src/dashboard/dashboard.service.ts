import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallStatus, Role, UserStatus } from '../common/enums';
import { CallLog } from '../calls/call-log.entity';
import { User } from '../users/user.entity';

const ANSWERED = [CallStatus.ANSWERED, CallStatus.COMPLETED];
const MISSED = [CallStatus.MISSED, CallStatus.NO_ANSWER];

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(CallLog)
    private readonly callLogsRepo: Repository<CallLog>,
  ) {}

  async stats(user: User) {
    const totalUsers = await this.usersRepo.count();
    const activeUsers = await this.usersRepo.count({ where: { status: UserStatus.ACTIVE } });

    const todayQb = () => {
      const qb = this.callLogsRepo
        .createQueryBuilder('call')
        .where('call.createdAt >= CURRENT_DATE');
      // Non-admins see stats for their own calls only.
      if (user.role !== Role.ADMIN) {
        qb.andWhere('call.userId = :id', { id: user.id });
      }
      return qb;
    };

    const todaysCalls = await todayQb().getCount();
    const answeredCalls = await todayQb()
      .andWhere('call.status IN (:...answered)', { answered: ANSWERED })
      .getCount();
    const missedCalls = await todayQb()
      .andWhere('call.status IN (:...missed)', { missed: MISSED })
      .getCount();
    const durationRow = await todayQb()
      .select('COALESCE(SUM(call.durationSeconds), 0)', 'total')
      .getRawOne<{ total: string }>();

    return {
      totalUsers,
      activeUsers,
      todaysCalls,
      answeredCalls,
      missedCalls,
      totalCallDurationSeconds: Number(durationRow?.total ?? 0),
    };
  }
}
