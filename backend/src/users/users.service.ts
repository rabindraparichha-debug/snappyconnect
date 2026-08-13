import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { Region, Role, UserStatus } from '../common/enums';
import { SipPoolService } from '../providers/sip-pool.service';
import { AssignProviderDto } from './dto/assign-provider.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly sipPool: SipPoolService,
  ) {}

  /**
   * Serially auto-assign the lowest free Asterisk extension to a UAE user
   * that has none. Mutates (does not save) the user; a full pool just logs —
   * account creation must never fail over line availability.
   */
  private async autoAssignSipLine(user: User): Promise<void> {
    if (!(user.regions ?? []).includes(Region.UAE)) return;
    if (user.providerConfig?.sipUsername) return;

    const all = await this.usersRepo.find();
    const taken = new Set<string>(
      all.map((u) => u.providerConfig?.sipUsername).filter(Boolean),
    );
    const line = await this.sipPool.nextFree(taken);
    if (!line) {
      if ((await this.sipPool.pool()).length > 0) {
        this.logger.warn(`SIP pool exhausted — ${user.email} has no line`);
      }
      return;
    }
    user.providerConfig = {
      ...(user.providerConfig ?? {}),
      sipUsername: line.username,
      sipPassword: line.password,
    };
  }

  /**
   * Serially auto-assign a free board-line IVR digit (1–9) to a USA user
   * that has none, so the existing greeting menu ("press N for …") routes
   * inbound callers to them. The greeting expands the live extension list
   * automatically, so no other change is needed. Digits exhausted -> logged.
   */
  private async autoAssignIvrDigit(user: User): Promise<void> {
    if (!(user.regions ?? []).includes(Region.USA)) return;
    if (user.providerConfig?.ivrDigit) return;

    const all = await this.usersRepo.find();
    const taken = new Set<string>(
      all
        .filter((u) => u.id !== user.id)
        .map((u) => (u.providerConfig?.ivrDigit ? String(u.providerConfig.ivrDigit) : null))
        .filter(Boolean) as string[],
    );
    const digit = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].find(
      (d) => !taken.has(d),
    );
    if (!digit) {
      this.logger.warn(`All 9 IVR digits taken — ${user.email} not on the board menu`);
      return;
    }
    user.providerConfig = { ...(user.providerConfig ?? {}), ivrDigit: digit };
  }

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.usersRepo.findOne({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException('A user with this email already exists');

    const { password, ...rest } = dto;
    const user = this.usersRepo.create({
      ...rest,
      email: dto.email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
    });
    await this.autoAssignSipLine(user);
    await this.autoAssignIvrDigit(user);
    const saved = await this.usersRepo.save(user);
    return this.sanitize(saved);
  }

  async findAll(query: QueryUsersDto) {
    const { search, status, provider, page = 1, limit = 20 } = query;
    const qb = this.usersRepo.createQueryBuilder('user');

    if (search) {
      qb.andWhere(
        '(user.name ILIKE :search OR user.email ILIKE :search OR user.mobileNumber ILIKE :search)',
        { search: `%${search}%` },
      );
    }
    if (status) qb.andWhere('user.status = :status', { status });
    if (provider) qb.andWhere('user.provider = :provider', { provider });

    qb.orderBy('user.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }

  async findById(id: string): Promise<User> {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: email.toLowerCase() })
      .getOne();
  }

  /** Store a password-reset challenge (hash only) with its expiry. */
  async setResetToken(id: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.usersRepo.update(id, {
      resetTokenHash: tokenHash,
      resetExpiresAt: expiresAt,
    });
  }

  async findByResetTokenHash(tokenHash: string): Promise<User | null> {
    return this.usersRepo
      .createQueryBuilder('user')
      .addSelect(['user.resetTokenHash', 'user.resetExpiresAt'])
      .where('user.resetTokenHash = :tokenHash', { tokenHash })
      .getOne();
  }

  /** Set a new password and burn the reset challenge so the link can't reused. */
  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.usersRepo.update(id, {
      passwordHash,
      resetTokenHash: null,
      resetExpiresAt: null,
    });
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);

    if (dto.email && dto.email.toLowerCase() !== user.email) {
      const existing = await this.usersRepo.findOne({
        where: { email: dto.email.toLowerCase() },
      });
      if (existing) throw new ConflictException('A user with this email already exists');
      user.email = dto.email.toLowerCase();
    }

    const { password, email: _email, providerConfig, ...rest } = dto;
    Object.assign(user, rest);
    // providerConfig holds settings from several places (SIP account, Telnyx
    // line, IVR digit) — merge so editing one screen can't wipe the others.
    if (providerConfig) {
      user.providerConfig = { ...(user.providerConfig ?? {}), ...providerConfig };
    }
    if (password) user.passwordHash = await bcrypt.hash(password, 10);

    // Granting UAE access to an existing user picks up a line the same way
    // creation does.
    await this.autoAssignSipLine(user);
    await this.autoAssignIvrDigit(user);
    const saved = await this.usersRepo.save(user);
    return this.sanitize(saved);
  }

  /** Self-service: a user edits their own voicemail greeting / ring time. */
  async updateOwnVoicemail(
    id: string,
    dto: { voicemailGreeting?: string; ringSeconds?: number },
  ): Promise<User> {
    const user = await this.findById(id);
    const cfg = { ...(user.providerConfig ?? {}) };
    if (dto.voicemailGreeting !== undefined) {
      const text = dto.voicemailGreeting.trim();
      if (text) cfg.voicemailGreeting = text;
      else delete cfg.voicemailGreeting;
    }
    if (dto.ringSeconds !== undefined) cfg.ringSeconds = dto.ringSeconds;
    user.providerConfig = cfg;
    return this.sanitize(await this.usersRepo.save(user));
  }

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    if (user.role === Role.ADMIN) {
      const adminCount = await this.usersRepo.count({ where: { role: Role.ADMIN } });
      if (adminCount <= 1) throw new BadRequestException('Cannot delete the last admin');
    }
    await this.usersRepo.remove(user);
  }

  async setStatus(id: string, status: UserStatus): Promise<User> {
    const user = await this.findById(id);
    user.status = status;
    return this.usersRepo.save(user);
  }

  async assignProvider(id: string, dto: AssignProviderDto): Promise<User> {
    const user = await this.findById(id);
    user.provider = dto.provider;
    if (dto.providerConfig) {
      user.providerConfig = { ...user.providerConfig, ...dto.providerConfig };
    }
    return this.usersRepo.save(user);
  }

  async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOne();
    if (!user) throw new NotFoundException('User not found');

    const ok = await bcrypt.compare(currentPassword, user.passwordHash ?? '');
    if (!ok) throw new BadRequestException('Current password is incorrect');

    if (currentPassword === newPassword) {
      throw new BadRequestException('The new password must differ from the current one');
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.usersRepo.save(user);
  }

  async countAdmins(): Promise<number> {
    return this.usersRepo.count({ where: { role: Role.ADMIN } });
  }

  private sanitize(user: User): User {
    delete user.passwordHash;
    return user;
  }
}
