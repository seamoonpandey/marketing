import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { mockAi } from '../../ai/index.ts';
import { withBrand } from '../../db/tenant.ts';
import { approve, reject } from '../approve/decisions.ts';
import { setPaused } from '../approve/settings.ts';
import { content, fakeStudio, fakeTenant, hashOf } from '../approve/studio.fake.ts';
import { createCompetitor } from '../brands/index.ts';
import { approveFact, approvedFacts, enterFact, listFacts, proposeFacts, resolveConflict } from '../knowledge/index.ts';
import { addItem, approveWeek, createCampaign, getWeek, setSettings } from '../plan/index.ts';
import { approveBrief, storeBrief } from '../plan/brief.ts';
import { briefSections } from '../plan/enums.ts';
import { createChannel, cancelJob, confirmManual, resolveUnknown, scheduleJob } from '../publish/index.ts';
import { fakeReads } from '../publish/fake-reads.ts';
import { decideOpportunity, generateOpportunities } from '../research/index.ts';
import { addDays, todayIn as dayIn } from '../plan/index.ts';
import { home, readers } from './index.ts';

let t: TestDb;
const studio = fakeStudio();
const pub = fakeReads();
const original = { ...readers };
beforeAll(async () => {
  t = await testDb();
  fakeTenant.id = t.tenantId;
});
afterAll(() => t.close());
afterEach(() => {
  mockAi.reset();
  Object.assign(readers, original);
});
const use = () => Object.assign(readers, { studio: studio.reads, publish: pub.reads });

const kinds = async (brand: string) => (await home(brand)).items.map((i) => i.kind);
const item = async (brand: string, kind: string) => (await home(brand)).items.find((i) => i.kind === kind);
const TZ = 'Asia/Kathmandu';
const today = () => dayIn(TZ, new Date());
const weekStart = (offset = 0) => addDays(addDays(today(), -new Date(`${today()}T00:00:00Z`).getUTCDay()), offset * 7); // weeks start on Sunday
const facts = (b: string) => withBrand(b, (tx) => approvedFacts(tx, b));
const owner = (b: string, field: string, value: unknown, section = 'products') =>
  withBrand(b, async (tx) => enterFact(tx, b, { section, field, value, unit: field === 'price' ? 'NPR' : null, language: 'en', subjectId: null }));

/** A brand with an approved brand-level fact and a plan channel, so plan and studio items can appear. */
async function readyBrand() {
  const b = await t.makeBrand();
  await withBrand(b, (tx) => setSettings(tx, b, { channels: [{ channel: 'facebook', postsPerWeek: 3 }], pillars: [], weekStarts: 0 }));
  const f = await withBrand(b, (tx) => enterFact(tx, b, { section: 'positioning', field: 'proof', value: 'Hand-woven pashmina', language: 'en' }));
  return { b, factId: f.id };
}
async function approvePlan(b: string, factId: string, offset = 0) {
  const ws = weekStart(offset);
  const fs = await facts(b);
  await withBrand(b, async (tx) => {
    const item = await addItem(tx, b, ws, { day: ws, channel: 'facebook', format: 'image', pillar: 'product', funnel: 'unaware', intent: 'teach', idea: 'Shawl story', cta: 'Visit', factIds: [factId] });
    await approveWeek(tx, b, ws, fs, (await getWeek(tx, b, ws, fs)).plan!.version);
    return item;
  });
  return (await t.adminQuery(`select id from plan_items where brand_id = $1 order by created_at desc limit 1`, [b]))[0].id as string;
}

