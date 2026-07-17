import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { Role, UserStatus } from '../common/enums';
import { AssignProviderDto } from './dto/assign-provider.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.usersRepo.findOne({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException('A user with this email already exists');

    const { password, ...rest } = dto;
    const user = this.usersRepo.create({
      ...rest,
      email: dto.email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
    });
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

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);

    if (dto.email && dto.email.toLowerCase() !== user.email) {
      const existing = await this.usersRepo.findOne({
        where: { email: dto.email.toLowerCase() },
      });
      if (existing) throw new ConflictException('A user with this email already exists');
      user.email = dto.email.toLowerCase();
    }

    const { password, email: _email, ...rest } = dto;
    Object.assign(user, rest);
    if (password) user.passwordHash = await bcrypt.hash(password, 10);

    const saved = await this.usersRepo.save(user);
    return this.sanitize(saved);
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
