import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, Subscription } from 'rxjs';
import { Role } from './enums';
import { TenantContext, TenantContextState } from './tenant-context';

/** Header a super-admin sends to act inside one tenant (the admin panel uses it). */
export const TENANT_HEADER = 'x-tenant-id';

/**
 * Establishes the tenant scope for the lifetime of a request, from the
 * authenticated user. Runs as an interceptor rather than middleware because it
 * needs `req.user`, which the JWT guard only populates after middleware.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContext) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const state = this.resolve(request);

    // Subscribe inside the ALS scope so the whole handler chain — including
    // anything async it kicks off — sees the tenant.
    return new Observable((subscriber) => {
      let subscription: Subscription | undefined;
      this.tenantContext.run(state, () => {
        subscription = next.handle().subscribe(subscriber);
      });
      return () => subscription?.unsubscribe();
    });
  }

  private resolve(request: {
    user?: { role?: Role; tenantId?: string | null };
    headers?: Record<string, string | string[] | undefined>;
  }): TenantContextState {
    const user = request.user;

    // Unauthenticated route (login, password reset, provider webhooks). These
    // legitimately need to look across tenants — login resolves a user by email
    // before any tenant is known, and a webhook resolves its tenant from the
    // provider payload — so they run unscoped and are responsible for their own
    // filtering.
    if (!user) return { tenantId: null, crossTenant: true };

    if (user.role === Role.SUPER_ADMIN) {
      const header = request.headers?.[TENANT_HEADER];
      const impersonated = Array.isArray(header) ? header[0] : header;
      // Acting inside one tenant: scope normally, so the admin panel sees
      // exactly what that customer sees.
      if (impersonated) return { tenantId: impersonated, crossTenant: false };
      return { tenantId: null, crossTenant: true };
    }

    return { tenantId: user.tenantId ?? null, crossTenant: false };
  }
}
