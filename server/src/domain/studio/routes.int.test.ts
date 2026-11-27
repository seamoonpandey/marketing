import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { studioBrand, SUN } from '../../../test/fixtures/studio/setup.ts';
import { launchTestWorkflows, testDb, type TestDb } from '../../../test/helpers.ts';
import { createApp } from '../../app.ts';
import { mockAi } from '../../ai/index.ts';
import { withBrand } from '../../db/tenant.ts';
import { getDraft } from './drafts.ts';
import { getRun, startGenerate } from './runs.ts';

let t: TestDb;
let stop: () => Promise<void>;
const app = createApp();
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
};
const denied = async (id: string) => (await t.adminQuery(`select 1 from audit_events where result = 'denied' and object_id = $1`, [id])).length;
const settle = async (brand: string, runId: string) => {
  for (let i = 0; i < 200; i++) {
    const r = await withBrand(brand, (tx) => getRun(tx, brand, runId));
    if (r.state !== 'running') return r;
    await new Promise((x) => setTimeout(x, 50));
  }
  throw new Error('run did not finish');
};
const answer = (priceId: string) => ({
  copies: [{ language: 'en', sentences: [{ text: 'A warm shawl.', claim: true, factIds: [priceId] }], hashtags: [], cta: 'Order today' }],
  slides: [{ headline: 'Pashmina' }, { headline: 'Hand-woven' }],
});

beforeAll(async () => {
  t = await testDb();
  stop = await launchTestWorkflows(t);
});
afterAll(async () => {
  await stop();
  await t.close();
});
afterEach(() => mockAi.reset());

