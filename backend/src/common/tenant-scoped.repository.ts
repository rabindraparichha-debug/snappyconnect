import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { TenantContext } from './tenant-context';

/** Column every tenant-owned entity carries. */
export const TENANT_COLUMN = 'tenantId';

/** Methods whose first argument is a Find*Options object with a `where` inside. */
const OPTIONS_METHODS = new Set([
  'find',
  'findAndCount',
  'findOne',
  'findOneOrFail',
  'count',
  'exists',
  'exist',
  'sum',
  'average',
  'minimum',
  'maximum',
]);

/** Methods whose first argument is itself the `where` clause. */
const WHERE_METHODS = new Set([
  'findBy',
  'findAndCountBy',
  'findOneBy',
  'findOneByOrFail',
  'countBy',
  'existsBy',
  'sumBy',
  'averageBy',
  'minimumBy',
  'maximumBy',
]);

/** Methods whose first argument is a mutation criteria. */
const CRITERIA_METHODS = new Set(['update', 'delete', 'softDelete', 'restore', 'increment', 'decrement']);

/**
 * Merge the tenant filter into a `where`, preserving TypeORM's array-means-OR
 * semantics: each branch of the OR has to be constrained, or the filter is
 * trivially bypassed by whichever branch is missing it.
 */
function scopeWhere(where: unknown, tenantId: string): unknown {
  if (Array.isArray(where)) {
    return where.map((branch) => ({ ...(branch as object), [TENANT_COLUMN]: tenantId }));
  }
  if (where && typeof where === 'object') {
    return { ...(where as object), [TENANT_COLUMN]: tenantId };
  }
  return { [TENANT_COLUMN]: tenantId };
}

/** Stamp the tenant onto an entity (or array of entities) about to be written. */
function stamp<T extends ObjectLiteral>(entity: T | T[], tenantId: string): T | T[] {
  if (Array.isArray(entity)) {
    return entity.map((e) => stamp(e, tenantId) as T);
  }
  if (entity && typeof entity === 'object') {
    // An explicit tenantId already on the object is honoured, so a super-admin
    // acting on a chosen tenant is not silently overwritten.
    if ((entity as ObjectLiteral)[TENANT_COLUMN] == null) {
      (entity as ObjectLiteral)[TENANT_COLUMN] = tenantId;
    }
  }
  return entity;
}

/**
 * Wrap a repository so every read, write and delete is confined to the tenant
 * currently in scope.
 *
 * This exists because the alternative — adding `tenantId` by hand to ~200
 * existing query sites — fails open: a site that is missed returns another
 * customer's data and looks entirely normal in review. Here the default is
 * closed, and crossing tenants has to be spelled out via
 * `TenantContext.runUnscoped()`.
 *
 * Entities without a `tenantId` column (the tenants table itself, and any
 * genuinely global table) are passed through untouched.
 */
export function tenantScoped<T extends ObjectLiteral>(
  repo: Repository<T>,
  ctx: TenantContext,
): Repository<T> {
  const hasTenantColumn = repo.metadata.columns.some((c) => c.propertyName === TENANT_COLUMN);
  if (!hasTenantColumn) return repo;

  return new Proxy(repo, {
    get(target, prop: string, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== 'function') return original;

      // Unscoped context (platform work, super-admin) gets the raw repository.
      const activeTenant = () => (ctx.crossTenant ? null : ctx.tenantId);

      if (OPTIONS_METHODS.has(prop)) {
        return function (this: unknown, options?: Record<string, unknown>, ...rest: unknown[]) {
          const tenantId = activeTenant();
          if (!tenantId) return original.apply(target, [options, ...rest]);
          const next = { ...(options ?? {}) };
          next.where = scopeWhere(next.where, tenantId);
          return original.apply(target, [next, ...rest]);
        };
      }

      if (WHERE_METHODS.has(prop)) {
        return function (this: unknown, where?: unknown, ...rest: unknown[]) {
          const tenantId = activeTenant();
          if (!tenantId) return original.apply(target, [where, ...rest]);
          return original.apply(target, [scopeWhere(where, tenantId), ...rest]);
        };
      }

      if (CRITERIA_METHODS.has(prop)) {
        return function (this: unknown, criteria: unknown, ...rest: unknown[]) {
          const tenantId = activeTenant();
          if (!tenantId) return original.apply(target, [criteria, ...rest]);
          // An id or array of ids is a valid criteria too; narrow it to an
          // object so the tenant condition can be ANDed on.
          const scoped =
            typeof criteria === 'string' || typeof criteria === 'number'
              ? { id: criteria, [TENANT_COLUMN]: tenantId }
              : Array.isArray(criteria) && criteria.every((c) => typeof c !== 'object')
                ? criteria.map((id) => ({ id, [TENANT_COLUMN]: tenantId }))
                : scopeWhere(criteria, tenantId);
          return original.apply(target, [scoped, ...rest]);
        };
      }

      if (prop === 'save' || prop === 'insert') {
        return function (this: unknown, entity: ObjectLiteral | ObjectLiteral[], ...rest: unknown[]) {
          const tenantId = activeTenant();
          if (!tenantId) return original.apply(target, [entity, ...rest]);
          return original.apply(target, [stamp(entity, tenantId), ...rest]);
        };
      }

      if (prop === 'create') {
        return function (this: unknown, plain?: ObjectLiteral | ObjectLiteral[], ...rest: unknown[]) {
          const created = original.apply(target, plain === undefined ? [] : [plain, ...rest]);
          const tenantId = activeTenant();
          if (!tenantId || created == null) return created;
          return stamp(created as ObjectLiteral, tenantId);
        };
      }

      if (prop === 'createQueryBuilder') {
        return function (this: unknown, ...args: unknown[]) {
          const qb = original.apply(target, args) as SelectQueryBuilder<T>;
          const tenantId = activeTenant();
          if (!tenantId) return qb;
          // Unique parameter name so it cannot collide with a caller's own.
          return qb.andWhere(`${qb.alias}.${TENANT_COLUMN} = :__scopedTenantId`, {
            __scopedTenantId: tenantId,
          });
        };
      }

      return original.bind(target);
    },
  });
}
