import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { Role, TenantStatus, UserStatus } from '../common/enums';
import { TenantContext } from '../common/tenant-context';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';

/**
 * First-boot setup: the default tenant and the platform operator account.
 *
 * Runs outside any request, so there is no tenant in scope — everything here is
 * explicit about which tenant it writes to.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantsRepo: Repository<Tenant>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly tenantContext: TenantContext,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    await this.tenantContext.runUnscoped(async () => {
      const tenant = await this.ensureDefaultTenant();
      await this.ensureSuperAdmin(tenant);
    });
  }

  /**
   * The tenant that owns everything created before multi-tenancy existed. The
   * migration creates it too; this covers a database built from a fresh
   * migration run where the table is empty.
   */
  private async ensureDefaultTenant(): Promise<Tenant> {
    const existing = await this.tenantsRepo.findOne({ where: { slug: 'default' } });
    if (existing) return existing;

    const tenant = await this.tenantsRepo.save(
      this.tenantsRepo.create({
        name: this.config.get<string>('DEFAULT_TENANT_NAME', 'Default'),
        slug: 'default',
        status: TenantStatus.ACTIVE,
        regions: ['india', 'usa', 'uae'],
        seatLimit: 0,
      }),
    );
    this.logger.log(`Created the default tenant (${tenant.id})`);
    return tenant;
  }

  /**
   * Guarantee exactly one way into the platform-operator role.
   *
   * On an existing install every account is a tenant-level admin after the
   * migration, which would leave nobody able to manage tenants — so the account
   * named by ADMIN_EMAIL is promoted, and the promotion is logged rather than
   * done quietly.
   */
  private async ensureSuperAdmin(tenant: Tenant): Promise<void> {
    if ((await this.usersRepo.count({ where: { role: Role.SUPER_ADMIN } })) > 0) return;

    const email = this.config
      .get<string>('ADMIN_EMAIL', 'admin@snappyconnect.local')
      .toLowerCase();

    const existing = await this.usersRepo.findOne({ where: { email } });
    if (existing) {
      existing.role = Role.SUPER_ADMIN;
      await this.usersRepo.save(existing);
      this.logger.warn(
        `Promoted ${email} to super_admin — no platform operator existed after the multi-tenancy migration`,
      );
      return;
    }

    const password = this.config.get<string>('ADMIN_PASSWORD', 'admin123');
    const name = this.config.get<string>('ADMIN_NAME', 'Admin');
    await this.usersRepo.save(
      this.usersRepo.create({
        tenantId: tenant.id,
        name,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role: Role.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        regions: [],
        providerConfig: {},
      }),
    );
    this.logger.log(`Seeded the platform operator account: ${email}`);
  }
}
