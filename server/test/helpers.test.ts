import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { testDb } from './helpers.ts';

async function databaseExists(name: string) {
  const c = new pg.Client(process.env.DATABASE_ADMIN_URL);
  await c.connect();
  const r = await c.query('select 1 from pg_database where datname = $1', [name]);
  await c.end();
  return r.rowCount === 1;
}

describe('testDb', () => {
  it('creates a throwaway database and close() drops it', async () => {
    const db = await testDb();
    const name = new URL(db.url).pathname.slice(1);
    expect(name).toMatch(/^mkt_test_[a-z0-9]+$/);
    expect(await databaseExists(name)).toBe(true);
    expect(db.tenantId).toMatch(/^[0-9a-f-]{36}$/);
    await db.close();
    expect(await databaseExists(name)).toBe(false);
  });
});
