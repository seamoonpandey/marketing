import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { withBrand } from '../../db/tenant.ts';
import { approve, bulkApprove, recordView, reject, validApproval } from './decisions.ts';
import { preview } from './queue.ts';
import { setPaused, setSettings } from './settings.ts';
import { content, fact, fakeStudio, hashOf } from './studio.fake.ts';
import type { ReadyDraft, StudioReads } from './studio.ts';

let t: TestDb;
beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());

const studio = fakeStudio();
const F1 = randomUUID();
const facts = [fact(F1)];
const NOTE = 'Checked the claim with the pharmacist today.';
const ok = (b: string, d: ReadyDraft, reviewNote?: string) => withBrand(b, (tx) => approve(tx, b, { draftId: d.id, payloadHash: hashOf(d), reviewNote }, facts, studio.reads));
const gate = (b: string, d: { id: string }, f = facts) => withBrand(b, (tx) => validApproval(tx, b, d.id, f, studio.reads));
const view = (b: string, d: ReadyDraft) => withBrand(b, (tx) => recordView(tx, b, d.id, d.currentVersion, hashOf(d)));
const bulk = (b: string, ds: ReadyDraft[]) => withBrand(b, (tx) => bulkApprove(tx, b, ds.map((d) => ({ draftId: d.id, payloadHash: hashOf(d) })), facts, studio.reads));
const stored = async (b: string) => (await t.adminQuery(`select count(*)::int as n from approvals where brand_id = $1`, [b]))[0].n as number;
const risky = { content: content('Results guaranteed in a week.') };
const no = (b: string, d: ReadyDraft, reason = 'Withdrawn: the photo is wrong') =>
  withBrand(b, (tx) => reject(tx, b, { draftId: d.id, payloadHash: hashOf(d), reason }, facts, studio.reads));
// The owner role may update; the app role may not. Moves an approval's expiry into the past.
const expire = (id: string) => t.adminQuery(`update approvals set expires_at = now() - interval '1 second' where id = $1`, [id]);
const state = async (b: string, d: ReadyDraft) => (await withBrand(b, (tx) => preview(tx, b, d.id, facts, studio.reads, { record: false }))).state;
const blocking = [{ check: 'prohibited_word', blocking: true, where: 'caption en', message: 'Uses "miracle"' }];
const sameVersion = { currentVersion: 1, status: 'ready' as const, readyVersion: 1 };

/**
 * Two approvals and a rejection of one draft at the same instant: Studio answers all three together, so each reads the
 * same latest decision and takes the same seq. Exactly one is stored; the others are refused by the unique index.
 */
