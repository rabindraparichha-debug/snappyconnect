import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CallDirection, CallingProvider, CallStatus } from '../common/enums';
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

  /** Provider-side id (e.g. Telnyx call_leg_id) used to correlate webhooks. */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  externalId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
