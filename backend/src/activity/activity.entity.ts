import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum ActivityType {
  CALL_MADE = 'call_made',
  CALL_RECEIVED = 'call_received',
  SMS_SENT = 'sms_sent',
  SMS_RECEIVED = 'sms_received',
  NOTE_ADDED = 'note_added',
  FOLLOW_UP_SET = 'follow_up_set',
  DISPOSITION_SET = 'disposition_set',
}

@Entity('activity_logs')
export class ActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  @Column({ type: 'varchar', length: 32 })
  type: ActivityType;

  @Column({ type: 'varchar', length: 255 })
  summary: string;

  @Column({ type: 'uuid', nullable: true })
  referenceId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
