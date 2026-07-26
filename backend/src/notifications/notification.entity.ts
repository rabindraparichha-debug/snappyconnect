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

export enum NotificationType {
  MISSED_CALL = 'missed_call',
  INBOUND_SMS = 'inbound_sms',
  FOLLOW_UP_DUE = 'follow_up_due',
}

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { eager: true, nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 32 })
  type: NotificationType;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'uuid', nullable: true })
  referenceId: string | null;

  @Column({ type: 'boolean', default: false })
  read: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
