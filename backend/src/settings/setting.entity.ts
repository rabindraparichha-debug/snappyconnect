import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** One row per settings namespace (e.g. "telnyx", "grandstream", "dinstar"). Value is an encrypted JSON blob. */
@Entity('settings')
export class Setting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
