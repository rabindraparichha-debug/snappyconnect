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
import { User } from '../users/user.entity';

export type VoiceRequestStatus = 'pending' | 'approved' | 'rejected';

/**
 * A recruiter's request to have their own voice cloned for the AI agent.
 *
 * Cloning is held behind approval on purpose: each clone costs money, and a
 * voice may only be cloned with its owner's consent — which is a judgement an
 * admin makes, not something a form can check.
 */
@Entity('voice_requests')
export class VoiceRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  /** What the finished voice should be called. */
  @Column()
  name: string;

  /** The uploaded sample, stored alongside recordings. */
  @Column()
  sampleFilename: string;

  @Index()
  @Column({ type: 'varchar', default: 'pending' })
  status: VoiceRequestStatus;

  /** Set once approved and the clone exists. */
  @Column({ type: 'varchar', nullable: true })
  voiceId: string | null;

  @Column({ type: 'varchar', default: 'cartesia' })
  provider: string;

  /** Why an admin turned it down, shown to the recruiter. */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedById: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
