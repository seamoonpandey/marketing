import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { withBrand } from '../../db/tenant.ts';
import { getSettings, setSettings } from './settings.ts';

let t: TestDb;
beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());

const set = (brand: string, s: unknown) => withBrand(brand, (tx) => setSettings(tx, brand, s as never));

describe('publish settings', () => {
  it('returns defaults, then what was saved, with an audit event', async () => {
    const a = await t.makeBrand();
    expect(await withBrand(a, (tx) => getSettings(tx, a))).toEqual({ windowStart: 7, windowEnd: 21, maxAttempts: 3 });
    expect(await set(a, { windowStart: 0, windowEnd: 24, maxAttempts: 5 })).toEqual({ windowStart: 0, windowEnd: 24, maxAttempts: 5 });
    expect(await t.adminQuery(`select 1 from audit_events where brand_id = $1 and action = 'publish.settings.set'`, [a])).toHaveLength(1);
  });

  it('refuses a window whose start is not before its end, and maxAttempts outside 1 to 5', async () => {
    const a = await t.makeBrand();
    await expect(set(a, { windowStart: 9, windowEnd: 9, maxAttempts: 3 })).rejects.toThrow(/start before it ends/);
    await expect(set(a, { windowStart: 21, windowEnd: 7, maxAttempts: 3 })).rejects.toThrow(/start before it ends/);
    for (const [s, e] of [[-1, 5], [7, 25], [7.5, 9]]) await expect(set(a, { windowStart: s, windowEnd: e, maxAttempts: 3 })).rejects.toThrow(/windowStart/);
    for (const n of [0, 6, 2.5]) await expect(set(a, { windowStart: 7, windowEnd: 21, maxAttempts: n })).rejects.toThrow(/maxAttempts/);
    expect(await withBrand(a, (tx) => getSettings(tx, a))).toEqual({ windowStart: 7, windowEnd: 21, maxAttempts: 3 });
  });

  it("hides brand B's channels, jobs and settings inside withBrand(A)", async () => {
    const a = await t.makeBrand();
    const b = await t.makeBrand();
    await set(b, { windowStart: 1, windowEnd: 2, maxAttempts: 1 });
    const [ch] = await t.adminQuery(`insert into channels (tenant_id, brand_id, platform, account_name) values ($1, $2, 'x', '@b') returning id`, [t.tenantId, b]);
    await t.adminQuery(
      `insert into publish_jobs (tenant_id, brand_id, draft_id, draft_version, payload_hash, channel_id, scheduled_at, idempotency_key)
       values ($1, $2, uuidv7(), 1, 'h', $3, now(), 'k-b')`,
      [t.tenantId, b, ch.id],
    );
    const seen = await withBrand(a, async (tx) => ({
      settings: await getSettings(tx, a),
      channels: (await tx.execute(sql`select * from channels`)).rows,
      jobs: (await tx.execute(sql`select * from publish_jobs`)).rows,
    }));
    expect(seen).toEqual({ settings: { windowStart: 7, windowEnd: 21, maxAttempts: 3 }, channels: [], jobs: [] });
    // And brand A cannot write a row into brand B.
    await expect(
      withBrand(a, (tx) => tx.execute(sql`insert into channels (brand_id, platform, account_name) values (${b}, 'x', '@sneaky')`)),
    ).rejects.toThrow();
  });
});
