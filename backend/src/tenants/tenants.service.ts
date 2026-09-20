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
import { Role, TenantStatus, UserStatus } from '../common/enums';
import { TenantContext } from '../common/tenant-context';
import { User } from '../users/user.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { Tenant } from './tenant.entity';

/** Slugs that would collide with platform routes or provider conventions. */
const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'billing',
  'console',
  'dashboard',
  'internal',
  'login',
  'platform',
  'public',
  'settings',
  'signup',
  'static',
  'support',
  'system',
  'www',
]);

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantsRepo: Repository<Tenant>,
    // Deliberately the unscoped repository: provisioning creates the very first
    // user of a tenant, before any tenant is in scope.
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly tenantContext: TenantContext,
  ) {}

  /**
   * Provision a tenant and its first administrator in one step. This is the
   * entry point an ATS calls when a company buys calling.
   */
  async create(dto: CreateTenantDto): Promise<Tenant> {
    const slug = dto.slug.toLowerCase();
    if (RESERVED_SLUGS.has(slug)) {
      throw new BadRequestException(`"${slug}" is reserved and cannot be used as a slug`);
    }

    return this.tenantContext.runUnscoped(async () => {
      if (await this.tenantsRepo.findOne({ where: { slug } })) {
        throw new ConflictException(`A tenant with the slug "${slug}" already exists`);
      }
      if (dto.externalRef) {
        const clash = await this.tenantsRepo.findOne({ where: { externalRef: dto.externalRef } });
        if (clash) {
          throw new ConflictException(
            `External reference "${dto.externalRef}" is already linked to tenant "${clash.slug}"`,
          );
        }
      }

      const adminEmail = dto.adminEmail.toLowerCase();
      // Email is unique platform-wide, so this has to be checked across every
      // tenant, not just the one being created.
      if (await this.usersRepo.findOne({ where: { email: adminEmail } })) {
        throw new ConflictException('A user with this email already exists');
      }

      const tenant = await this.tenantsRepo.save(
        this.tenantsRepo.create({
          name: dto.name,
          slug,
          externalRef: dto.externalRef ?? null,
          billingEmail: dto.billingEmail ?? null,
          seatLimit: dto.seatLimit ?? 0,
          regions: dto.regions ?? [],
          status: dto.status ?? TenantStatus.ACTIVE,
        }),
      );

      await this.usersRepo.save(
        this.usersRepo.create({
          tenantId: tenant.id,
          name: dto.adminName,
          email: adminEmail,
          passwordHash: await bcrypt.hash(dto.adminPassword, 10),
          role: Role.ADMIN,
          status: UserStatus.ACTIVE,
          regions: dto.regions ?? [],
          providerConfig: {},
        }),
      );

      this.logger.log(`Provisioned tenant ${tenant.slug} (${tenant.id}) with admin ${adminEmail}`);
      return tenant;
    });
  }

  async findAll(): Promise<Tenant[]> {
    return this.tenantsRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findById(id: string): Promise<Tenant> {
    const tenant = await this.tenantsRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async findBySlug(slug: string): Promise<Tenant> {
    const tenant = await this.tenantsRepo.findOne({ where: { slug: slug.toLowerCase() } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  /** Resolve the tenant behind an ATS company id. */
  async findByExternalRef(externalRef: string): Promise<Tenant> {
    const tenant = await this.tenantsRepo.findOne({ where: { externalRef } });
    if (!tenant) throw new NotFoundException('No tenant is linked to that external reference');
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    const tenant = await this.findById(id);

    if (dto.externalRef && dto.externalRef !== tenant.externalRef) {
      const clash = await this.tenantsRepo.findOne({ where: { externalRef: dto.externalRef } });
      if (clash && clash.id !== id) {
        throw new ConflictException(
          `External reference "${dto.externalRef}" is already linked to tenant "${clash.slug}"`,
        );
      }
    }

    Object.assign(tenant, dto);
    return this.tenantsRepo.save(tenant);
  }

  async setStatus(id: string, status: TenantStatus): Promise<Tenant> {
    const tenant = await this.findById(id);
    tenant.status = status;
    return this.tenantsRepo.save(tenant);
  }

  /**
   * Set aside a number on the shared Telnyx account for this tenant. Refuses a
   * number another tenant already holds, so a reservation cannot be moved by
   * accident while it is in use.
   */
  async reserveNumber(tenantId: string, phoneNumber: string): Promise<Tenant> {
    const tenant = await this.findById(tenantId);
    const holder = await this.tenantsRepo
      .createQueryBuilder('t')
      .where(':number = ANY(string_to_array(t."reservedNumbers", \',\'))', { number: phoneNumber })
      .andWhere('t.id != :tenantId', { tenantId })
      .getOne();
    if (holder) {
      throw new ConflictException(
        `${phoneNumber} is already reserved for "${holder.slug}".`,
      );
    }

    const reserved = tenant.reservedNumbers ?? [];
    if (!reserved.includes(phoneNumber)) {
      tenant.reservedNumbers = [...reserved, phoneNumber];
      await this.tenantsRepo.save(tenant);
      this.logger.log(`Reserved ${phoneNumber} for tenant ${tenant.slug}`);
    }
    return tenant;
  }

  /**
   * Return a number to the shared pool. Refuses while a recruiter still has it
   * as their direct line, since releasing it would leave their line reachable
   * but re-assignable to another customer.
   */
  async releaseNumber(tenantId: string, phoneNumber: string): Promise<Tenant> {
    const tenant = await this.findById(tenantId);
    const inUse = await this.tenantContext.runUnscoped(() =>
      this.usersRepo
        .createQueryBuilder('u')
        .where(`u."providerConfig" ->> 'telnyxNumber' = :number`, { number: phoneNumber })
        .getOne(),
    );
    if (inUse) {
      throw new BadRequestException(
        `${phoneNumber} is still assigned to ${inUse.email}. Remove their direct line first.`,
      );
    }

    tenant.reservedNumbers = (tenant.reservedNumbers ?? []).filter((n) => n !== phoneNumber);
    await this.tenantsRepo.save(tenant);
    return tenant;
  }

  /** Active users against the purchased seat count. */
  async seatUsage(id: string): Promise<{ used: number; limit: number }> {
    const tenant = await this.findById(id);
    const used = await this.tenantContext.runUnscoped(() =>
      this.usersRepo.count({ where: { tenantId: id, status: UserStatus.ACTIVE } }),
    );
    return { used, limit: tenant.seatLimit };
  }

  /**
   * Refuse to add a seat beyond what the tenant bought. `seatLimit` of 0 means
   * unmetered, so the check is skipped entirely.
   */
  async assertSeatAvailable(tenantId: string): Promise<void> {
    const { used, limit } = await this.seatUsage(tenantId);
    if (limit > 0 && used >= limit) {
      throw new BadRequestException(
        `This account is using all ${limit} of its seats. Remove a user or increase the seat count.`,
      );
    }
  }
}