describe('a new brand', () => {
  it('shows the setup path one step at a time, each step appearing when the one before it is done', async () => {
    const b = await t.makeBrand();
    let h = await home(b);
    expect(h.items.map((i) => [i.kind, i.urgency, i.module])).toEqual([['setup_import', 'today', 'brand']]);
    expect(h.items[0]!.href).toBe(`/app/b/${b}/brand/sources`);
    expect(h.partial).toEqual([]);
    expect(h.paused).toBeNull();

    // facts proposed by an import: the next step is to review them
    const [src] = await t.adminQuery(
      `insert into sources (tenant_id, brand_id, kind, uri, mime, checksum, object_key, text, trust) values ($1, $2, 'page', 'https://s.example/', 'text/html', 'x', 'k', 'We are Himal Tea.', 'brand_site') returning id`, [t.tenantId, b]);
    await withBrand(b, (tx) => proposeFacts(tx, b, randomUUID(), [{ section: 'identity', field: 'legal_name', value: 'Himal Tea', language: 'en', origin: 'stated', sourceId: src.id, quote: 'Himal Tea', confidence: 0.9 }], [src.id]));
    h = await home(b);
    expect(h.items.map((i) => [i.kind, i.urgency])).toEqual([['facts_review', 'today']]);

    // one approved fact: choose channels
    const [fact] = (await withBrand(b, (tx) => listFacts(tx, b))).items;
    await withBrand(b, (tx) => approveFact(tx, b, fact!.id));
    expect(await kinds(b)).toEqual(expect.arrayContaining(['setup_channels']));
    expect(await kinds(b)).not.toContain('setup_competitor');

    // channels chosen: the week needs a plan and a competitor is the next setup step
    await withBrand(b, (tx) => setSettings(tx, b, { channels: [{ channel: 'facebook', postsPerWeek: 3 }], pillars: [], weekStarts: 0 }));
    expect(await kinds(b)).toEqual(expect.arrayContaining(['plan_week_missing', 'setup_competitor']));
    expect(await kinds(b)).not.toContain('setup_channels');
    await withBrand(b, (tx) => createCompetitor(tx, b, { name: 'Rival', kind: 'direct', site: 'https://rival.example', handles: {}, adLibraryUrl: null, priority: 1 } as never));
    expect(await kinds(b)).not.toContain('setup_competitor');
  });
});

