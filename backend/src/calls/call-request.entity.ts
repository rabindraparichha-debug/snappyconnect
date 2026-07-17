import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CallRequestStatus, CallSource } from '../common/enums';
import { User } from '../users/user.entity';

/**
 * A pending click-to-call request for the Native Mobile Dialer provider.
 * The browser/extension creates one; the mobile app polls, dials via the
 * native dialer, then reports the outcome (which creates a CallLog).
 */
@Entity('call_requests')
export class CallRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  phoneNumber: string;

  @Column({ type: 'enum', enum: CallRequestStatus, default: CallRequestStatus.PENDING })
  status: CallRequestStatus;

  @Column({ type: 'enum', enum: CallSource, default: CallSource.WEB })
  source: CallSource;

  @Column({ type: 'timestamptz', nullable: true })
  dispatchedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