describe('studio API', () => {
  it("answers 404 and audits a denied event for brand B's draft, run and render through brand A", async () => {
    const a = await t.makeBrand();
    const b = await studioBrand(t, { formats: ['carousel'] });
    mockAi.queue(answer(b.price.id));
    const { runId } = await startGenerate(b.brand, b.itemIds, b.facts);
    await settle(b.brand, runId);
    const draft = await withBrand(b.brand, async (tx) => (await getDraft(tx, b.brand, (await t.adminQuery(`select id from studio_drafts where brand_id = $1`, [b.brand]))[0]!.id, b.facts)));
    const base = `/brands/${a}/studio`;
    expect((await call('GET', `${base}/drafts/${draft.id}`)).status).toBe(404);
    expect((await call('PATCH', `${base}/drafts/${draft.id}`, { template: 'offer' })).status).toBe(404);
    expect((await call('POST', `${base}/drafts/${draft.id}/render`)).status).toBe(404);
    expect((await call('POST', `${base}/drafts/${draft.id}/ready`)).status).toBe(404);
    expect(await denied(draft.id)).toBe(4);
    expect((await call('GET', `${base}/runs/${runId}`)).status).toBe(404);
    expect((await call('POST', `${base}/runs/${runId}/cancel`)).status).toBe(404);
    expect((await call('POST', `${base}/runs/${runId}/retry`)).status).toBe(404);
    expect(await denied(runId)).toBe(3);
    expect((await call('POST', `${base}/drafts`, { planItemIds: b.itemIds })).status).toBe(404);
    expect((await call('POST', `${base}/drafts/estimate`, { planItemIds: b.itemIds })).status).toBe(404);
    expect(await denied(b.itemIds[0]!)).toBe(2);
    expect((await call('GET', `${base}/overview?weekStart=${SUN}`)).body).toMatchObject({ items: [] });
    expect((await call('GET', `/brands/${b.brand}/studio/drafts/${draft.id}`)).status).toBe(200);
    expect((await call('GET', `${base}/drafts/not-an-id`)).status).toBe(404);
  });

  it('overview for a week with no approved plan says so and lists no items', async () => {
    const s = await studioBrand(t, { formats: ['text'], approve: false });
    const r = await call('GET', `/brands/${s.brand}/studio/overview?weekStart=${SUN}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ weekStart: SUN, planApproved: false, items: [], latestRun: null, ready: { facts: true }, monthCost: { npr: '0.00' } });
    const empty = await t.makeBrand();
    await withBrand(empty, async () => undefined);
    expect((await call('GET', `/brands/${empty}/studio/overview`)).body).toMatchObject({ planApproved: false, items: [], ready: { facts: false } });
  });

  it('runs the whole flow through the API: estimate, draft, view with render URLs, overview, ready', async () => {
    const s = await studioBrand(t, { formats: ['carousel', 'text'] });
    const base = `/brands/${s.brand}/studio`;
    expect((await call('GET', `${base}/templates`)).body.ratios).toHaveLength(4);
    const est = await call('POST', `${base}/drafts/estimate`, { planItemIds: s.itemIds });
    expect(est.body).toMatchObject({ count: 2, estimate: { npr: expect.stringMatching(/^\d+\.\d\d$/) }, remaining: { npr: expect.any(String) } });
    mockAi.queue(answer(s.price.id), answer(s.price.id));
    const started = await call('POST', `${base}/drafts`, { planItemIds: s.itemIds });
    expect(started).toMatchObject({ status: 201, body: { kind: 'generate', state: 'running' } });
    await settle(s.brand, started.body.id);
    const ov = await call('GET', `${base}/overview?weekStart=${SUN}`);
    expect(ov.body).toMatchObject({ planApproved: true, latestRun: { id: started.body.id, state: 'completed' } });
    expect(ov.body.items.map((i: any) => i.item.kind)).toEqual(['carousel', 'post']);
    expect(ov.body.items.every((i: any) => i.draft && i.draft.status === 'draft')).toBe(true);
    expect(ov.body.monthCost.npr).not.toBe('0.00');
    const id = ov.body.items[0].draft.id;
    expect((await call('GET', `${base}/drafts/${id}`)).body).toMatchObject({ canMarkReady: false, cannotMarkReadyReason: expect.stringContaining('blocking'), renders: [], planApproved: true, latestRun: { kind: 'generate' } });
    expect((await call('POST', `${base}/drafts/${id}/ready`)).status).toBe(409);
    expect((await call('POST', `${base}/drafts/${ov.body.items[1].draft.id}/render`)).status).toBe(409); // a text post has nothing to render
    const edited = await call('PATCH', `${base}/drafts/${id}`, { template: 'offer', baseVersion: 1 });
    expect(edited.body).toMatchObject({ draft: { currentVersion: 2 }, content: { template: 'offer' }, version: { origin: 'owner' } });
    expect((await call('PATCH', `${base}/drafts/${id}`, { template: 'offer', baseVersion: 1 })).status).toBe(409);
  });

  it('answers 404, not a database error, for a run id that only looks like a UUID', async () => {
    const s = await studioBrand(t);
    expect((await call('GET', `/brands/${s.brand}/studio/runs/${'-'.repeat(36)}`)).status).toBe(404);
  });

  it('validates every body and query with a 400 in the shared error shape', async () => {
    const s = await studioBrand(t, { formats: ['carousel'] });
    const base = `/brands/${s.brand}/studio`;
    mockAi.queue(answer(s.price.id));
    await settle(s.brand, (await startGenerate(s.brand, s.itemIds, s.facts)).runId);
    const id = (await t.adminQuery(`select id from studio_drafts where brand_id = $1`, [s.brand]))[0]!.id;
    const bad: [string, string, unknown][] = [
      ['POST', `${base}/drafts`, {}], ['POST', `${base}/drafts`, { planItemIds: [] }], ['POST', `${base}/drafts`, { planItemIds: 'x' }],
      ['POST', `${base}/drafts`, { planItemIds: Array(51).fill('a') }], ['POST', `${base}/drafts/estimate`, { planItemIds: [1] }],
      ['PATCH', `${base}/drafts/${id}`, { template: 'neon' }], ['PATCH', `${base}/drafts/${id}`, { ratios: [] }], ['PATCH', `${base}/drafts/${id}`, { baseVersion: 'one' }],
      ['PATCH', `${base}/drafts/${id}`, { slides: [{ headline: '' }] }], ['PATCH', `${base}/drafts/${id}`, { copies: [{ language: 'en', sentences: [{ text: 'x' }], cta: 'y' }] }],
      ['GET', `${base}/overview?weekStart=tomorrow`, undefined], ['GET', `${base}/overview?weekStart=2026-11-30`, undefined], // a Monday
    ];
    for (const [m, p, body] of bad) {
      const r = await call(m, p, body);
      expect([m, p, r.status]).toEqual([m, p, 400]);
      expect(r.body).toEqual({ error: { code: 'validation', message: expect.any(String) } });
    }
    // Domain rules are 400 too: a photo that is not the brand's is 404, a language it lacks is 400.
    expect((await call('PATCH', `${base}/drafts/${id}`, { copies: [{ language: 'fr', sentences: [], cta: 'x' }] })).status).toBe(400);
    expect((await call('PATCH', `${base}/drafts/${id}`, { slides: [{ headline: 'a', photoAssetId: s.price.id }, { headline: 'b' }] })).status).toBe(404);
  });
});