describe('each kind appears from seeded data and goes when it is dealt with', () => {
  it('publish: a post to publish by hand, an unknown outcome, a blocked job', async () => {
    use();
    const brand = await t.makeBrand();
    const channel = await withBrand(brand, (tx) => createChannel(tx, brand, { platform: 'facebook', accountName: '@brand' }));
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const job = async (state: string) => {
      const d = pub.add(brand);
      const j = await withBrand(brand, (tx) => scheduleJob(tx, brand, { draftId: d.id, channelId: channel.id, scheduledAt: `${day}T10:00:00+05:45` }, [], pub.reads));
      await t.adminQuery(`update publish_jobs set state = $2, attempts = 1 where id = $1`, [j.id, state]);
      return j;
    };
    expect(await kinds(brand)).toEqual(['setup_import']);
    const manual = await job('awaiting_manual');
    const unknown = await job('unknown');
    const blocked = await job('blocked');
    const h = await home(brand);
    expect(h.items.slice(0, 3).map((i) => [i.kind, i.urgency, i.count])).toEqual([['publish_manual', 'now', null], ['publish_unknown', 'now', null], ['publish_stuck', 'now', null]]);
    expect(h.items[0]!.href).toBe(`/app/b/${brand}/publish/jobs/${manual.id}`);
    expect(h.items[0]!.due).toBe(new Date(`${day}T10:00:00+05:45`).toISOString());

    await withBrand(brand, (tx) => confirmManual(tx, brand, manual.id, 'https://facebook.com/brand/posts/1'));
    await withBrand(brand, (tx) => resolveUnknown(tx, brand, unknown.id, { posted: true, url: 'https://facebook.com/brand/posts/2' }));
    await withBrand(brand, (tx) => cancelJob(tx, brand, blocked.id));
    expect(await kinds(brand)).toEqual(['setup_import']);
  });

  it('publish: several posts of one kind are one item with a count', async () => {
    use();
    const brand = await t.makeBrand();
    const channel = await withBrand(brand, (tx) => createChannel(tx, brand, { platform: 'facebook', accountName: '@brand' }));
    for (let i = 0; i < 3; i++) {
      const d = pub.add(brand);
      const j = await withBrand(brand, (tx) => scheduleJob(tx, brand, { draftId: d.id, channelId: channel.id, scheduledAt: `${new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)}T1${i}:00:00+05:45` }, [], pub.reads));
      await t.adminQuery(`update publish_jobs set state = 'awaiting_manual' where id = $1`, [j.id]);
    }
    const manual = (await home(brand)).items.filter((i) => i.kind === 'publish_manual');
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({ count: 3, title: '3 posts are ready to publish by hand', href: `/app/b/${brand}/publish` });
  });

  it('approve and studio: drafts due soon, later, lapsed and blocked', async () => {
    use();
    const brand = await t.makeBrand();
    const fs = await facts(brand);
    const ok = (d: { id: string }, over = {}) => withBrand(brand, async (tx) => approve(tx, brand, { draftId: d.id, payloadHash: hashOf((await studio.reads.getDraft(tx, brand, d.id, fs))!) }, fs, studio.reads));
    const due = studio.put(brand, { day: today() });
    const later = studio.put(brand, { day: addDays(today(), 5) });
    const toLapse = studio.put(brand, { day: addDays(today(), 6) });
    const blocked = studio.put(brand, { day: addDays(today(), 7), findings: [{ check: 'prohibited_word', blocking: true, where: 'caption en', message: 'x' }] });
    await ok(toLapse);
    studio.edit(brand, toLapse.id, { content: content('Changed after approval.') });
    const h = await home(brand);
    const by = Object.fromEntries(h.items.map((i) => [i.kind, i]));
    expect(by.approvals_due).toMatchObject({ urgency: 'today', module: 'approve', title: '1 draft is waiting for your approval', href: `/app/b/${brand}/approve/${due.id}` });
    expect(by.approvals_due!.due).toBe(new Date(`${addDays(today(), -1)}T18:15:00Z`).toISOString()); // the start of today in Kathmandu
    expect(by.approvals_waiting).toMatchObject({ urgency: 'soon', href: `/app/b/${brand}/approve/${later.id}` });
    expect(by.approvals_lapsed).toMatchObject({ urgency: 'soon' });
    expect(by.drafts_blocked).toMatchObject({ module: 'studio', href: `/app/b/${brand}/studio/drafts/${blocked.id}` });

    await ok(due);
    await ok(later);
    studio.edit(brand, toLapse.id, { status: 'ready', readyVersion: 3 });
    await ok(toLapse);
    studio.edit(brand, blocked.id, { findings: [], status: 'ready', readyVersion: 2 });
    expect((await kinds(brand)).filter((k) => k.startsWith('approvals') || k === 'drafts_blocked')).toEqual(['approvals_waiting']);
    await ok(blocked);
    expect((await kinds(brand)).filter((k) => k.startsWith('approvals') || k === 'drafts_blocked')).toEqual([]);
  });

  it('approve: a rejected draft is not asked for again, and a paused brand reports its reason', async () => {
    use();
    const brand = await t.makeBrand();
    const d = studio.put(brand, { day: today() });
    await withBrand(brand, (tx) => reject(tx, brand, { draftId: d.id, payloadHash: hashOf(d), reason: 'Wrong photo for this post' }, [], studio.reads));
    expect(await kinds(brand)).not.toContain('approvals_due');
    await withBrand(brand, (tx) => setPaused(tx, brand, true, 'Wrong price in the last post'));
    expect((await home(brand)).paused).toMatchObject({ reason: 'Wrong price in the last post' });
    await withBrand(brand, (tx) => setPaused(tx, brand, false, 'Fixed'));
    expect((await home(brand)).paused).toBeNull();
  });

  it('plan and studio: a week with no plan, then no draft yet, then a draft', async () => {
    use();
    const { b, factId } = await readyBrand();
    const planned = async () => (await home(b)).items.filter((i) => i.kind === 'plan_week_missing');
    expect((await planned())[0]).toMatchObject({ title: 'This week and next week have no approved plan', urgency: 'soon', module: 'plan' });
    const itemId = await approvePlan(b, factId, 0);
    expect((await planned())[0]).toMatchObject({ title: 'Next week has no approved plan' });
    const missing = await item(b, 'drafts_missing');
    expect(missing).toMatchObject({ module: 'studio', urgency: 'soon', title: 'An item of this week has no draft yet' });

    const [d] = await t.adminQuery(`insert into studio_drafts (tenant_id, brand_id, plan_item_id, kind) values ($1, $2, $3, 'static') returning id`, [t.tenantId, b, itemId]);
    await t.adminQuery(`insert into studio_versions (tenant_id, brand_id, draft_id, version, origin, content) values ($1, $2, $3, 1, 'owner', $4)`, [t.tenantId, b, d.id, JSON.stringify(content())]);
    expect(await kinds(b)).not.toContain('drafts_missing');
    await approvePlan(b, factId, 1);
    expect(await kinds(b)).not.toContain('plan_week_missing');
  });

  it('plan and the other modules: a run waiting for a cost confirmation, one item per module', async () => {
    use();
    const { b } = await readyBrand();
    const [run] = await t.adminQuery(
      `insert into plan_runs (tenant_id, brand_id, kind, target_id, state) values ($1, $2, 'week', $3, 'awaiting_approval') returning id`, [t.tenantId, b, weekStart()]);
    const h = await home(b);
    expect(h.items.find((i) => i.kind === 'run_confirm')).toMatchObject({ module: 'plan', urgency: 'today' });
    await t.adminQuery(`update plan_runs set state = 'cancelled' where id = $1`, [run.id]);
    expect(await kinds(b)).not.toContain('run_confirm');
    const [w] = await t.adminQuery(`insert into watch_runs (tenant_id, brand_id, trigger, state) values ($1, $2, 'manual', 'awaiting_approval') returning id`, [t.tenantId, b]);
    expect((await item(b, 'run_confirm'))!.module).toBe('research');
    await t.adminQuery(`update watch_runs set state = 'cancelled' where id = $1`, [w.id]);
    expect(await kinds(b)).not.toContain('run_confirm');
  });

  it('plan: a campaign brief waiting for approval', async () => {
    use();
    const { b, factId } = await readyBrand();
    const c = await withBrand(b, (tx) => createCampaign(tx, b, { name: 'Dashain', objective: 'conversion' }));
    const fs = await facts(b);
    const body = Object.fromEntries(briefSections.map((s) => [s, []])) as never;
    await storeBrief(b, c.id, body, fs);
    expect(await item(b, 'brief_waiting')).toMatchObject({ module: 'plan', urgency: 'soon', href: `/app/b/${b}/plan/campaigns/${c.id}` });
    await withBrand(b, (tx) => approveBrief(tx, b, c.id, fs, 1));
    expect(await kinds(b)).not.toContain('brief_waiting');
    void factId;
  });

  it('research: observations of the last seven days and opportunities waiting for a decision', async () => {
    use();
    const { b } = await readyBrand();
    const run = randomUUID();
    const [comp] = await t.adminQuery(`select gen_random_uuid() as id`);
    const [o] = await t.adminQuery(
      `insert into observations (tenant_id, brand_id, competitor_id, run_id, type, summary, after, url, confidence)
       values ($1, $2, $3, $4, 'price_change', 'Price dropped', '{"quote":"Rs 4,500","sourceId":"x"}', 'https://r.example/', 'high') returning id`, [t.tenantId, b, comp.id, run]);
    mockAi.queue({ opportunities: [{ title: 'Answer the price cut', hypothesis: 'h', suggestedAction: 'a', whyItMatters: 'w', observationIds: [o.id], confidence: 'medium' }] });
    const [opp] = await generateOpportunities(b, run, []);
    const by = async () => Object.fromEntries((await home(b)).items.map((i) => [i.kind, i]));
    expect(await by()).toMatchObject({ observations_new: { module: 'research', urgency: 'later' }, opportunities_new: { urgency: 'later', href: `/app/b/${b}/research/opportunities` } });
    await withBrand(b, (tx) => decideOpportunity(tx, b, opp!.id, 'dismissed'));
    await t.adminQuery(`update observations set observed_at = now() - interval '8 days' where id = $1`, [o.id]);
    expect(Object.keys(await by())).not.toEqual(expect.arrayContaining(['observations_new']));
    expect(Object.keys(await by())).not.toEqual(expect.arrayContaining(['opportunities_new']));
  });

  it('brand: conflicting facts, a readiness gate and missing criteria, until the conflict is resolved', async () => {
    use();
    const b = await t.makeBrand();
    await owner(b, 'proof', 'Hand-woven pashmina', 'positioning');
    const src = async (text: string) => (await t.adminQuery(
      `insert into sources (tenant_id, brand_id, kind, uri, mime, checksum, object_key, text, trust) values ($1, $2, 'page', 'https://s.example/', 'text/html', 'x', 'k', $3, 'brand_site') returning id`, [t.tenantId, b, text]))[0].id as string;
    const [a, c] = [await src('Green tea costs NPR 4500 a tin.'), await src('Price list: green tea NPR 5000 a tin.')];
    const price = (s: string, v: number, q: string) => ({ section: 'products' as const, subjectName: 'Green tea', field: 'price', value: v, unit: 'NPR', language: 'en', origin: 'stated' as const, sourceId: s, quote: q, confidence: 0.9 });
    await withBrand(b, (tx) => proposeFacts(tx, b, randomUUID(), [price(a, 4500, 'green tea costs NPR 4500'.replace('green', 'Green')), price(c, 5000, 'green tea NPR 5000'.replace('green', 'green'))], [a, c]));
    const by = async () => Object.fromEntries((await home(b)).items.map((i) => [i.kind, i]));
    const h = await by();
    expect(h.facts_conflicts).toMatchObject({ module: 'brand', urgency: 'soon', count: 2 });
    expect(h.readiness_gates).toMatchObject({ urgency: 'later' });
    expect(h.readiness_missing).toMatchObject({ urgency: 'later' });
    const keep = (await withBrand(b, (tx) => listFacts(tx, b, { status: 'conflicting' }))).items.find((f) => f.value === 4500)!;
    await withBrand(b, (tx) => resolveConflict(tx, b, { keepFactId: keep.id }));
    const after = await by();
    expect(after.facts_conflicts).toBeUndefined();
    expect(after.readiness_gates).toBeUndefined();
  });
});

