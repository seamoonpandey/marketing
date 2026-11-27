import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config.ts';
import * as schema from './schema/index.ts';

function connect(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return { pool, db: drizzle(pool, { schema }) };
}

let current: ReturnType<typeof connect> | undefined;

export type Db = ReturnType<typeof connect>['db'];

/** The app connection (role marketing_app). Code outside src/db reaches it through withTenant/withBrand only. */
export function db(): Db {
  current ??= connect(config.DATABASE_URL);
  return current.db;
}

/** Points the app at another database. Tests only. */
export async function useDatabase(url: string): Promise<void> {
  await closeDb();
  current = connect(url);
}

export async function closeDb(): Promise<void> {
  const c = current;
  current = undefined;
  await c?.pool.end();
}
