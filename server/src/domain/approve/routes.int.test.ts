import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { createApp } from '../../app.ts';
import { withBrand } from '../../db/tenant.ts';
import { approve } from './decisions.ts';
import { routeStudio } from './routes.ts';
import { content, fakeStudio, hashOf } from './studio.fake.ts';

let t: TestDb;
const studio = fakeStudio();
const real = routeStudio.reads;
beforeAll(async () => {
  t = await testDb();
  routeStudio.reads = async () => studio.reads;
});
afterAll(async () => {
  routeStudio.reads = real;
  await t.close();
});

const app = createApp();
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
};
const denied = async (id: string) => (await t.adminQuery(`select 1 from audit_events where result = 'denied' and object_id = $1`, [id])).length;
const views = async (id: string) => (await t.adminQuery(`select object_version from approval_views where object_id = $1 order by 1`, [id])).map((r) => r.object_version);

describe('approve API', () => {
  it("answers 404 with a denied event for brand B's queue item, history, approve, reject and bulk through brand A", async () => {
    const a = await t.makeBrand();
    const b = await t.makeBrand();
    const live = studio.put(b);
    const gone = studio.put(b);
    await withBrand(b, (tx) => approve(tx, b, { draftId: gone.id, payloadHash: hashOf(gone) }, [], studio.reads));
    studio.remove(b, gone.id); // only its history remains
    const p = `/brands/${a}/approve`;

    expect((await call('GET', `${p}/queue/${live.id}`)).status).toBe(404);
    expect((await call('POST', `${p}/queue/${live.id}/approve`, { payloadHash: hashOf(live) })).status).toBe(404);
    expect((await call('POST', `${p}/queue/${live.id}/reject`, { payloadHash: hashOf(live), reason: 'no' })).status).toBe(404);
    expect((await call('POST', `${p}/bulk-approve`, { items: [{ draftId: live.id, payloadHash: hashOf(live) }] })).status).toBe(404);
    expect(await denied(live.id)).toBe(4);
    expect((await call('GET', `${p}/queue/${gone.id}`)).status).toBe(404);
    expect(await denied(gone.id)).toBe(1);
    expect((await call('GET', `${p}/queue`)).body.items).toEqual([]);
    expect((await call('GET', `${p}/summary`)).body.monthDecisions).toBe(0);
    expect(await t.adminQuery(`select 1 from approvals where brand_id = $1`, [a])).toEqual([]);
    // B sees its own.
    expect((await call('GET', `/brands/${b}/approve/queue/${gone.id}`)).body.history).toHaveLength(1);
    // A brand outside the tenant, or not a UUID, is a 404 as well.
    expect((await call('GET', `/brands/not-a-brand/approve/queue`)).status).toBe(404);
  });

  it('(review focus 5) lists an approved draft Studio no longer returns, or that went back to draft, as invalid with its history', async () => {
    const brand = await t.makeBrand();
    const gone = studio.put(brand, { day: '2026-12-02' });
    const edited = studio.put(brand, { day: '2026-12-01' });
    const waiting = studio.put(brand, { day: '2026-12-03' });
    studio.put(brand, { status: 'draft', readyVersion: null }); // never ready, never decided: not in the queue
    for (const d of [gone, edited]) await withBrand(brand, (tx) => approve(tx, brand, { draftId: d.id, payloadHash: hashOf(d) }, [], studio.reads));
    studio.remove(brand, gone.id);
    studio.edit(brand, edited.id, { content: content('New caption') });

    const q = await call('GET', `/brands/${brand}/approve/queue`);
    expect(q.status).toBe(200);
    expect(q.body.items.map((i: any) => [i.draftId, i.state])).toEqual([[edited.id, 'invalid'], [waiting.id, 'waiting'], [gone.id, 'invalid']]);
    expect(q.body.items[2]).toMatchObject({ draft: null, latest: { decision: 'approved', draftId: gone.id, version: 1 }, stateReason: expect.any(String) });
    expect(q.body.items[0]).toMatchObject({ draft: { version: 2, status: 'draft', payloadHash: null, canApprove: false, cannotApproveReason: 'not ready' }, latest: { version: 1 } });
    expect(q.body.summary.counts).toEqual({ waiting: 1, approved: 0, rejected: 0, invalid: 2, expired: 0, paused: 0 });
    expect(q.body.summary.monthDecisions).toBe(2);
    expect((await call('GET', `/brands/${brand}/approve/queue?state=invalid`)).body.items).toHaveLength(2);

    const detail = await call('GET', `/brands/${brand}/approve/queue/${gone.id}`);
    expect(detail).toMatchObject({ status: 200, body: { draftId: gone.id, state: 'invalid', draft: null, history: [{ decision: 'approved' }] } });
  });

  it('records one view per version and payload, however often the preview is read', async () => {
    const brand = await t.makeBrand();
    const d = studio.put(brand);
    const p = `/brands/${brand}/approve/queue/${d.id}`;
    for (let i = 0; i < 3; i++) expect((await call('GET', p)).status).toBe(200);
    expect(await views(d.id)).toEqual([1]);
    const q = (await call('GET', `/brands/${brand}/approve/queue`)).body.items[0];
    expect(q.draft).toMatchObject({ viewed: true, bulkReason: null });
    studio.edit(brand, d.id, { status: 'ready', readyVersion: 2 });
    expect((await call('GET', `/brands/${brand}/approve/queue`)).body.items[0].draft).toMatchObject({ version: 2, viewed: false, bulkReason: 'open its preview first' });
    for (let i = 0; i < 2; i++) await call('GET', p);
    expect(await views(d.id)).toEqual([1, 2]);
  });

  it('validates every body and query and answers 400 with the base error shape', async () => {
    const brand = await t.makeBrand();
    const d = studio.put(brand);
    const p = `/brands/${brand}/approve`;
    const h = hashOf(d);
    const bad = [
      await call('GET', `${p}/queue?state=lost`),
      await call('POST', `${p}/queue/${d.id}/approve`, {}),
      await call('POST', `${p}/queue/${d.id}/approve`, { payloadHash: 'abc' }),
      await call('POST', `${p}/queue/${d.id}/approve`, { payloadHash: h.toUpperCase() }),
      await call('POST', `${p}/queue/${d.id}/approve`, { payloadHash: h, reviewNote: 'x'.repeat(2001) }),
      await call('POST', `${p}/queue/${d.id}/reject`, { payloadHash: h }),
      await call('POST', `${p}/queue/${d.id}/reject`, { payloadHash: h, reason: '   ' }),
      await call('POST', `${p}/queue/${d.id}/reject`, { payloadHash: h, reason: '​' }),
      await call('POST', `${p}/bulk-approve`, { items: [] }),
      await call('POST', `${p}/bulk-approve`, { items: [{ draftId: d.id }] }),
      await call('POST', `${p}/bulk-approve`, { items: Array.from({ length: 51 }, () => ({ draftId: d.id, payloadHash: h })) }),
      await call('PUT', `${p}/settings`, { maxAgeDays: 0, approvers: [] }),
      await call('PUT', `${p}/settings`, { maxAgeDays: 91, approvers: [] }),
      await call('PUT', `${p}/settings`, { maxAgeDays: 7, approvers: ['  '] }),
      await call('PUT', `${p}/settings`, { approvers: [] }),
      await call('POST', `${p}/pause`, {}),
      await call('POST', `${p}/pause`, { reason: ' ' }),
      await call('POST', `${p}/resume`, { reason: '' }),
    ];
    for (const r of bad) expect(r).toMatchObject({ status: 400, body: { error: { code: 'validation', message: expect.any(String) } } });
    const notJson = await app.request(`/api${p}/pause`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    expect(notJson.status).toBe(400);
    expect(await t.adminQuery(`select 1 from approvals where brand_id = $1`, [brand])).toEqual([]);
    expect((await call('GET', `${p}/settings`)).body.paused).toBe(false);
  });

  it('runs the whole flow: queue, preview, approve, summary, pause and resume, reject a new version', async () => {
    const brand = await t.makeBrand();
    const p = `/brands/${brand}/approve`;
    const d = studio.put(brand, { content: content('Only Rs 4,500 this week.') });
    let q = (await call('GET', `${p}/queue`)).body;
    expect(q.items).toHaveLength(1);
    expect(q.items[0]).toMatchObject({
      state: 'waiting', latest: null,
      draft: { kind: 'static', channel: 'facebook', day: '2026-12-01', weekStart: '2026-11-29', risk: 'medium', riskReasons: ['Price "Rs 4,500"'], payloadHash: hashOf(d), canApprove: true, viewed: false, thumbnailUrl: expect.stringContaining('http') },
    });
    expect(q.items[0].draft.excerpt).toBe('Only Rs 4,500 this week.');

    const pv = (await call('GET', `${p}/queue/${d.id}`)).body;
    expect(pv).toMatchObject({ state: 'waiting', paused: false, history: [], draft: { payloadHash: hashOf(d), canApprove: true, canReject: true, noteRequired: false, renders: [{ ratio: '1:1', type: 'image', index: 0 }] } });
    expect(Date.parse(pv.draft.expiresIfApproved) - Date.now()).toBeGreaterThan(13.9 * 86_400_000);

    const stale = await call('POST', `${p}/queue/${d.id}/approve`, { payloadHash: '0'.repeat(64) });
    expect(stale).toMatchObject({ status: 409, body: { error: { code: 'conflict', message: 'changed since you opened it' } } });
    const done = await call('POST', `${p}/queue/${d.id}/approve`, { payloadHash: pv.draft.payloadHash });
    expect(done).toMatchObject({ status: 200, body: { state: 'approved', draft: { canApprove: false, cannotApproveReason: 'this version already has a decision' }, history: [{ decision: 'approved', risk: 'medium' }] } });
    expect((await call('POST', `${p}/queue/${d.id}/approve`, { payloadHash: pv.draft.payloadHash })).status).toBe(409);

    expect((await call('POST', `${p}/pause`, { reason: 'Election silence' })).body).toMatchObject({ paused: true, pausedReason: 'Election silence' });
    q = (await call('GET', `${p}/queue`)).body;
    expect(q.items[0].state).toBe('paused');
    expect((await call('GET', `${p}/summary`)).body).toMatchObject({ paused: true, pausedReason: 'Election silence', counts: { paused: 1 }, monthDecisions: 1 });
    expect((await call('POST', `${p}/resume`, { reason: 'Over' })).body).toMatchObject({ paused: false, pausedReason: null, pausedAt: null });
    expect((await call('GET', `${p}/summary`)).body.counts.approved).toBe(1);

    const v2 = studio.edit(brand, d.id, { status: 'ready', readyVersion: 2 });
    expect((await call('GET', `${p}/queue`)).body.items[0].state).toBe('waiting');
    const rej = await call('POST', `${p}/queue/${d.id}/reject`, { payloadHash: hashOf(v2), reason: 'Price is out of date' });
    expect(rej).toMatchObject({ status: 200, body: { state: 'rejected', stateReason: 'Price is out of date', history: [{ version: 2, decision: 'rejected' }, { version: 1, decision: 'approved' }] } });

    expect((await call('PUT', `${p}/settings`, { maxAgeDays: 30, approvers: ['Sita', 'Ram'] })).body).toMatchObject({ maxAgeDays: 30, approvers: ['Sita', 'Ram'], paused: false });
    expect((await call('GET', `${p}/settings`)).body.maxAgeDays).toBe(30);
  });

  it('bulk-approves through the API and explains a high-risk item', async () => {
    const brand = await t.makeBrand();
    const p = `/brands/${brand}/approve`;
    const [x, y] = [studio.put(brand), studio.put(brand)];
    const risky = studio.put(brand, { content: content('Results guaranteed.') });
    for (const d of [x, y, risky]) await call('GET', `${p}/queue/${d.id}`);
    const q = (await call('GET', `${p}/queue`)).body.items;
    expect(q.find((i: any) => i.draftId === risky.id).draft).toMatchObject({ risk: 'high', noteRequired: true, bulkReason: expect.stringMatching(/high risk/) });
    const refused = await call('POST', `${p}/bulk-approve`, { items: [x, risky].map((d) => ({ draftId: d.id, payloadHash: hashOf(d) })) });
    expect(refused.status).toBe(409);
    const ok = await call('POST', `${p}/bulk-approve`, { items: [x, y].map((d) => ({ draftId: d.id, payloadHash: hashOf(d) })) });
    expect(ok).toMatchObject({ status: 200, body: { bulkId: expect.any(String), decisions: [{ draftId: x.id }, { draftId: y.id }] } });
    expect(ok.body.decisions[1].bulkId).toBe(ok.body.bulkId);
  });
});
