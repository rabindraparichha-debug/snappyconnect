import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum SmsBatchStatus {
  SCHEDULED = 'scheduled',
  SENDING = 'sending',
  COMPLETED = 'completed',
  CANCELED = 'canceled',
}

/** A scheduled bulk send: one message dripped to up to 50 contacts. */
@Entity('sms_batches')
export class SmsBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'timestamptz' })
  scheduledAt: Date;

  @Column({ type: 'varchar', length: 20, default: SmsBatchStatus.SCHEDULED })
  @Index()
  status: SmsBatchStatus;

  @Column({ type: 'int', default: 0 })
  total: number;

  @Column({ type: 'int', default: 0 })
  sent: number;

  @Column({ type: 'int', default: 0 })
  failed: number;

  /** DNC / opted-out numbers refused at send time. */
  @Column({ type: 'int', default: 0 })
  skipped: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** One recipient inside a batch, with its own drip slot. */
@Entity('sms_batch_items')
export class SmsBatchItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  batchId: string;

  @Column()
  phoneNumber: string;

  @Column({ type: 'varchar', nullable: true })
  contactName: string | null;

  @Column({ type: 'timestamptz' })
  @Index()
  sendAt: Date;

  /** pending | sent | failed | skipped | canceled */
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  @Index()
  status: string;

  @Column({ type: 'varchar', nullable: true })
  error: string | null;
}
