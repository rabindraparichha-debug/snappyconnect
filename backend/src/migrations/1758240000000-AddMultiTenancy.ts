import { MigrationInterface, QueryRunner } from 'typeorm';

/** Every table that becomes tenant-owned. */
const TENANT_TABLES = [
  'activity_logs',
  'audit_logs',
  'call_logs',
  'call_requests',
  'call_scripts',
  'contact_list_items',
  'contact_lists',
  'dnc_entries',
  'notifications',
  'scheduled_calls',
  'settings',
  'sms_batch_items',
  'sms_batches',
  'sms_logs',
  'users',
  'webhooks',
];

/**
 * Introduces multi-tenancy.
 *
 * The platform was single-tenant: one Telnyx credential set, one number pool
 * and one flat pool of users. This creates the `tenants` table, moves every
 * existing row into a single "default" tenant so nothing is orphaned, then
 * makes `tenantId` NOT NULL so a row can never be written without an owner.
 *
 * Constraints that were global become per-tenant: the settings key (which is
 * what pinned the platform to one provider account) and the DNC number.
 *
 * Backfill is deliberately a separate step from the NOT NULL: on a database
 * with existing rows, adding a NOT NULL column outright would fail.
 */
export class AddMultiTenancy1758240000000 implements MigrationInterface {
  name = 'AddMultiTenancy1758240000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- 1. Tenant status enum + tenants table ------------------------------
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "tenants_status_enum" AS ENUM ('active', 'suspended', 'canceled');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tenants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "slug" character varying NOT NULL,
        "status" "tenants_status_enum" NOT NULL DEFAULT 'active',
        "externalRef" character varying,
        "billingEmail" character varying,
        "seatLimit" integer NOT NULL DEFAULT 0,
        "regions" text NOT NULL DEFAULT '',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenants_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tenants_slug" UNIQUE ("slug")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenants_externalRef" ON "tenants" ("externalRef") WHERE "externalRef" IS NOT NULL`,
    );

    // --- 2. The tenant that adopts all pre-existing data --------------------
    // Named from env so a deployment can label it, but stable either way: the
    // slug is fixed, so re-running this migration cannot create a second one.
    const defaultName = process.env.DEFAULT_TENANT_NAME ?? 'Default';
    await queryRunner.query(
      `INSERT INTO "tenants" ("name", "slug", "status", "regions")
       VALUES ($1, 'default', 'active', 'india,usa,uae')
       ON CONFLICT ("slug") DO NOTHING`,
      [defaultName],
    );
    const [{ id: defaultTenantId }] = await queryRunner.query(
      `SELECT "id" FROM "tenants" WHERE "slug" = 'default'`,
    );

    // --- 3. tenantId on every tenant-owned table ----------------------------
    for (const table of TENANT_TABLES) {
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "tenantId" uuid`);
      await queryRunner.query(`UPDATE "${table}" SET "tenantId" = $1 WHERE "tenantId" IS NULL`, [
        defaultTenantId,
      ]);
      await queryRunner.query(`ALTER TABLE "${table}" ALTER COLUMN "tenantId" SET NOT NULL`);
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "IDX_${table}_tenantId" ON "${table}" ("tenantId")`,
      );
    }

    // Users cascade with their tenant; the rest are reachable only through a
    // user or a list, so a foreign key here is enough to prevent orphans.
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD CONSTRAINT "FK_users_tenantId"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
    `);

    // --- 4. Global constraints become per-tenant ----------------------------
    // The settings key being globally unique is precisely what made the
    // platform single-tenant.
    await queryRunner.query(`
      DO $$
      DECLARE c text;
      BEGIN
        FOR c IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = '"settings"'::regclass AND contype = 'u'
            AND conname <> 'UQ_settings_tenant_key'
        LOOP
          EXECUTE format('ALTER TABLE "settings" DROP CONSTRAINT %I', c);
        END LOOP;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE "settings" ADD CONSTRAINT "UQ_settings_tenant_key" UNIQUE ("tenantId", "key")`,
    );

    // A number one customer suppressed says nothing about another customer.
    // TypeORM's @Index({ unique: true }) produces a plain unique *index* with a
    // generated name, so both indexes and constraints have to be swept — and by
    // shape rather than by name, since the generated one is a content hash.
    await queryRunner.query(`
      DO $$
      DECLARE c text;
      BEGIN
        FOR c IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = '"dnc_entries"'::regclass AND contype = 'u'
            AND conname <> 'UQ_dnc_tenant_number'
        LOOP
          EXECUTE format('ALTER TABLE "dnc_entries" DROP CONSTRAINT %I', c);
        END LOOP;

        FOR c IN
          SELECT i.relname
          FROM pg_index x
          JOIN pg_class i ON i.oid = x.indexrelid
          JOIN pg_class t ON t.oid = x.indrelid
          WHERE t.relname = 'dnc_entries'
            AND x.indisunique
            AND NOT x.indisprimary
            AND pg_get_indexdef(x.indexrelid) LIKE '%phoneNumber%'
            AND pg_get_indexdef(x.indexrelid) NOT LIKE '%tenantId%'
        LOOP
          EXECUTE format('DROP INDEX %I', c);
        END LOOP;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE "dnc_entries" ADD CONSTRAINT "UQ_dnc_tenant_number" UNIQUE ("tenantId", "phoneNumber")`,
    );

    // --- 5. super_admin role ------------------------------------------------
    // Rebuilt rather than ALTER TYPE ... ADD VALUE, which cannot be used later
    // in the same transaction this migration runs in.
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`);
    await queryRunner.query(
      `CREATE TYPE "users_role_enum_new" AS ENUM ('super_admin', 'admin', 'user')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "users_role_enum_new" USING "role"::text::"users_role_enum_new"`,
    );
    await queryRunner.query(`DROP TYPE "users_role_enum"`);
    await queryRunner.query(`ALTER TYPE "users_role_enum_new" RENAME TO "users_role_enum"`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user'::"users_role_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Demote super-admins before the enum loses the value.
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`);
    await queryRunner.query(`UPDATE "users" SET "role" = 'admin' WHERE "role" = 'super_admin'`);
    await queryRunner.query(`CREATE TYPE "users_role_enum_old" AS ENUM ('admin', 'user')`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "users_role_enum_old" USING "role"::text::"users_role_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "users_role_enum"`);
    await queryRunner.query(`ALTER TYPE "users_role_enum_old" RENAME TO "users_role_enum"`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user'::"users_role_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "dnc_entries" DROP CONSTRAINT IF EXISTS "UQ_dnc_tenant_number"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_dnc_entries_phoneNumber" ON "dnc_entries" ("phoneNumber")`,
    );

    await queryRunner.query(
      `ALTER TABLE "settings" DROP CONSTRAINT IF EXISTS "UQ_settings_tenant_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "settings" ADD CONSTRAINT "UQ_settings_key" UNIQUE ("key")`,
    );

    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "FK_users_tenantId"`);
    for (const table of TENANT_TABLES) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_${table}_tenantId"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "tenantId"`);
    }

    await queryRunner.query(`DROP TABLE IF EXISTS "tenants"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tenants_status_enum"`);
  }
}