async function race(b: string, d: ReadyDraft) {
  let held: (() => void)[] = [];
  const together: StudioReads = {
    ...studio.reads,
    async getDraft(...a) {
      await new Promise<void>((go) => {
        held.push(go);
        if (held.length === 3) for (const g of held.splice(0)) g();
      });
      return studio.reads.getDraft(...a);
    },
  };
  const results = await Promise.allSettled([
    withBrand(b, (tx) => approve(tx, b, { draftId: d.id, payloadHash: hashOf(d) }, facts, together)),
    withBrand(b, (tx) => approve(tx, b, { draftId: d.id, payloadHash: hashOf(d) }, facts, together)),
    withBrand(b, (tx) => reject(tx, b, { draftId: d.id, payloadHash: hashOf(d), reason: 'No' }, facts, together)),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  for (const r of results.filter((x) => x.status === 'rejected')) expect(String((r as PromiseRejectedResult).reason)).toMatch(/same moment/);
}

describe('approve decisions', () => {
  it('refuses a stale hash; with the current one stores one approval with its risk, expiry and an audit event carrying version and hash', async () => {
    const b = await t.makeBrand();
    const d = studio.put(b, { currentVersion: 2, readyVersion: 2, content: content('Only Rs 4,500 this week.') });
    await expect(withBrand(b, (tx) => approve(tx, b, { draftId: d.id, payloadHash: '0'.repeat(64) }, facts, studio.reads))).rejects.toThrow('changed since you opened it');
    expect(await stored(b)).toBe(0);

    const before = Date.now();
    const a = await ok(b, d);
    expect(a).toMatchObject({ objectId: d.id, objectVersion: 2, payloadHash: hashOf(d), decision: 'approved', risk: 'medium', decidedBy: 'operator', bulkId: null });
    const days = (a.expiresAt!.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(13.99);
    expect(days).toBeLessThan(14.01);
    expect(await t.adminQuery(`select object_version, reason from audit_events where brand_id = $1 and action = 'approve.approved'`, [b]))
      .toEqual([{ object_version: 2, reason: `payload ${hashOf(d)}` }]);
    expect(await gate(b, d)).toMatchObject({ id: a.id });
    expect(await stored(b)).toBe(1);
  });

  it('refuses a draft that is not ready, blocked, citing an unapproved fact, or already decided at this version', async () => {
    const b = await t.makeBrand();
    const notReady = studio.put(b, { status: 'draft', readyVersion: null });
    await expect(withBrand(b, (tx) => approve(tx, b, { draftId: notReady.id, payloadHash: 'a'.repeat(64) }, facts, studio.reads))).rejects.toThrow('not ready');
    const blocked = studio.put(b, { findings: [{ check: 'too_long', blocking: true, where: 'caption en', message: 'Too long for x' }] });
    await expect(ok(b, blocked)).rejects.toThrow(/blocked: Too long/);
    await expect(ok(b, studio.put(b, { factIds: [randomUUID()] }))).rejects.toThrow(/fact is not approved/);
    await expect(ok(b, studio.put(b, { assetIds: [randomUUID()] }))).rejects.toThrow(/no rights/);

    const d = studio.put(b);
    await no(b, d, 'Wrong photo');
    await expect(no(b, d, 'Still wrong')).rejects.toThrow(/already rejected/);
    await expect(no(b, d, '  ​ ')).rejects.toThrow(/needs a reason/);
    expect(await stored(b)).toBe(1);
  });

  it('(AT-013) makes validApproval return null once Studio returns the draft at a new version, ready or not', async () => {
    const b = await t.makeBrand();
    const d = studio.put(b);
    await ok(b, d);
    expect(await gate(b, d)).not.toBeNull();
    studio.edit(b, d.id, { content: content('Warm shawls.') });
    expect(await gate(b, d)).toBeNull();
    studio.edit(b, d.id, { status: 'ready', currentVersion: 2, readyVersion: 2 });
    expect(await gate(b, d)).toBeNull();
  });

  it('makes validApproval return null when the files change at the same version', async () => {
    const b = await t.makeBrand();
    const d = studio.put(b);
    await ok(b, d);
    studio.edit(b, d.id, { currentVersion: 1, status: 'ready', readyVersion: 1, renders: [{ ...d.renders[0]!, sha256: 'b'.repeat(64) }] });
    expect(await gate(b, d)).toBeNull();
  });

  it('makes validApproval return null when a cited fact is missing from facts or has expired', async () => {
    const b = await t.makeBrand();
    const d = studio.put(b, { factIds: [F1] });
    await ok(b, d);
    expect(await gate(b, d)).not.toBeNull();
    expect(await gate(b, d, [])).toBeNull();
    expect(await gate(b, d, [fact(F1, { expiresAt: new Date(Date.now() - 1000).toISOString() })])).toBeNull();
  });

  it('caps the expiry at the earliest cited fact expiry and asset rights expiry, and drops the approval when rights go', async () => {
    const b = await t.makeBrand();
    const [src] = await t.adminQuery(
      `insert into sources (tenant_id, brand_id, kind, uri, mime, checksum, object_key, trust) values ($1, $2, 'upload', 'x', 'image/png', 'c', 'k', 'owner') returning id`,
      [t.tenantId, b],
    );
    const rightsUntil = new Date(Date.now() + 3 * 86_400_000);
    const [asset] = await t.adminQuery(`insert into assets (tenant_id, brand_id, source_id, kind, rights) values ($1, $2, $3, 'photo', $4) returning id`,
      [t.tenantId, b, src.id, JSON.stringify({ licence: 'Owned', expiresAt: rightsUntil.toISOString() })]);
    const factUntil = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const d = studio.put(b, { factIds: [F1], assetIds: [asset.id] });
    const a = await withBrand(b, (tx) => approve(tx, b, { draftId: d.id, payloadHash: hashOf(d) }, [fact(F1, { expiresAt: factUntil })], studio.reads));
    expect(a.expiresAt).toEqual(rightsUntil);
    expect(await gate(b, d)).not.toBeNull();
    await t.adminQuery(`update assets set rights = '{}' where id = $1`, [asset.id]);
    expect(await gate(b, d)).toBeNull();
  });

  it('(review focus 1) stores one decision when two approvals of one draft race; the other is refused', async () => {
    const b = await t.makeBrand();
    const d = studio.put(b);
    await race(b, d);
    expect(await stored(b)).toBe(1);
  });

  it('renews an approval once it has expired, with every check run again, and refuses to renew one that is still valid', async () => {
    const b = await t.makeBrand();
    const d = studio.put(b);
    const first = await ok(b, d);
    await expect(ok(b, d)).rejects.toThrow(/already approved/); // nothing to renew
    await withBrand(b, (tx) => setPaused(tx, b, true, 'Checking the week'));
    await expect(ok(b, d)).rejects.toThrow(/already approved/); // paused, not expired: resuming is the remedy
    await withBrand(b, (tx) => setPaused(tx, b, false, 'Checked'));
    expect(await stored(b)).toBe(1);

    await expire(first.id);
    expect(await state(b, d)).toBe('expired');
    expect(await gate(b, d)).toBeNull();
    // Today's findings and risk apply to the renewal.
    studio.edit(b, d.id, { ...sameVersion, findings: blocking });
    await expect(ok(b, d)).rejects.toThrow(/blocked/);
    studio.edit(b, d.id, { ...sameVersion, findings: [] });
    const pharmacy = [...facts, fact(randomUUID(), { section: 'identity', subjectType: 'brand', field: 'industry', value: 'Pharmacy', unit: null })];
    await expect(withBrand(b, (tx) => approve(tx, b, { draftId: d.id, payloadHash: hashOf(d) }, pharmacy, studio.reads))).rejects.toThrow(/high risk/);
    expect(await stored(b)).toBe(1);

    const renewed = await ok(b, d);
    expect(renewed).toMatchObject({ objectVersion: 1, seq: 2, decision: 'approved' });
    expect(renewed.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    expect(await gate(b, d)).toMatchObject({ id: renewed.id });
    expect(await state(b, d)).toBe('approved');
  });

  it('renews an approval made invalid at the same version, against the new payload only', async () => {
    const b = await t.makeBrand();
    const d = studio.put(b);
    await ok(b, d);
    const rerendered = studio.edit(b, d.id, { ...sameVersion, renders: [{ ...d.renders[0]!, sha256: 'b'.repeat(64) }] });
    expect(await state(b, d)).toBe('invalid');
    await expect(ok(b, d)).rejects.toThrow(/changed since you opened it/);
    expect(await ok(b, rerendered)).toMatchObject({ seq: 2, payloadHash: hashOf(rerendered) });
    expect(await gate(b, d)).not.toBeNull();
  });

  it('withdraws an approval with a reject, after which the gate returns nothing and an approve is allowed again with every check', async () => {
    const b = await t.makeBrand();
    const d = studio.put(b);
    await ok(b, d);
    await expect(no(b, d, '   ')).rejects.toThrow(/needs a reason/);
    expect(await no(b, d)).toMatchObject({ decision: 'rejected', seq: 2, reason: 'Withdrawn: the photo is wrong' });
    expect(await gate(b, d)).toBeNull();
    expect(await state(b, d)).toBe('rejected');

    studio.edit(b, d.id, { ...sameVersion, findings: blocking });
    await expect(ok(b, d)).rejects.toThrow(/blocked/);
    studio.edit(b, d.id, { ...sameVersion, findings: [] });
    expect(await ok(b, d)).toMatchObject({ decision: 'approved', seq: 3 });
    expect(await gate(b, d)).not.toBeNull();
    expect(await stored(b)).toBe(3);
  });

  it('stores one decision when two renewals of an expired approval race', async () => {
    const b = await t.makeBrand();
    const d = studio.put(b);
    await expire((await ok(b, d)).id);
    await race(b, d);
    expect(await stored(b)).toBe(2);
  });

  it('refuses a high-risk draft without a long enough note, accepts it with one, and refuses it in a bulk approval', async () => {
    const b = await t.makeBrand();
    const d = studio.put(b, risky);
    for (const note of [undefined, '', 'Looks fine to me ok', `   short note   ${'​'.repeat(20)}`, ' '.repeat(30)])
      await expect(ok(b, d, note)).rejects.toThrow(/review note of at least 20/);
    const e = studio.put(b, risky);
    await view(b, e);
    await expect(bulk(b, [e])).rejects.toThrow(/high risk/);
    expect(await stored(b)).toBe(0);
    expect(await ok(b, d, NOTE)).toMatchObject({ risk: 'high', reviewNote: NOTE });
  });

  it('treats a regulated industry fact as high risk', async () => {
    const b = await t.makeBrand();
    const d = studio.put(b);
    const withIndustry = [...facts, fact(randomUUID(), { section: 'identity', subjectType: 'brand', field: 'industry', value: 'Pharmacy', unit: null })];
    await expect(withBrand(b, (tx) => approve(tx, b, { draftId: d.id, payloadHash: hashOf(d) }, withIndustry, studio.reads))).rejects.toThrow(/high risk/);
  });

  it('bulk-approves viewed items of one channel, risk and week with one bulk id, and refuses any mix, storing nothing', async () => {
    const b = await t.makeBrand();
    const mk = (over: Partial<ReadyDraft> = {}) => studio.put(b, over);
    const [x, y] = [mk({ day: '2026-11-29' }), mk({ day: '2026-12-05' })]; // Sunday and Saturday of one week
    const otherChannel = mk({ channel: 'instagram' });
    const medium = mk({ content: content('Only Rs 4,500.') });
    const nextWeek = mk({ day: '2026-12-06' });
    const unseen = mk();
    for (const d of [x, y, otherChannel, medium, nextWeek]) await view(b, d);

    await expect(bulk(b, [x, otherChannel])).rejects.toThrow(/one channel/);
    await expect(bulk(b, [x, medium])).rejects.toThrow(/one risk/);
    await expect(bulk(b, [x, nextWeek])).rejects.toThrow(/one week/);
    await expect(bulk(b, [x, unseen])).rejects.toThrow(new RegExp(`${unseen.id}: open its preview first`));
    await expect(bulk(b, [x, x])).rejects.toThrow(/twice/);
    await expect(withBrand(b, (tx) => bulkApprove(tx, b, [{ draftId: x.id, payloadHash: hashOf(x) }, { draftId: y.id, payloadHash: '0'.repeat(64) }], facts, studio.reads)))
      .rejects.toThrow(new RegExp(`${y.id}: changed since you opened it`));
    expect(await stored(b)).toBe(0);

    // A view of an earlier set of files does not count once Studio re-renders the version.
    const rerendered = mk();
    await view(b, rerendered);
    studio.edit(b, rerendered.id, { currentVersion: 1, status: 'ready', readyVersion: 1, renders: [] });
    const now = (await withBrand(b, (tx) => studio.reads.getDraft(tx, b, rerendered.id, facts)))!;
    await expect(bulk(b, [x, now])).rejects.toThrow(/open its preview first/);
    expect(await stored(b)).toBe(0);

    const done = await bulk(b, [x, y]);
    expect(done).toHaveLength(2);
    expect(done[0]!.bulkId).toBeTruthy();
    expect(done[1]!.bulkId).toBe(done[0]!.bulkId);
    expect(await gate(b, y)).not.toBeNull();
    // A second bulk including an approved item fails as a whole.
    await view(b, unseen);
    await expect(bulk(b, [unseen, x])).rejects.toThrow(/already approved/);
    expect(await stored(b)).toBe(2);
  });

  it('uses the brand plan week for the one-week rule', async () => {
    const b = await t.makeBrand();
    await withBrand(b, async (tx) => (await import('../plan/index.ts')).setSettings(tx, b, { channels: [], pillars: [], weekStarts: 1 }));
    const sun = studio.put(b, { day: '2026-11-29' });
    const mon = studio.put(b, { day: '2026-11-30' });
    for (const d of [sun, mon]) await view(b, d);
    await expect(bulk(b, [sun, mon])).rejects.toThrow(/one week/);
  });

  it("(review focus 4) stores an approval given while paused, which the gate returns only after resuming", async () => {
    const b = await t.makeBrand();
    const d = studio.put(b);
    await withBrand(b, (tx) => setPaused(tx, b, true, 'Flood news this week'));
    const a = await ok(b, d);
    expect(await stored(b)).toBe(1);
    expect(await gate(b, d)).toBeNull();
    await withBrand(b, (tx) => setPaused(tx, b, false, 'Back to normal'));
    expect(await gate(b, d)).toMatchObject({ id: a.id });
  });

  it('honours the brand validity days and refuses brand B drafts through brand A', async () => {
    const a = await t.makeBrand();
    const b = await t.makeBrand();
    await withBrand(a, (tx) => setSettings(tx, a, { maxAgeDays: 1, approvers: [] }));
    const mine = studio.put(a);
    const ap = await ok(a, mine);
    expect(ap.expiresAt!.getTime() - ap.decidedAt.getTime()).toBe(86_400_000);

    const theirs = studio.put(b);
    await expect(ok(a, theirs)).rejects.toThrow(/not found/);
    await expect(withBrand(a, (tx) => bulkApprove(tx, a, [{ draftId: theirs.id, payloadHash: hashOf(theirs) }], facts, studio.reads))).rejects.toThrow(/not found/);
    await ok(b, theirs);
    expect(await gate(a, theirs)).toBeNull();
    expect(await gate(b, theirs)).not.toBeNull();
    expect(await gate(a, { id: 'not-a-uuid' })).toBeNull();
  });
});
