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

export enum AuditAction {
  USER_CREATED = 'user_created',
  USER_UPDATED = 'user_updated',
  USER_DELETED = 'user_deleted',
  USER_STATUS_CHANGED = 'user_status_changed',
  SETTINGS_UPDATED = 'settings_updated',
  DNC_REMOVED = 'dnc_removed',
  PASSWORD_CHANGED = 'password_changed',
}

/**
 * Security-relevant admin actions. Separate from ActivityLog, which records
 * recruiting work (calls, notes) — this one answers "who changed access or
 * configuration, and when", and is only ever written by the server.
 */
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @ManyToOne(() => User, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actorId' })
  actor: User | null;

  /** Kept denormalised so the trail survives the actor being deleted. */
  @Column({ type: 'varchar', length: 160, nullable: true })
  actorEmail: string | null;

  @Index()
  @Column({ type: 'varchar', length: 32 })
  action: AuditAction;

  /** Human-readable description of what changed. */
  @Column({ type: 'varchar', length: 500 })
  summary: string;

  /** Id of the affected record, when there is one. */
  @Column({ type: 'uuid', nullable: true })
  targetId: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  targetLabel: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
