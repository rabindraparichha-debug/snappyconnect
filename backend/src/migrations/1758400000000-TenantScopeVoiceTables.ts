import { MigrationInterface, QueryRunner } from 'typeorm';

/** Tables added after the first tenancy migration was written. */
const TABLES = ['voicemails', 'voice_requests'];

/**
 * Brings `voicemails` and `voice_requests` under tenant ownership.
 *
 * Both landed on main while the tenancy work was on a branch, so the original
 * migration never saw them. Without this they are shared across every customer:
 * one tenant's administrators could list another tenant's voicemails and the
 * voice-clone requests naming their recruiters.
 *
 * Existing rows are adopted by the tenant of the user they already belong to,
 * falling back to the default tenant for a voicemail with no owner (the column
 * is nullable — a message left on a line nobody claimed).
 */
export class TenantScopeVoiceTables1758400000000 implements MigrationInterface {
  name = 'TenantScopeVoiceTables1758400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(`SELECT "id" FROM "tenants" WHERE "slug" = 'default'`);
    const defaultTenantId = rows[0]?.id;
    if (!defaultTenantId) {
      throw new Error(
        'No default tenant found. Run the AddMultiTenancy migration before this one.',
      );
    }

    for (const table of TABLES) {
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "tenantId" uuid`);
      // Inherit from the owning user where there is one...
      await queryRunner.query(`
        UPDATE "${table}" t
        SET "tenantId" = u."tenantId"
        FROM "users" u
        WHERE t."userId" = u."id" AND t."tenantId" IS NULL
      `);
      // ...and fall back for rows whose owner is missing or null.
      await queryRunner.query(`UPDATE "${table}" SET "tenantId" = $1 WHERE "tenantId" IS NULL`, [
        defaultTenantId,
      ]);
      await queryRunner.query(`ALTER TABLE "${table}" ALTER COLUMN "tenantId" SET NOT NULL`);
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "IDX_${table}_tenantId" ON "${table}" ("tenantId")`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_${table}_tenantId"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "tenantId"`);
    }
  }
}
