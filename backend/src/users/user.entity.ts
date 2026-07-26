import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CallingProvider, Region, Role, UserStatus } from '../common/enums';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ select: false })
  passwordHash?: string;

  @Column({ type: 'varchar', nullable: true })
  mobileNumber: string | null;

  @Column({ type: 'varchar', nullable: true })
  country: string | null;

  @Column({ type: 'enum', enum: Role, default: Role.USER })
  role: Role;

  @Column({ type: 'enum', enum: CallingProvider, nullable: true })
  provider: CallingProvider | null;

  /**
   * Regions this user may place calls in (india / usa / uae). Each region maps
   * to a provider, so one user can work several regions from the same app.
   * Empty means "only the single legacy `provider` above".
   */
  @Column({ type: 'simple-array', default: '' })
  regions: string[];

  /**
   * Provider-specific per-user config, e.g.
   *  - grandstream: { extension: "101" }
   *  - telnyx:      { telnyxCredentialId: "cred_xxx" }
   */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  providerConfig: Record<string, any>;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
