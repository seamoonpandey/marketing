// Brand isolation across the whole API (AT-001), walked route by route rather than sampled. Every route the app
// registers is called with another tenant's brand, with brand B's IDs on brand A's path and in A's bodies, and with
// IDs that are not IDs. A route added later needs an entry in BODY (and QUERY for an ID query parameter) or this
// suite fails, so a route that skips withBrand, or loads an ID outside the brand's scope, cannot slip in unwalked.
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../test/helpers.ts';
import { createApp, OPENAPI_INFO } from './app.ts';

let t: TestDb;
const app = createApp();
const doc = app.getOpenAPI31Document(OPENAPI_INFO) as { paths: Record<string, Record<string, any>> };

const SUN = '2026-11-29'; // a Sunday: the plan settings below start weeks on Sunday
const AT = `${new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)}T10:00:00+05:45`;
const HASH = '0'.repeat(64);
const NOT_ID = 'not-an-id';
const CONTENT = {
  copies: [{ language: 'en', sentences: [{ text: 'Hello', claim: false, factIds: [] }], hashtags: [], cta: 'Visit us' }],
  slides: [{ headline: 'Hello' }], scenes: [], template: 'headline', ratios: ['1:1'], channel: 'instagram',
};
const EMPTY_BRIEF = Object.fromEntries(['goal_kpi', 'audience', 'offer_message', 'channel_mix', 'creative', 'conversion', 'budget', 'measurement', 'risk'].map((s) => [s, []]));

/** Routes outside /brands/{brandId}: each was reviewed by hand. */
const UNSCOPED = ['GET /api/health', 'GET /api/brands', 'POST /api/brands'];

// "$kind" is the path brand's object of that kind (swapped for brand B's one at a time below). "cite:kind" is a citation:
// a fact id the module checks against today's approved facts when it uses it (plan balance `unknown_fact` blocks the
// week, Studio and the brief strip it), so it is never swapped.
const BODY: Record<string, unknown> = {
  'PATCH /api/brands/:brandId': { name: 'Renamed' },
  'POST /api/brands/:brandId/competitors': { name: 'Rival two' },
  'PATCH /api/brands/:brandId/competitors/:id': { priority: 1 },
  'POST /api/brands/:brandId/sources/uploads': { filename: 'a.pdf', mime: 'application/pdf', bytes: 10 },
  'POST /api/brands/:brandId/knowledge/imports': { sourceIds: ['$source'] },
  'POST /api/brands/:brandId/knowledge/facts': { section: 'products', subjectId: '$product', field: 'price', value: 4000, unit: 'NPR', language: 'en' },
  'POST /api/brands/:brandId/knowledge/facts/approve-batch': { ids: ['$fact'] },
  'PATCH /api/brands/:brandId/knowledge/facts/:id': { value: 'Hand-woven since 1990' },
  'POST /api/brands/:brandId/knowledge/facts/:id/reject': { reason: 'Wrong' },
  'POST /api/brands/:brandId/knowledge/conflicts/resolve': { keepFactId: '$fact' },
  'POST /api/brands/:brandId/knowledge/subjects': { type: 'product', name: 'Scarf' },
  'POST /api/brands/:brandId/knowledge/assets': { sourceId: '$source', kind: 'photo', rights: { licence: 'Own work' } },
  'PATCH /api/brands/:brandId/knowledge/assets/:id': { variant: 'square' },
  'PUT /api/brands/:brandId/knowledge/palette': { colours: [{ hex: '#0f5257', role: 'primary' }] },
  'POST /api/brands/:brandId/research/targets': { competitorId: '$competitor', url: 'https://rival.example/offers' },
  'POST /api/brands/:brandId/research/targets/suggest': { competitorId: '$competitor' },
  'PATCH /api/brands/:brandId/research/targets/:id': { status: 'paused' },
  'POST /api/brands/:brandId/research/runs': { trigger: 'manual' },
  'PUT /api/brands/:brandId/research/schedule': { enabled: false, weekday: 1, hour: 9 },
  'POST /api/brands/:brandId/research/discoveries': { keywords: ['momo kathmandu'] },
  'POST /api/brands/:brandId/research/candidates/watch': { ids: ['$candidate'] },
  'PUT /api/brands/:brandId/plan/settings': { channels: [{ channel: 'instagram', postsPerWeek: 3 }], pillars: [], weekStarts: 0 },
  'POST /api/brands/:brandId/plan/campaigns': { name: 'Tihar', objective: 'awareness', segmentId: '$segment', opportunityId: '$opportunity' },
  'PATCH /api/brands/:brandId/plan/campaigns/:id': { segmentId: '$segment' },
  'PATCH /api/brands/:brandId/plan/campaigns/:id/brief': { body: { ...EMPTY_BRIEF, goal_kpi: [{ text: 'Grow', factIds: ['cite:fact'] }] } },
  'POST /api/brands/:brandId/plan/campaigns/:id/brief/approve': { version: 1 },
  'POST /api/brands/:brandId/plan/weeks/:weekStart/approve': { version: 1 },
  'POST /api/brands/:brandId/plan/weeks/:weekStart/items': { day: SUN, channel: 'instagram', segmentId: '$segment', campaignId: '$campaign', factIds: ['cite:fact'] },
  'PATCH /api/brands/:brandId/plan/items/:id': { segmentId: '$segment', campaignId: '$campaign', factIds: ['cite:fact'] },
  'POST /api/brands/:brandId/studio/drafts/estimate': { planItemIds: ['$item'] },
  'POST /api/brands/:brandId/studio/drafts': { planItemIds: ['$item'] },
  'PATCH /api/brands/:brandId/studio/drafts/:id': { slides: [{ headline: 'New', photoAssetId: '$asset' }] },
  'POST /api/brands/:brandId/approve/queue/:draftId/approve': { payloadHash: HASH },
  'POST /api/brands/:brandId/approve/queue/:draftId/reject': { payloadHash: HASH, reason: 'No' },
  'POST /api/brands/:brandId/approve/bulk-approve': { items: [{ draftId: '$draft', payloadHash: HASH }] },
  'PUT /api/brands/:brandId/approve/settings': { maxAgeDays: 14, approvers: [] },
  'POST /api/brands/:brandId/approve/pause': { reason: 'Holiday' },
  'POST /api/brands/:brandId/approve/resume': { reason: 'Back' },
  'POST /api/brands/:brandId/publish/channels': { platform: 'facebook', accountName: '@page' },
  'PATCH /api/brands/:brandId/publish/channels/:id': { status: 'connected' },
  'POST /api/brands/:brandId/publish/jobs': { draftId: '$draft', channelId: '$channel', scheduledAt: AT },
  'POST /api/brands/:brandId/publish/jobs/:id/reschedule': { scheduledAt: AT },
  'POST /api/brands/:brandId/publish/jobs/:id/confirm-manual': { url: 'https://x.com/1' },
  'POST /api/brands/:brandId/publish/jobs/:id/resolve-unknown': { posted: false },
  'PUT /api/brands/:brandId/publish/settings': { windowStart: 7, windowEnd: 21, maxAttempts: 3 },
};

