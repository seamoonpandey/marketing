import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../test/helpers.ts';
import { NotFoundError } from '../http/errors.ts';
import { db, useDatabase } from './client.ts';
import { sources } from './schema/index.ts';
import { withBrand, withTenant } from './tenant.ts';

let t: TestDb;
let brandA: string;
let brandB: string;

const source = (tenantId: string, brandId: string, uri: string) =>
  t.adminQuery(
    `insert into sources (tenant_id, brand_id, kind, uri, mime, checksum, object_key, trust)
     values ($1, $2, 'page', $3, 'text/html', 'x', 'k', 'brand_site')`,
    [tenantId, brandId, uri],
  );

beforeAll(async () => {
  t = await testDb();
  brandA = await t.makeBrand('A');
  brandB = await t.makeBrand('B');
  await source(t.tenantId, brandA, 'https://a.example/');
  await source(t.tenantId, brandB, 'https://b.example/');
});
afterAll(() => t.close());

describe('tenancy', () => {
  it('shows a brand its own rows only and refuses rows for another brand (AT-001)', async () => {
    const rows = await withBrand(brandA, (tx) => tx.select().from(sources));
    expect(rows.map((r) => r.uri)).toEqual(['https://a.example/']);

    await expect(
      withBrand(brandA, (tx) =>
        tx.insert(sources).values({
          brandId: brandB, kind: 'page', uri: 'https://b.example/x', mime: 'text/html',
          checksum: 'x', objectKey: 'k', trust: 'brand_site',
        }),
      ),
    ).rejects.toThrow();
  });

  it('refuses a brand of another tenant with NotFoundError and one denied audit event', async () => {
    const [other] = await t.adminQuery(`insert into tenants (name, slug) values ('Other', 'other') returning id`);
    const [foreign] = await t.adminQuery(
      `insert into brands (tenant_id, name, slug) values ($1, 'Foreign', 'foreign') returning id`,
      [other.id],
    );
    await expect(withBrand(foreign.id, async () => 'reached')).rejects.toBeInstanceOf(NotFoundError);
    const denied = await t.adminQuery(`select * from audit_events where result = 'denied' and object_id = $1`, [foreign.id]);
    expect(denied).toHaveLength(1);
    expect(denied[0].tenant_id).toBe(t.tenantId);
  });

  it('gives the app role no UPDATE or DELETE on audit_events', async () => {
    await expect(withTenant((tx) => tx.execute(sql`update audit_events set actor = 'x'`))).rejects.toMatchObject({
      cause: { code: '42501' },
    });
    await expect(withTenant((tx) => tx.execute(sql`delete from audit_events`))).rejects.toMatchObject({
      cause: { code: '42501' },
    });
  });

  it('leaves no brand context on a pooled connection after withBrand ends', async () => {
    await useDatabase(t.url, 1); // one connection, so the next query reuses it
    await withBrand(brandA, async (tx) => {
      const r = await tx.execute<{ v: string }>(sql`select current_setting('app.brand_ids', true) as v`);
      expect(r.rows[0]!.v).toBe(`{${brandA}}`);
    });
    const r = await db().execute<{ v: string | null }>(sql`select current_setting('app.brand_ids', true) as v`);
    expect(r.rows[0]!.v ?? '').toBe('');
  });
});
