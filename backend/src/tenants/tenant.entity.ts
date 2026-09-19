import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TenantStatus } from '../common/enums';

/**
 * One customer of the platform — the isolation boundary every other table hangs
 * off. Mirrors the hosted-PBX convention: a tenant owns a `slug` that plays the
 * role of a SIP domain, so extensions and numbers only have to be unique
 * *within* a tenant.
 */
@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Display name shown in the UI and on invoices, e.g. "Acme Recruiting Inc." */
  @Column()
  name: string;

  /**
   * URL/domain-safe identifier, unique across the platform. Used as the PBX
   * domain for this tenant and as the sign-in hint on shared links.
   */
  @Column({ unique: true })
  slug: string;

  @Column({ type: 'enum', enum: TenantStatus, default: TenantStatus.ACTIVE })
  status: TenantStatus;

  /**
   * Identifier of the matching company in an external system (the ATS). Lets an
   * ATS company be resolved to its calling tenant without the ATS knowing our
   * ids. Unique when set, so two ATS companies can't share one tenant.
   */
  @Index({ unique: true, where: '"externalRef" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  externalRef: string | null;

  /** Where invoices and platform notices go. */
  @Column({ type: 'varchar', nullable: true })
  billingEmail: string | null;

  /** Paid seats. 0 means unmetered — enforcement is skipped entirely. */
  @Column({ type: 'int', default: 0 })
  seatLimit: number;

  /**
   * Regions this tenant is entitled to (india / usa / uae). A user's own
   * `regions` are intersected with this, so a tenant can never grant more than
   * it bought.
   */
  @Column({ type: 'simple-array', default: '' })
  regions: string[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