/** Query parameters that carry an ID. Another brand's ID must find nothing, not a 404: it is a filter. */
const QUERY: Record<string, Record<string, string>> = {
  'GET /api/brands/:brandId/knowledge/facts': { subjectId: '$product' },
  'GET /api/brands/:brandId/research/targets': { competitorId: '$competitor' },
  'GET /api/brands/:brandId/research/observations': { competitorId: '$competitor', runId: '$watchRun' },
};

/** The table a path parameter names, by the segment before it (and the module, for runs). */
const KIND: Record<string, string> = {
  competitors: 'competitor', sources: 'source', facts: 'fact', assets: 'asset', imports: 'importRun', campaigns: 'campaign',
  items: 'item', targets: 'target', opportunities: 'opportunity', drafts: 'draft', queue: 'draft', channels: 'channel', jobs: 'job',
  'plan/runs': 'planRun', 'research/runs': 'watchRun', 'studio/runs': 'studioRun', discoveries: 'discoveryRun', candidates: 'candidate',
};

type Ids = Record<string, string>;
type Route = { method: string; path: string; key: string; params: string[]; body?: unknown; query?: Record<string, string> };

const routes: Route[] = [...new Set(app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`))].map((key) => {
  const [method, path] = key.split(' ') as [string, string];
  return { method, path, key, params: [...path.matchAll(/:(\w+)/g)].map((m) => m[1]!), body: BODY[key], query: QUERY[key] };
});
const scoped = routes.filter((r) => r.params.includes('brandId'));
const idParams = (r: Route) => r.params.filter((p) => p !== 'brandId' && p !== 'weekStart');

function kindOf(path: string, param: string): string {
  const seg = path.split('/');
  const before = seg[seg.indexOf(`:${param}`) - 1]!;
  const kind = KIND[`${seg[4]}/${before}`] ?? KIND[before];
  if (!kind) throw new Error(`${path}: add the table :${param} names to KIND`);
  return kind;
}

const fill = (path: string, brand: string, ids: (param: string) => string) =>
  path.replace(/:(\w+)/g, (_, p: string) => (p === 'brandId' ? brand : p === 'weekStart' ? SUN : ids(p)));

/** The body with "$kind" from `own`, except `swap`, which comes from `foreign`; "cite:kind" always from `own`. */
function resolve(v: unknown, own: Ids, swap?: string, foreign?: Ids | string): unknown {
  if (typeof v === 'string' && /^(\$|cite:)\w+$/.test(v)) {
    const kind = v.replace(/^(\$|cite:)/, '');
    if (v[0] === '$' && kind === swap) return typeof foreign === 'string' ? foreign : foreign![kind];
    return own[kind] ?? (() => { throw new Error(`no ${kind} in the fixture`); })();
  }
  if (Array.isArray(v)) return v.map((x) => resolve(x, own, swap, foreign));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, own, swap, foreign)]));
  return v;
}
const swappable = (v: unknown) => [...new Set([...JSON.stringify(v ?? null).matchAll(/"\$(\w+)"/g)].map((m) => m[1]!))];

async function call(method: string, url: string, body?: unknown) {
  const res = await app.request(url, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}
const withQuery = (url: string, q?: Record<string, unknown>) => (q ? `${url}?${new URLSearchParams(q as Record<string, string>)}` : url);

/** One of each object the routes name, made the way the app makes them where it can. */
async function seed(brand: string): Promise<Ids> {
  const p = `/api/brands/${brand}`;
  const send = async (method: string, path: string, body: unknown) => {
    const r = await call(method, `${p}${path}`, body);
    expect(r.status, `${path}: ${r.text}`).toBeLessThan(300);
    return JSON.parse(r.text);
  };
  const one = async (sql: string, params: unknown[] = []) => (await t.adminQuery(sql, [t.tenantId, brand, ...params]))[0].id as string;
  const ids: Ids = {};
  ids.competitor = (await send('POST', '/competitors', { name: 'Rival' })).id;
  ids.product = (await send('POST', '/knowledge/subjects', { type: 'product', name: 'Shawl' })).id;
  ids.segment = (await send('POST', '/knowledge/subjects', { type: 'segment', name: 'Gift buyers' })).id;
  ids.fact = (await send('POST', '/knowledge/facts', { section: 'positioning', field: 'proof', value: 'Hand-woven', language: 'en' })).id;
  ids.source = await one(
    `insert into sources (tenant_id, brand_id, kind, uri, mime, checksum, object_key, trust, meta)
     values ($1, $2, 'upload', 'upload:x', 'image/png', 'c', $3, 'owner', '{"status":"ready","filename":"a.png"}') returning id`,
    [`tenant/${t.tenantId}/brand/${brand}/upload/${randomUUID()}.png`],
  );
  ids.asset = (await send('POST', '/knowledge/assets', { sourceId: ids.source, kind: 'photo', rights: { licence: 'Own work' } })).id;
  await send('PUT', '/plan/settings', BODY['PUT /api/brands/:brandId/plan/settings']);
  ids.campaign = (await send('POST', '/plan/campaigns', { name: 'Dashain', objective: 'awareness' })).id;
  ids.item = (await send('POST', `/plan/weeks/${SUN}/items`, { day: SUN, channel: 'instagram', idea: 'Idea', cta: 'Visit' })).item.id;
  ids.target = (await send('POST', '/research/targets', { competitorId: ids.competitor, url: 'https://rival.example/' })).id;
  ids.channel = (await send('POST', '/publish/channels', { platform: 'instagram', accountName: '@shop' })).id;
  ids.importRun = await one(`insert into import_runs (tenant_id, brand_id, state, stage) values ($1, $2, 'completed', 'done') returning id`);
  ids.planRun = await one(`insert into plan_runs (tenant_id, brand_id, kind, target_id, state) values ($1, $2, 'week', $3, 'completed') returning id`, [SUN]);
  ids.watchRun = await one(`insert into watch_runs (tenant_id, brand_id, trigger, state) values ($1, $2, 'manual', 'completed') returning id`);
  ids.discoveryRun = await one(`insert into discovery_runs (tenant_id, brand_id, keywords, state) values ($1, $2, '{momo}', 'completed') returning id`);
  ids.candidate = await one(
    `insert into discovery_candidates (tenant_id, brand_id, match_key, name, rank, first_run_id, last_run_id) values ($1, $2, 'name:rival', 'Rival', 1, $3, $3) returning id`,
    [ids.discoveryRun],
  );
  ids.profile = await one(
    `insert into competitor_profiles (tenant_id, brand_id, competitor_id, profile, run_id) values ($1, $2, $3, '{"entries":[]}', $4) returning id`,
    [ids.competitor, ids.watchRun],
  );
  ids.opportunity = await one(
    `insert into opportunities (tenant_id, brand_id, title, hypothesis, suggested_action, why_it_matters, observation_ids, confidence, status)
     values ($1, $2, 'T', 'H', 'A', 'W', '{}', 'high', 'accepted') returning id`,
  );
  ids.draft = await one(`insert into studio_drafts (tenant_id, brand_id, plan_item_id, kind) values ($1, $2, $3, 'static') returning id`, [ids.item]);
  await t.adminQuery(
    `insert into studio_versions (tenant_id, brand_id, draft_id, version, origin, content) values ($1, $2, $3, 1, 'owner', $4)`,
    [t.tenantId, brand, ids.draft, JSON.stringify(CONTENT)],
  );
  ids.studioRun = await one(`insert into studio_runs (tenant_id, brand_id, kind, targets, state) values ($1, $2, 'render', $3, 'completed') returning id`, [JSON.stringify([ids.draft])]);
  ids.job = await one(
    `insert into publish_jobs (tenant_id, brand_id, draft_id, draft_version, payload_hash, channel_id, scheduled_at, idempotency_key)
     values ($1, $2, $3, 1, $4, $5, now() + interval '2 days', $6) returning id`,
    [ids.draft, HASH, ids.channel, randomUUID()],
  );
  return ids;
}

/** Every table with a brand_id and an id. */
const brandTables = async () =>
  (await t.adminQuery<{ table_name: string }>(
    `select table_name from information_schema.columns where table_schema = 'public' and column_name = 'brand_id'
     intersect select table_name from information_schema.columns where table_schema = 'public' and column_name = 'id'`,
  )).map((r) => r.table_name);

/** Every id in any row of the brand. */
async function rowIds(brand: string): Promise<string[]> {
  const out: string[] = [];
  for (const table of await brandTables()) out.push(...(await t.adminQuery(`select id::text from ${table} where brand_id = $1`, [brand])).map((r) => r.id));
  return out;
}

let A: Ids;
let B: Ids;
let brandA: string;
let brandB: string;
let otherTenantBrand: string;
let foreignIds: string[]; // brand B's and the other tenant's
const problems: string[] = [];

/** Notes any foreign id in a response that the request did not carry itself. */
function leaks(where: string, text: string, sent: string) {
  for (const id of foreignIds) if (text.includes(id) && !sent.includes(id)) problems.push(`${where}: answer names ${id}`);
}

beforeAll(async () => {
  t = await testDb();
  brandA = await t.makeBrand('A');
  brandB = await t.makeBrand('B');
  A = await seed(brandA);
  B = await seed(brandB);
  const [tenant] = await t.adminQuery(`insert into tenants (name, slug) values ('Other', $1) returning id`, [`other-${randomUUID()}`]);
  [{ id: otherTenantBrand }] = await t.adminQuery(`insert into brands (tenant_id, name, slug) values ($1, 'Theirs', 'theirs') returning id`, [tenant.id]);
  foreignIds = [...(await rowIds(brandB)), brandB, otherTenantBrand, tenant.id];
}, 60_000);
afterAll(() => t.close());
beforeEach(() => {
  problems.length = 0;
});

describe('brand isolation, route by route', () => {
  it('knows every route: an example body for each JSON body, the table of each path ID, an example for each ID query', () => {
    const missing: string[] = [];
    for (const r of routes) {
      if (!r.params.includes('brandId')) {
        if (!UNSCOPED.includes(r.key)) missing.push(`${r.key}: outside /brands/{brandId}; review it and add it to UNSCOPED`);
        continue;
      }
      const op = doc.paths[r.path.replace(/:(\w+)/g, '{$1}')]?.[r.method.toLowerCase()];
      if (!op) missing.push(`${r.key}: not in the OpenAPI document`);
      if (op?.requestBody && r.body === undefined) missing.push(`${r.key}: add an example body to BODY`);
      for (const q of op?.parameters ?? []) if (q.in === 'query' && /id$/i.test(q.name) && !r.query?.[q.name]) missing.push(`${r.key}: add ?${q.name} to QUERY`);
      for (const p of idParams(r)) {
        try {
          kindOf(r.path, p);
        } catch (e) {
          missing.push((e as Error).message);
        }
      }
    }
    expect(missing).toEqual([]);
    expect(scoped.length).toBeGreaterThan(100);
  });

  it('answers 404 for a brand of another tenant and for a brand that is not an id, on every route', async () => {
    for (const brand of [otherTenantBrand, NOT_ID, randomUUID()]) {
      for (const r of scoped) {
        const url = withQuery(fill(r.path, brand, (p) => A[kindOf(r.path, p)]!), resolve(r.query, A) as Record<string, string>);
        const body = resolve(r.body, A);
        const res = await call(r.method, url, body);
        if (res.status !== 404) problems.push(`${r.key} as brand ${brand}: ${res.status} ${res.text.slice(0, 200)}`);
        leaks(r.key, res.text, url + JSON.stringify(body ?? null));
      }
    }
    expect(problems).toEqual([]);
  });

  it("answers 404 for brand B's object in brand A's path", async () => {
    for (const r of scoped)
      for (const swap of idParams(r)) {
        const url = withQuery(fill(r.path, brandA, (p) => (p === swap ? B : A)[kindOf(r.path, p)]!), resolve(r.query, A) as Record<string, string>);
        const body = resolve(r.body, A);
        const res = await call(r.method, url, body);
        if (res.status !== 404) problems.push(`${r.key} with B's :${swap}: ${res.status} ${res.text.slice(0, 200)}`);
        leaks(r.key, res.text, url + JSON.stringify(body ?? null));
      }
    expect(problems).toEqual([]);
  });

  it("refuses brand B's ids in brand A's bodies with 404, and finds nothing for them in A's filters", async () => {
    for (const r of scoped) {
      const own = fill(r.path, brandA, (p) => A[kindOf(r.path, p)]!);
      for (const kind of swappable(r.body)) {
        const body = resolve(r.body, A, kind, B);
        const res = await call(r.method, withQuery(own, resolve(r.query, A) as Record<string, string>), body);
        if (res.status !== 404) problems.push(`${r.key} with B's ${kind} in the body: ${res.status} ${res.text.slice(0, 200)}`);
        leaks(r.key, res.text, JSON.stringify(body));
      }
      for (const kind of swappable(r.query)) {
        const url = withQuery(own, resolve(r.query, A, kind, B) as Record<string, string>);
        const res = await call(r.method, url);
        if (res.status >= 500) problems.push(`${r.key} with B's ${kind} in the query: ${res.status}`);
        leaks(r.key, res.text, url);
      }
    }
    expect(problems).toEqual([]);
  });

  it('answers 400 or 404, never 5xx, to an id that is not an id, in the path, the body or the query', async () => {
    for (const r of scoped) {
      const own = (q?: unknown) => withQuery(fill(r.path, brandA, (p) => A[kindOf(r.path, p)]!), q as Record<string, string>);
      for (const swap of idParams(r)) {
        const res = await call(r.method, withQuery(fill(r.path, brandA, (p) => (p === swap ? NOT_ID : A[kindOf(r.path, p)]!)), resolve(r.query, A) as Record<string, string>), resolve(r.body, A));
        if (res.status !== 400 && res.status !== 404) problems.push(`${r.key} with :${swap}=${NOT_ID}: ${res.status} ${res.text.slice(0, 200)}`);
      }
      for (const kind of swappable(r.body)) {
        const res = await call(r.method, own(resolve(r.query, A)), resolve(r.body, A, kind, NOT_ID));
        if (res.status !== 400 && res.status !== 404) problems.push(`${r.key} with ${kind}=${NOT_ID} in the body: ${res.status} ${res.text.slice(0, 200)}`);
      }
      for (const kind of swappable(r.query)) {
        const res = await call(r.method, own(resolve(r.query, A, kind, NOT_ID)));
        if (res.status >= 500) problems.push(`${r.key} with ${kind}=${NOT_ID} in the query: ${res.status} ${res.text.slice(0, 200)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("leaves no row of brand A pointing at brand B's rows", async () => {
    const ids = foreignIds;
    const found: string[] = [];
    for (const table of await brandTables()) {
      const denied = table === 'audit_events' ? `and result <> 'denied'` : ''; // a denied event names the id that was tried
      const rows = await t.adminQuery(
        `select id::text from ${table} t where brand_id = $1 ${denied} and exists (select 1 from unnest($2::text[]) x where strpos(t::text, x) > 0)`,
        [brandA, ids],
      );
      found.push(...rows.map((r) => `${table} ${r.id}`));
    }
    expect(found).toEqual([]);
  });

  it("reaches brand A's own objects on every route (so the 404s above are the scope, not a wrong id)", async () => {
    // Last, and deletes and the archive last of all: these change brand A.
    const order = (r: Route) => (r.method === 'DELETE' ? 1 : 0) + (r.path.endsWith('/archive') ? 2 : 0);
    for (const r of [...scoped].sort((a, b) => order(a) - order(b))) {
      const res = await call(r.method, withQuery(fill(r.path, brandA, (p) => A[kindOf(r.path, p)]!), resolve(r.query, A) as Record<string, string>), resolve(r.body, A));
      if (res.status === 404) problems.push(`${r.key}: 404 for brand A's own object: ${res.text.slice(0, 200)}`);
    }
    expect(problems).toEqual([]);
  });
});

