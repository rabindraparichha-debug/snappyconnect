import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SmsDirection, SmsStatus } from '../common/enums';
import { User } from '../users/user.entity';

@Entity('sms_logs')
export class SmsLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  @Column()
  phoneNumber: string;

  @Column({ type: 'enum', enum: SmsDirection, default: SmsDirection.OUTBOUND })
  direction: SmsDirection;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'enum', enum: SmsStatus, default: SmsStatus.QUEUED })
  status: SmsStatus;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  externalId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
