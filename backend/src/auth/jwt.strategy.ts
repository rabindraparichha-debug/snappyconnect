import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Role, TenantStatus, UserStatus } from '../common/enums';
import { TenantsService } from '../tenants/tenants.service';
import { UsersService } from '../users/users.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  /** Tenant the token was issued for. */
  tid: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
    private readonly tenantsService: TenantsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'dev-secret'),
    });
  }

  async validate(payload: JwtPayload) {
    // Runs before the tenant-context interceptor, so there is no tenant in
    // scope yet and this lookup is deliberately unscoped — the token is what
    // establishes which tenant the request belongs to.
    const user = await this.usersService.findById(payload.sub).catch(() => null);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is inactive or no longer exists');
    }

    // A token whose tenant no longer matches the account is stale — the user
    // was moved — and must not keep reaching the old tenant's data.
    if (payload.tid && payload.tid !== user.tenantId) {
      throw new UnauthorizedException('Session is no longer valid. Sign in again.');
    }

    const tenant = await this.tenantsService.findById(user.tenantId).catch(() => null);
    if (!tenant) throw new UnauthorizedException('Account is inactive or no longer exists');
    // A super-admin keeps access to the platform while a tenant is suspended,
    // since suspension is usually something they are acting on.
    if (tenant.status !== TenantStatus.ACTIVE && user.role !== Role.SUPER_ADMIN) {
      throw new UnauthorizedException(
        tenant.status === TenantStatus.SUSPENDED
          ? 'This account is suspended. Contact support.'
          : 'This account has been closed.',
      );
    }

    return user;
  }
}