describe('row-level security, table by table', () => {
  const migrations = new URL('./db/migrations/', import.meta.url);
  const migrationSql = () => readdirSync(migrations).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(new URL(f, migrations), 'utf8')).join('\n');

  it('enables RLS with policies on the tenant and the brand on every table but tenants, in the schema and in the migrations', async () => {
    const tables = await t.adminQuery<{ name: string; rls: boolean; branded: boolean }>(
      `select c.relname as name, c.relrowsecurity as rls,
         exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'brand_id') as branded
       from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const policies = await t.adminQuery<{ table: string; roles: string[]; cmd: string; qual: string; check: string }>(
      `select tablename as table, roles::text[] as roles, cmd, qual, with_check as check from pg_policies where schemaname = 'public'`,
    );
    const sql = migrationSql();
    const wrong: string[] = [];
    for (const { name, rls, branded } of tables) {
      if (!sql.includes(`CREATE TABLE "${name}"`)) wrong.push(`${name}: not in the migrations`);
      if (name === 'tenants') {
        if (rls) wrong.push('tenants: RLS changed; review the grants test');
        continue;
      }
      if (!rls) wrong.push(`${name}: RLS is off`);
      if (!sql.includes(`ALTER TABLE "${name}" ENABLE ROW LEVEL SECURITY`)) wrong.push(`${name}: the migrations do not enable RLS`);
      const mine = policies.filter((p) => p.table === name);
      if (!mine.length) wrong.push(`${name}: no policy`);
      for (const p of mine) {
        if (p.roles.join() !== 'marketing_app' || p.cmd !== 'ALL') wrong.push(`${name}: a policy for ${p.roles} ${p.cmd}`);
        for (const clause of [p.qual, p.check]) {
          if (!clause?.includes('app.tenant_id')) wrong.push(`${name}: a policy clause without the tenant`);
          if (branded && !clause?.includes('app.brand_ids')) wrong.push(`${name}: a policy clause without the brand`);
        }
      }
      const inMigrations = [...sql.matchAll(new RegExp(`CREATE POLICY "[^"]+" ON "${name}"[^\\n]*`, 'g'))].map((m) => m[0]);
      if (!inMigrations.length) wrong.push(`${name}: no policy in the migrations`);
      if (branded && inMigrations.some((m) => !m.includes("app.brand_ids"))) wrong.push(`${name}: a migration policy without the brand`);
    }
    expect(wrong).toEqual([]);
    expect(tables.length).toBeGreaterThan(30);
  });

  it('gives the app role no BYPASSRLS, read-only tenants and append-only audit events and approvals', async () => {
    const [role] = await t.adminQuery(`select rolsuper, rolbypassrls from pg_roles where rolname = 'marketing_app'`);
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    const grants = await t.adminQuery<{ table: string; privs: string[] }>(
      `select table_name as table, array_agg(privilege_type::text order by privilege_type) as privs
       from information_schema.role_table_grants where grantee = 'marketing_app' and table_schema = 'public' group by table_name`,
    );
    const of = (name: string) => grants.find((g) => g.table === name)?.privs;
    expect(of('tenants')).toEqual(['SELECT']);
    expect(of('audit_events')).toEqual(['INSERT', 'SELECT']);
    expect(of('approvals')).toEqual(['INSERT', 'SELECT']);
    for (const g of grants) expect(g.privs, g.table).not.toContain('TRUNCATE');
  });
});
