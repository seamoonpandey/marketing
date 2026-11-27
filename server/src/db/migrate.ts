import { existsSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { config } from '../config.ts';
import { ensureAppRole, POST_SCHEMA_SQL } from './setup.ts';

// Applies src/db/migrations as the owner role, then the grants Drizzle cannot express.
const folder = new URL('./migrations', import.meta.url).pathname;
const admin = new pg.Client(config.DATABASE_ADMIN_URL);
await admin.connect();
await ensureAppRole(admin, decodeURIComponent(new URL(config.DATABASE_URL).password));
if (existsSync(`${folder}/meta/_journal.json`)) await migrate(drizzle(admin), { migrationsFolder: folder });
else console.warn('No migrations yet: run `pnpm db:generate` first.');
await admin.query(POST_SCHEMA_SQL);
await admin.end();
