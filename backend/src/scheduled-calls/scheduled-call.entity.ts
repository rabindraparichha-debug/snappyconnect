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
import { Region } from '../common/enums';
import { User } from '../users/user.entity';

export enum ScheduledCallStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  CANCELED = 'canceled',
  MISSED = 'missed',
}

@Entity('scheduled_calls')
export class ScheduledCall {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { eager: true, nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 32 })
  phoneNumber: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  contactName: string | null;

  @Index()
  @Column({ type: 'timestamptz' })
  scheduledAt: Date;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  region: Region | null;

  @Column({ type: 'varchar', length: 16, default: ScheduledCallStatus.PENDING })
  status: ScheduledCallStatus;

  @Column({ type: 'boolean', default: false })
  reminderSent: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
