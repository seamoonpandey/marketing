import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { withBrand } from '../../db/tenant.ts';
import { getSettings, setSettings } from './settings.ts';

let t: TestDb;
beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());

const ok = { channels: [{ channel: 'facebook', postsPerWeek: 3 }] as const, pillars: [{ pillar: 'product', weight: 2 }] as const, weekStarts: 0 };
const set = (brand: string, s: unknown) => withBrand(brand, (tx) => setSettings(tx, brand, s as never));

describe('plan settings', () => {
  it('returns defaults, then what was saved', async () => {
    const a = await t.makeBrand();
    expect(await withBrand(a, (tx) => getSettings(tx, a))).toEqual({ channels: [], pillars: [], weekStarts: 0 });
    await set(a, ok);
    expect(await withBrand(a, (tx) => getSettings(tx, a))).toEqual(ok);
  });

  it('refuses an unknown channel or pillar, a postsPerWeek outside 1 to 14, and a channel listed twice', async () => {
    const a = await t.makeBrand();
    await expect(set(a, { ...ok, channels: [{ channel: 'myspace', postsPerWeek: 2 }] })).rejects.toThrow(/Unknown channel/);
    await expect(set(a, { ...ok, pillars: [{ pillar: 'gossip', weight: 1 }] })).rejects.toThrow(/Unknown pillar/);
    for (const n of [0, 15, 1.5]) await expect(set(a, { ...ok, channels: [{ channel: 'x', postsPerWeek: n }] })).rejects.toThrow(/postsPerWeek/);
    await expect(set(a, { ...ok, channels: [{ channel: 'x', postsPerWeek: 2 }, { channel: 'x', postsPerWeek: 3 }] })).rejects.toThrow(/twice/);
    await expect(set(a, { ...ok, weekStarts: 7 })).rejects.toThrow(/weekStarts/);
  });

  it("hides brand B's settings and campaigns inside withBrand(A)", async () => {
    const a = await t.makeBrand();
    const b = await t.makeBrand();
    await set(b, ok);
    await t.adminQuery(`insert into campaigns (tenant_id, brand_id, name, objective) values ($1, $2, 'B only', 'awareness')`, [t.tenantId, b]);
    const seen = await withBrand(a, async (tx) => ({
      settings: await getSettings(tx, a),
      campaigns: (await tx.execute(`select * from campaigns` as never)).rows,
    }));
    expect(seen.settings.channels).toEqual([]);
    expect(seen.campaigns).toEqual([]);
  });
});
