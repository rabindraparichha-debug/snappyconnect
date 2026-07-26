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

  async search(user: User, q: string) {
    if (!q || q.trim().length < 2) return { calls: [], users: [], contacts: [] };
    const term = `%${q.trim()}%`;

    const callQb = this.callLogsRepo
      .createQueryBuilder('call')
      .leftJoinAndSelect('call.user', 'u')
      .where('(call.phoneNumber ILIKE :term OR call.contactName ILIKE :term OR call.notes ILIKE :term)', { term })
      .orderBy('call.createdAt', 'DESC')
      .take(10);
    if (user.role !== Role.ADMIN) {
      callQb.andWhere('call.userId = :uid', { uid: user.id });
    }
    const calls = await callQb.getMany();

    let users: User[] = [];
    if (user.role === Role.ADMIN) {
      users = await this.usersRepo
        .createQueryBuilder('user')
        .where('(user.name ILIKE :term OR user.email ILIKE :term)', { term })
        .take(5)
        .getMany();
    }

    const contactQb = this.callLogsRepo
      .createQueryBuilder('call')
      .select('call.phoneNumber', 'phoneNumber')
      .addSelect('MAX(call.contactName)', 'contactName')
      .addSelect('COUNT(*)::int', 'totalCalls')
      .addSelect('MAX(call.createdAt)', 'lastCallAt')
      .where('(call.phoneNumber ILIKE :term OR call.contactName ILIKE :term)', { term })
      .groupBy('call.phoneNumber')
      .orderBy('MAX(call.createdAt)', 'DESC')
      .limit(5);
    if (user.role !== Role.ADMIN) {
      contactQb.andWhere('call.userId = :uid', { uid: user.id });
    }
    const contacts = await contactQb.getRawMany();

    return { calls, users, contacts };
  }
}
