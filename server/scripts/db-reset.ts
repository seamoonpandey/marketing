// `pnpm db:reset [database]`: drops and recreates a development database (default: the one in
// DATABASE_URL) with the current schema, the app role and grants, and the seeded tenant.
// Not for production, which uses `pnpm db:migrate`. (`drizzle-kit push` is not used: it drops the
// USING and WITH CHECK clauses of RLS policies.)
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import pg from 'pg';
import { config } from '../src/config.ts';
import * as schema from '../src/db/schema/index.ts';
import { seedTenant } from '../src/db/seed.ts';
import { ensureAppRole, POST_SCHEMA_SQL } from '../src/db/setup.ts';

const name = process.argv[2] ?? new URL(config.DATABASE_URL).pathname.slice(1);
if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Not a database name: ${name}`);
const inDb = (url: string, db = name) => Object.assign(new URL(url), { pathname: `/${db}` }).toString();

const server = new pg.Client(inDb(config.DATABASE_ADMIN_URL, 'postgres'));
await server.connect();
await server.query(`drop database if exists ${name} with (force)`);
await server.query(`create database ${name}`);
await ensureAppRole(server, decodeURIComponent(new URL(config.DATABASE_URL).password));
await server.end();

const admin = new pg.Client(inDb(config.DATABASE_ADMIN_URL));
await admin.connect();
for (const statement of await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema)))
  await admin.query(statement);
await admin.query(POST_SCHEMA_SQL);
console.log(`${name}: schema applied, tenant ${config.TENANT_SLUG} ${await seedTenant(admin)}`);
await admin.end();
