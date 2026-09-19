import { Column, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

/**
 * One row per settings namespace *per tenant* (e.g. "telnyx", "grandstream",
 * "dinstar"). Value is an encrypted JSON blob.
 *
 * The key used to be globally unique, which is what made the platform
 * single-tenant: one Telnyx credential set and one number pool for everybody.
 * It is now unique only within a tenant, so each customer carries its own
 * provider credentials and numbers.
 */
@Entity('settings')
@Unique('UQ_settings_tenant_key', ['tenantId', 'key'])
export class Setting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId: string;

  @Column()
  key: string;

  @Column({ type: 'text' })
  value: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