describe('failures and tenancy', () => {
  it('leaves one failing module out, names it in partial, and still answers the rest', async () => {
    use();
    const { b } = await readyBrand();
    Object.assign(readers, { studio: { ...studio.reads, listDrafts: async () => { throw new Error('studio is down'); } } });
    const h = await home(b);
    expect(h.partial).toEqual(['approve']);
    expect(h.modules.find((m) => m.module === 'approve')!.status).toBeNull();
    expect(h.modules.find((m) => m.module === 'plan')!.status).toMatch(/week/);
    expect(h.items.some((i) => i.kind === 'plan_week_missing')).toBe(true);
    expect(h.costs).not.toBeNull();
  });

  it('reports this month\'s AI cost by run-type prefix', async () => {
    use();
    const b = await t.makeBrand();
    for (const [type, usd, npr] of [['brand_import', '0.5000', '66.00'], ['plan_week', '0.2500', '33.00'], ['plan_brief', '0.1000', '13.20'], ['studio_copy', '1.0000', '132.00'], ['research_watch', '0.0000', '0.00']])
      await t.adminQuery(
        `insert into cost_events (tenant_id, brand_id, run_type, run_id, provider, model, input_tokens, output_tokens, ok, rate_in_usd, rate_out_usd, usd_npr, cost_usd, cost_npr)
         values ($1, $2, $3, $4, 'mock', 'mock', 1, 1, true, '1', '1', '132', $5, $6)`, [t.tenantId, b, type, randomUUID(), usd, npr]);
    const c = (await home(b)).costs!;
    expect(Object.fromEntries(c.byModule.map((m) => [m.module, m.cost.npr]))).toEqual({ brand: '66.00', research: '0.00', plan: '46.20', studio: '132.00' });
    expect(c.total.npr).toBe('244.20');
  });

  it("answers 404 for another brand's Home through the wrong path, and never shows its items", async () => {
    use();
    const [a, other] = [await t.makeBrand(), await t.makeBrand()];
    const d = pub.add(other);
    void d;
    studio.put(other, { day: today() });
    await expect(home(randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(await kinds(a)).toEqual(['setup_import']);
  });
});
