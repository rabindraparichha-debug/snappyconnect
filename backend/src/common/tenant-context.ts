import { AsyncLocalStorage } from 'async_hooks';
import { Injectable, InternalServerErrorException } from '@nestjs/common';

export interface TenantContextState {
  /**
   * Tenant every query in this request is confined to. `null` means unscoped —
   * only ever set for a super-admin acting across tenants, or for boot-time work
   * (seeding, migrations, provider webhooks that resolve their own tenant).
   */
  tenantId: string | null;
  /** True when the caller may legitimately read across tenants. */
  crossTenant: boolean;
}

const storage = new AsyncLocalStorage<TenantContextState>();

/**
 * Request-scoped "which tenant are we acting as". Held in AsyncLocalStorage
 * rather than passed down every call so the scoped repository can read it from
 * anywhere in the async tree without threading a tenant id through 200-odd
 * existing call sites.
 */
@Injectable()
export class TenantContext {
  /** Run `fn` with the given tenant in scope. */
  run<T>(state: TenantContextState, fn: () => T): T {
    return storage.run(state, fn);
  }

  /**
   * Run `fn` with no tenant filter. Reserved for platform-level work — tenant
   * provisioning, seeding, and webhook handlers that resolve their own tenant
   * from the provider payload before touching tenant data.
   */
  runUnscoped<T>(fn: () => T): T {
    return storage.run({ tenantId: null, crossTenant: true }, fn);
  }

  /** Current state, or undefined outside any request (cron, boot, tests). */
  get state(): TenantContextState | undefined {
    return storage.getStore();
  }

  get tenantId(): string | null {
    return storage.getStore()?.tenantId ?? null;
  }

  get crossTenant(): boolean {
    return storage.getStore()?.crossTenant ?? false;
  }

  /**
   * Tenant id for a write. Refuses rather than guessing: a row written without
   * a tenant is a row that leaks, so an unscoped write has to be an explicit
   * `runUnscoped` decision at the call site.
   */
  requireTenantId(): string {
    const id = this.tenantId;
    if (!id) {
      throw new InternalServerErrorException(
        'No tenant in scope for this operation. Wrap platform-level work in TenantContext.runUnscoped().',
      );
    }
    return id;
  }
}

/** Module-level accessor for code that cannot take a DI dependency. */
export const tenantContext = new TenantContext();
