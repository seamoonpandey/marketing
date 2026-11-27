import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { F1, facts } from '../../../test/fixtures/plan/facts.ts';
import { launchTestWorkflows, testDb, type TestDb } from '../../../test/helpers.ts';
import { createApp } from '../../app.ts';
import { mockAi } from '../../ai/index.ts';
import { withBrand } from '../../db/tenant.ts';
import { addItem } from './weeks.ts';
import { createCampaign } from './campaigns.ts';
import { editBrief, type BriefBody } from './brief.ts';
import { setSettings } from './settings.ts';
import { briefSections } from './enums.ts';

let t: TestDb;
let stop: () => Promise<void>;
const app = createApp();
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
};
const denied = async (id: string) => (await t.adminQuery(`select 1 from audit_events where result = 'denied' and object_id = $1`, [id])).length;
const SUN = '2026-11-29';

beforeAll(async () => {
  t = await testDb();
  stop = await launchTestWorkflows(t);
});
afterAll(async () => {
  await stop();
  await t.close();
});
afterEach(() => mockAi.reset());

describe('plan API', () => {
  it("answers 404 and audits a denied event for brand B's campaign, brief, item and run through brand A", async () => {
    const a = await t.makeBrand();
    const b = await t.makeBrand();
    await withBrand(b, (tx) => setSettings(tx, b, { channels: [{ channel: 'facebook', postsPerWeek: 1 }], pillars: [], weekStarts: 0 }));
    const camp = await withBrand(b, (tx) => createCampaign(tx, b, { name: 'B', objective: 'awareness' }));
    await withBrand(b, (tx) => editBrief(tx, b, camp.id, Object.fromEntries(briefSections.map((s) => [s, []])) as unknown as BriefBody, facts));
    const item = await withBrand(b, (tx) => addItem(tx, b, SUN, { day: SUN, channel: 'facebook' }));
    const [run] = await t.adminQuery(`insert into plan_runs (tenant_id, brand_id, kind, target_id, state) values ($1, $2, 'week', $3, 'running') returning id`, [t.tenantId, b, SUN]);
    const base = `/brands/${a}/plan`;

    expect((await call('GET', `${base}/campaigns/${camp.id}`)).status).toBe(404);
    expect(await denied(camp.id)).toBe(1);
    expect((await call('GET', `${base}/campaigns/${camp.id}/brief`)).status).toBe(404);
    expect((await call('PATCH', `${base}/campaigns/${camp.id}`, { name: 'hijack' })).status).toBe(404);
    expect((await call('POST', `${base}/campaigns/${camp.id}/brief/approve`, { version: 1 })).status).toBe(404);
    expect(await denied(camp.id)).toBe(4);
    expect((await call('PATCH', `${base}/items/${item.id}`, { cta: 'x' })).status).toBe(404);
    expect((await call('DELETE', `${base}/items/${item.id}`)).status).toBe(404);
    expect(await denied(item.id)).toBe(2);
    expect((await call('GET', `${base}/runs/${run.id}`)).status).toBe(404);
    expect((await call('POST', `${base}/runs/${run.id}/cancel`)).status).toBe(404);
    expect(await denied(run.id)).toBe(2);
    // A week is addressed by its date, so brand A reads its own (empty) week, never B's.
    expect((await call('GET', `${base}/weeks/${SUN}`)).body).toMatchObject({ plan: null, items: [] });
    expect((await call('GET', `/brands/${b}/plan/weeks/${SUN}`)).body.items).toHaveLength(1);
    expect((await call('GET', `${base}/campaigns`)).body).toEqual([]);
  });

  it('GET /overview for a new brand has two weeks with no plan, nothing else, and a zero cost', async () => {
    const brand = await t.makeBrand();
    const { status, body } = await call('GET', `/brands/${brand}/plan/overview`);
    expect(status).toBe(200);
    expect(body.weeks).toHaveLength(2);
    expect(body.weeks.map((w: any) => w.status)).toEqual(['none', 'none']);
    expect(new Date(`${body.weeks[1].weekStart}T00:00:00Z`).getTime() - new Date(`${body.weeks[0].weekStart}T00:00:00Z`).getTime()).toBe(7 * 86_400_000);
    expect(new Date(`${body.weeks[0].weekStart}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(body).toMatchObject({ activeCampaigns: [], opportunities: [], monthCost: { usd: '0.0000', npr: '0.00' }, ready: { facts: false, channels: false } });
  });

  it('overview survives a brand with an invalid timezone', async () => {
    const brand = await t.makeBrand();
    await t.adminQuery(`update brands set timezone = 'Mars/Olympus' where id = $1`, [brand]);
    expect((await call('GET', `/brands/${brand}/plan/overview`)).status).toBe(200);
  });

  it('answers 400 with the shared error shape for a bad body, a bad date and a misaligned week', async () => {
    const brand = await t.makeBrand();
    const p = `/brands/${brand}/plan`;
    const bad = [
      await call('PUT', `${p}/settings`, { channels: [{ channel: 'myspace', postsPerWeek: 2 }], pillars: [], weekStarts: 0 }),
      await call('PUT', `${p}/settings`, { channels: [{ channel: 'x', postsPerWeek: 99 }], pillars: [], weekStarts: 0 }),
      await call('PUT', `${p}/settings`, { channels: [{ channel: 'x', postsPerWeek: 1 }, { channel: 'x', postsPerWeek: 2 }], pillars: [], weekStarts: 0 }),
      await call('POST', `${p}/campaigns`, { name: '', objective: 'awareness' }),
      await call('POST', `${p}/campaigns`, { name: 'x', objective: 'fame' }),
      await call('POST', `${p}/campaigns`, { name: 'x', objective: 'awareness', startsOn: '2026-10-05', endsOn: '2026-10-01' }),
      await call('PATCH', `${p}/campaigns/${F1}`, { budgetNpr: 'lots' }),
      await call('PATCH', `${p}/campaigns/${F1}/brief`, { body: { goal_kpi: 'nope' } }),
      await call('GET', `${p}/weeks/not-a-date`),
      await call('GET', `${p}/weeks/2026-11-30`),
      await call('POST', `${p}/weeks/${SUN}/items`, { day: SUN }),
      await call('POST', `${p}/weeks/${SUN}/items`, { day: '2026-12-20', channel: 'x' }),
      await call('PATCH', `${p}/items/${F1}`, { format: 'hologram' }),
    ];
    for (const r of bad) expect(r).toMatchObject({ status: 400, body: { error: { code: 'validation', message: expect.any(String) } } });
  });

  it('runs a whole week through the API: settings, items, balance, approval, edit back to draft', async () => {
    const brand = await t.makeBrand();
    const p = `/brands/${brand}/plan`;
    expect((await call('PUT', `${p}/settings`, { channels: [{ channel: 'facebook', postsPerWeek: 1 }], pillars: [{ pillar: 'product', weight: 1 }], weekStarts: 0 })).status).toBe(200);
    expect((await call('GET', `${p}/settings`)).body.channels).toHaveLength(1);
    // No approved fact yet: drafting is refused with 400, no model call.
    expect((await call('POST', `${p}/weeks/${SUN}/draft`)).status).toBe(400);
    expect((await call('POST', `${p}/weeks/${SUN}/estimate`)).status).toBe(400);
    expect(mockAi.calls).toEqual([]);

    const added = await call('POST', `${p}/weeks/${SUN}/items`, { day: SUN, channel: 'facebook', idea: 'Shawl story' });
    expect(added).toMatchObject({ status: 201, body: { plan: { status: 'draft', version: 1 } } });
    let w = (await call('GET', `${p}/weeks/${SUN}`)).body;
    expect(w).toMatchObject({ canApprove: false, blockingCount: 1, violations: [{ rule: 'incomplete', blocking: true }], ready: { facts: false, channels: true } });
    expect(w.cannotApproveReason).toMatch(/Missing/);
    expect((await call('POST', `${p}/weeks/${SUN}/approve`, { version: 1 })).status).toBe(409);

    const id = added.body.item.id;
    expect((await call('PATCH', `${p}/items/${id}`, { cta: 'Visit', pillar: 'product', funnel: 'unaware', format: 'image' })).status).toBe(200);
    w = (await call('POST', `${p}/weeks/${SUN}/approve`, { version: 1 })).body;
    expect(w).toMatchObject({ plan: { status: 'approved' }, canApprove: false, violations: [] });
    const edited = await call('PATCH', `${p}/items/${id}`, { cta: 'Order now' });
    expect(edited.body.plan.status).toBe('draft');
    expect((await call('DELETE', `${p}/items/${id}`)).body.plan.status).toBe('draft');
  });

  it('serves a campaign with its brief view and refuses a dismissed opportunity', async () => {
    const brand = await t.makeBrand();
    const p = `/brands/${brand}/plan`;
    const [opp] = await t.adminQuery(
      `insert into opportunities (tenant_id, brand_id, title, hypothesis, suggested_action, why_it_matters, observation_ids, confidence, status)
       values ($1, $2, 'T', 'H', 'A', 'W', '{}', 'low', 'dismissed') returning id`, [t.tenantId, brand]);
    expect((await call('POST', `${p}/campaigns`, { name: 'x', objective: 'awareness', opportunityId: opp.id })).status).toBe(400);
    const created = await call('POST', `${p}/campaigns`, { name: 'Dashain', objective: 'conversion', budgetNpr: '50000' });
    expect(created).toMatchObject({ status: 201, body: { status: 'draft', budgetNpr: '50000.00' } });
    const id = created.body.id;
    expect((await call('PATCH', `${p}/campaigns/${id}`, { status: 'active' })).body.status).toBe('active');
    expect((await call('GET', `${p}/campaigns?status=active`)).body).toHaveLength(1);
    expect((await call('GET', `${p}/campaigns/${id}/brief`)).body).toMatchObject({ approved: null, draft: null, campaign: { id }, facts: [], latestRun: null });
    expect((await call('POST', `${p}/campaigns/${id}/brief/approve`, { version: 1 })).status).toBe(409);
    expect((await call('POST', `${p}/campaigns/${id}/brief/generate`)).status).toBe(400); // no approved fact
    const [acc] = await t.adminQuery(
      `insert into opportunities (tenant_id, brand_id, title, hypothesis, suggested_action, why_it_matters, observation_ids, confidence, status)
       values ($1, $2, 'Rival cut prices', 'H', 'Answer with value', 'W', '{}', 'high', 'accepted') returning id`, [t.tenantId, brand]);
    const o = (await call('GET', `${p}/overview`)).body;
    expect(o.opportunities).toEqual([{ id: acc.id, title: 'Rival cut prices', suggestedAction: 'Answer with value', whyItMatters: 'W', confidence: 'high' }]);
    await call('POST', `${p}/campaigns`, { name: 'From it', objective: 'awareness', opportunityId: acc.id });
    expect((await call('GET', `${p}/overview`)).body.opportunities).toEqual([]);
    expect(o.activeCampaigns.map((c: any) => c.id)).toEqual([id]);
  });
});
