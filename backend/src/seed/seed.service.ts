import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '../common/enums';
import { UsersService } from '../users/users.service';

/** Creates the initial admin account on first boot (from ADMIN_* env vars). */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const admins = await this.usersService.countAdmins();
    if (admins > 0) return;

    const email = this.config.get<string>('ADMIN_EMAIL', 'admin@snappyconnect.local');
    const password = this.config.get<string>('ADMIN_PASSWORD', 'admin123');
    const name = this.config.get<string>('ADMIN_NAME', 'Admin');

    await this.usersService.create({ name, email, password, role: Role.ADMIN });
    this.logger.log(`Seeded initial admin account: ${email}`);
  }
}
