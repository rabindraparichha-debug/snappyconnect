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

/**
 * A message left for a recruiter when their line went unanswered.
 *
 * The audio is pulled off Telnyx into our own storage as soon as it is ready:
 * provider recordings expire, and a voicemail that vanishes after a month is
 * worse than no voicemail at all.
 */
@Entity('voicemails')
export class Voicemail {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The recruiter the caller was trying to reach. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { eager: true, nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  /** Caller's number in E.164, so History and Messages can match it. */
  @Index()
  @Column()
  fromNumber: string;

  /** Served through the existing recordings endpoint. */
  @Column({ type: 'varchar', nullable: true })
  recordingUrl: string | null;

  @Column({ type: 'int', default: 0 })
  durationSeconds: number;

  @Column({ type: 'boolean', default: false })
  read: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
