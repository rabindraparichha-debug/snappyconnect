import { DynamicModule, Global, Inject, Module, Provider } from '@nestjs/common';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { TenantContext } from './tenant-context';
import { tenantScoped } from './tenant-scoped.repository';

function tokenFor(entity: EntityTarget<ObjectLiteral>): string {
  const name =
    typeof entity === 'function' ? entity.name : String((entity as { name?: string }).name ?? entity);
  return `TENANT_REPOSITORY_${name}`;
}

/**
 * Inject a repository that is automatically confined to the tenant in scope.
 *
 * Drop-in for `@InjectRepository`: the injected value is still a
 * `Repository<T>`, so existing query call sites are unchanged — only the
 * decorator on the constructor parameter differs.
 */
export const InjectTenantRepository = (entity: EntityTarget<ObjectLiteral>) => Inject(tokenFor(entity));

@Global()
@Module({
  providers: [TenantContext],
  exports: [TenantContext],
})
export class TenantOrmModule {
  /**
   * Register tenant-scoped repositories for the given entities, mirroring
   * `TypeOrmModule.forFeature`. The entities must still be registered with
   * TypeORM itself (via `autoLoadEntities` or `forFeature`).
   */
  static forFeature(entities: EntityTarget<ObjectLiteral>[]): DynamicModule {
    const providers: Provider[] = entities.map((entity) => ({
      provide: tokenFor(entity),
      inject: [DataSource, TenantContext],
      useFactory: (dataSource: DataSource, ctx: TenantContext) =>
        tenantScoped(dataSource.getRepository(entity), ctx),
    }));

    return {
      module: TenantOrmModule,
      providers,
      exports: providers.map((p) => (p as { provide: string }).provide),
    };
  }
}
