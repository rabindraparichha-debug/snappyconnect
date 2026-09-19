import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';

loadEnv();

/**
 * Data source for the TypeORM CLI (migration generate / run / revert).
 * The running application configures its own connection in `app.module.ts`;
 * this exists so schema changes are expressed as migrations rather than left to
 * `synchronize`, which will happily drop a column to make the database match
 * the entities.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
  username: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? 'postgres',
  database: process.env.DATABASE_NAME ?? 'snappyconnect',
  // __dirname-relative so the same file works whether it is loaded as TypeScript
  // from src/ or as compiled JavaScript from dist/.
  entities: [__dirname + '/**/*.entity.{ts,js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});
