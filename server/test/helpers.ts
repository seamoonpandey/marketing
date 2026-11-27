import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { closeDb, useDatabase } from '../src/db/client.ts';
import { seedTenant } from '../src/db/seed.ts';
import { ensureAppRole, POST_SCHEMA_SQL } from '../src/db/setup.ts';
import { resetTenantCache } from '../src/db/tenant.ts';
import { launchWorkflows, shutdownWorkflows } from '../src/workflows/index.ts';

// Test files run in parallel against one Postgres that other worktrees' suites share,
// and its 100 connections ran out with the default pools (10 app and 10 DBOS per file). A file needs only a few.
const POOL = 4;

export type TestDb = {
  tenantId: string;
  makeBrand(name?: string): Promise<string>;
  close(): Promise<void>;
  /** The app-role URL of the throwaway database. */
  url: string;
  /** The owner-role URL of the throwaway database. */
  adminUrl: string;
  /** Runs SQL as the owner role, which bypasses RLS. For arranging and inspecting data. */
  adminQuery<R extends pg.QueryResultRow = any>(sql: string, params?: unknown[]): Promise<R[]>;
};

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/**
 * A throwaway database (mkt_test_<random>) with the current schema and one seeded tenant.
 * The app connection (withTenant, withBrand) points at it until close(), which drops it.
 */
export async function testDb(): Promise<TestDb> {
  const name = `mkt_test_${randomBytes(6).toString('hex')}`;
  const appUrl = withDatabase(process.env.DATABASE_URL!, name);
  const adminUrl = withDatabase(process.env.DATABASE_ADMIN_URL!, name);

  const server = new pg.Client(process.env.DATABASE_ADMIN_URL);
  await server.connect();
  await server.query(`create database ${name}`);
  await ensureAppRole(server, decodeURIComponent(new URL(appUrl).password));
  await server.end();

  const admin = new pg.Client(adminUrl);
  await admin.connect();
  // The CREATE statements for the current Drizzle schema, from test/global-setup.ts.
  for (const statement of inject('schemaSql')) await admin.query(statement);
  await admin.query(POST_SCHEMA_SQL);
  const tenantId = await seedTenant(admin);
  await useDatabase(appUrl, POOL);
  resetTenantCache();

  let brands = 0;
  return {
    tenantId,
    url: appUrl,
    adminUrl,
    async adminQuery(sql, params) {
      return (await admin.query(sql, params)).rows;
    },
    async makeBrand(brandName = `Brand ${++brands}`) {
      const r = await admin.query<{ id: string }>(
        `insert into brands (tenant_id, name, slug) values ($1, $2, $3) returning id`,
        [tenantId, brandName, `test-${randomBytes(4).toString('hex')}`],
      );
      return r.rows[0]!.id;
    },
    async close() {
      await closeDb();
      await admin.end();
      const s = new pg.Client(process.env.DATABASE_ADMIN_URL);
      await s.connect();
      await s.query(`drop database if exists ${name} with (force)`);
      await s.end();
    },
  };
}

/**
 * Launches DBOS with its system tables in the throwaway database (schema `dbos`), so close() drops
 * them too. Register test workflows before calling it. Returns the shutdown function.
 */
export async function launchTestWorkflows(db: TestDb): Promise<() => Promise<void>> {
  await launchWorkflows(db.adminUrl, POOL);
  return shutdownWorkflows;
}
