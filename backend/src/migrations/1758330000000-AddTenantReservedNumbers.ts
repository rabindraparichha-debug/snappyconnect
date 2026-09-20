import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Numbers on the shared Telnyx account set aside for one tenant.
 *
 * Without this, every tenant is offered every unassigned number on the account
 * — including ones bought for another customer — so "per-tenant numbers" is
 * only enforced by whichever list the UI happens to render.
 *
 * Defaults to empty, which means "any unassigned number": the behaviour the
 * platform's own tenant had before tenants existed.
 */
export class AddTenantReservedNumbers1758330000000 implements MigrationInterface {
  name = 'AddTenantReservedNumbers1758330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "reservedNumbers" text NOT NULL DEFAULT ''`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "reservedNumbers"`);
  }
}
