import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('dnc_entries')
@Unique('UQ_dnc_tenant_number', ['tenantId', 'phoneNumber'])
export class DncEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Owning tenant. */
  @Index()
  @Column({ type: 'uuid' })
  tenantId: string;

  /**
   * Stored normalised (digits, optional leading +) so lookups are exact.
   * Unique per tenant, not globally: a number one customer has suppressed says
   * nothing about another customer's relationship with that person.
   */
  @Column({ type: 'varchar', length: 32 })
  phoneNumber: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ type: 'uuid', nullable: true })
  addedById: string | null;

  @ManyToOne(() => User, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'addedById' })
  addedBy: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
