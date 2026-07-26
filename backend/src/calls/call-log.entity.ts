import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CallDirection, CallDisposition, CallingProvider, CallSource, CallStatus, Region } from '../common/enums';
import { User } from '../users/user.entity';

@Entity('call_logs')
export class CallLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  @Index()
  @Column()
  phoneNumber: string;

  @Column({ type: 'enum', enum: CallingProvider })
  provider: CallingProvider;

  @Column({ type: 'enum', enum: CallDirection, default: CallDirection.OUTBOUND })
  direction: CallDirection;

  @Column({ type: 'enum', enum: CallStatus, default: CallStatus.INITIATED })
  status: CallStatus;

  @Column({ type: 'int', default: 0 })
  durationSeconds: number;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  externalId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  // ---- Phase 1: enrichment fields (all nullable for backward compat) ----

  @Column({ type: 'varchar', nullable: true })
  contactName: string | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  candidateId: string | null;

  @Column({ type: 'uuid', nullable: true })
  jobId: string | null;

  @Column({ type: 'uuid', nullable: true })
  companyId: string | null;

  @Column({ type: 'enum', enum: Region, nullable: true })
  region: Region | null;

  @Column({ type: 'varchar', length: 4, nullable: true })
  country: string | null;

  @Column({ type: 'enum', enum: CallSource, nullable: true })
  source: CallSource | null;

  @Column({ type: 'int', default: 0 })
  ringTimeSeconds: number;

  @Column({ type: 'text', nullable: true })
  recordingUrl: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  followUpDate: Date | null;

  @Column({ type: 'text', nullable: true })
  aiSummary: string | null;

  @Column({ type: 'text', nullable: true })
  transcript: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  disposition: CallDisposition | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  device: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
