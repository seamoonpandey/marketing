import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { approvals } from '../../db/schema/index.ts';
import { withBrand } from '../../db/tenant.ts';
import { getSettings, setPaused, setSettings } from './settings.ts';

let t: TestDb;
beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());

const DRAFT = '0196f3c2-0000-7000-8000-0000000000d1';
const HASH = 'a'.repeat(64);
const row = (brandId: string, version = 1) => ({
  brandId, objectType: 'studio_draft' as const, objectId: DRAFT, objectVersion: version, payloadHash: HASH,
  decision: 'approved' as const, risk: 'low' as const, decidedBy: 'operator', expiresAt: new Date(Date.now() + 86_400_000),
});
const DENIED = { cause: { code: '42501' } }; // insufficient_privilege
const events = (brand: string, action: string) =>
  t.adminQuery(`select reason from audit_events where brand_id = $1 and action = $2`, [brand, action]);

describe('approve schema and settings', () => {
  it('refuses UPDATE and DELETE on approvals to the app role', async () => {
    const a = await t.makeBrand();
    await withBrand(a, (tx) => tx.insert(approvals).values(row(a)));
    await expect(withBrand(a, (tx) => tx.execute(sql`update approvals set reason = 'edited'`))).rejects.toMatchObject(DENIED);
    await expect(withBrand(a, (tx) => tx.execute(sql`delete from approvals`))).rejects.toMatchObject(DENIED);
    await expect(withBrand(a, (tx) => tx.execute(sql`truncate approvals`))).rejects.toMatchObject(DENIED);
    expect(await t.adminQuery(`select reason from approvals where brand_id = $1`, [a])).toEqual([{ reason: null }]);
  });

  it('stores one decision per object version', async () => {
    const a = await t.makeBrand();
    await withBrand(a, (tx) => tx.insert(approvals).values(row(a, 1)));
    await expect(withBrand(a, (tx) => tx.insert(approvals).values({ ...row(a, 1), decision: 'rejected', reason: 'no' }))).rejects.toThrow();
    await withBrand(a, (tx) => tx.insert(approvals).values(row(a, 2)));
  });

  it('returns defaults, saves settings and refuses a validity outside 1 to 90 days', async () => {
    const a = await t.makeBrand();
    expect(await withBrand(a, (tx) => getSettings(tx, a))).toEqual({ maxAgeDays: 14, approvers: [], paused: false, pausedReason: null, pausedAt: null });
    expect(await withBrand(a, (tx) => setSettings(tx, a, { maxAgeDays: 7, approvers: [' Sita '] }))).toMatchObject({ maxAgeDays: 7, approvers: ['Sita'] });
    for (const n of [0, 91, 1.5]) await expect(withBrand(a, (tx) => setSettings(tx, a, { maxAgeDays: n, approvers: [] }))).rejects.toThrow(/1 to 90/);
    await expect(withBrand(a, (tx) => setSettings(tx, a, { maxAgeDays: 7, approvers: ['  '] }))).rejects.toThrow(/approver/);
  });

  it('refuses setPaused without a reason, and audits a pause and a resume with one', async () => {
    const a = await t.makeBrand();
    for (const reason of ['', '   ', '\u200b\u00ad', undefined as unknown as string]) {
      await expect(withBrand(a, (tx) => setPaused(tx, a, true, reason))).rejects.toThrow(/reason/);
      await expect(withBrand(a, (tx) => setPaused(tx, a, false, reason))).rejects.toThrow(/reason/);
    }
    expect((await withBrand(a, (tx) => getSettings(tx, a))).paused).toBe(false);
    const paused = await withBrand(a, (tx) => setPaused(tx, a, true, 'Festival blackout'));
    expect(paused).toMatchObject({ paused: true, pausedReason: 'Festival blackout', pausedAt: expect.any(Date) });
    expect(await events(a, 'approve.pause')).toEqual([{ reason: 'Festival blackout' }]);
    expect(await withBrand(a, (tx) => setPaused(tx, a, false, 'Over'))).toMatchObject({ paused: false, pausedReason: null, pausedAt: null });
    expect(await events(a, 'approve.resume')).toEqual([{ reason: 'Over' }]);
  });

  it("hides brand B's approvals, views and settings inside withBrand(A)", async () => {
    const a = await t.makeBrand();
    const b = await t.makeBrand();
    await withBrand(b, (tx) => tx.insert(approvals).values(row(b)));
    await withBrand(b, (tx) => setPaused(tx, b, true, 'B only'));
    await t.adminQuery(
      `insert into approval_views (tenant_id, brand_id, object_type, object_id, object_version, payload_hash) values ($1, $2, 'studio_draft', $3, 1, $4)`,
      [t.tenantId, b, DRAFT, HASH],
    );
    const seen = await withBrand(a, async (tx) => ({
      approvals: (await tx.execute(sql`select * from approvals`)).rows,
      views: (await tx.execute(sql`select * from approval_views`)).rows,
      settings: (await tx.execute(sql`select * from approve_settings`)).rows,
      mine: await getSettings(tx, a),
    }));
    expect(seen).toEqual({ approvals: [], views: [], settings: [], mine: expect.objectContaining({ paused: false }) });
    // Writing a row for brand B from brand A's transaction is refused by the policy.
    await expect(withBrand(a, (tx) => tx.insert(approvals).values(row(b, 9)))).rejects.toThrow();
  });
});
