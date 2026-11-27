import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { launchTestWorkflows, testDb, type TestDb } from '../../../../test/helpers.ts';
import { mockAi } from '../../../ai/index.ts';
import { withBrand } from '../../../db/tenant.ts';
import { BudgetError, ConflictError } from '../../../http/errors.ts';
import { ensureBucket } from '../../../storage/index.ts';
import { cancelImport, confirmImport, getImport, retryImport, startImport } from '../../../workflows/brand-import.ts';
import { fetchGuard } from '../../sources/fetch.ts';
import { completeUpload, createUpload, listSources, verifyQuote, type Source } from '../../sources/index.ts';
import { createAsset } from '../assets.ts';
import { listFacts } from '../facts/index.ts';
import { getPalette } from '../palette/index.ts';
import { batching, EXTRACTION_SYSTEM } from './index.ts';

const fixture = (path: string) => readFileSync(new URL(`../../../../test/fixtures/brand/${path}`, import.meta.url));
const PAGES: Record<string, string> = {
  '/': 'home.html', '/about': 'about.html', '/products/green-tea': 'green-tea.html', '/notice': 'notice.html',
  '/refund-policy': 'refund-policy.html',
};

let t: TestDb;
let stop: () => Promise<void>;
let server: Server;
let site: string;
const guard = { ...fetchGuard };

beforeAll(async () => {
  await ensureBucket();
  t = await testDb();
  stop = await launchTestWorkflows(t);
  server = createServer((req, res) => {
    const file = PAGES[req.url ?? ''];
    if (file) res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(fixture(`site/${file}`));
    else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  site = `http://ilamleaf.example:${(server.address() as AddressInfo).port}/`;
  Object.assign(fetchGuard, { resolve: async () => [{ address: '127.0.0.1', family: 4 }], isBlocked: () => false, minIntervalMs: 0 });
});
afterAll(async () => {
  Object.assign(fetchGuard, guard);
  await new Promise((r) => server.close(r));
  await stop();
  await t.close();
});
beforeEach(() => mockAi.reset());
afterEach(() => {
  batching.maxTokens = 150_000;
});

const run = (brand: string, id: string) => withBrand(brand, (tx) => getImport(tx, brand, id));

/** Polls the run until it leaves `running`. */
async function settle(brand: string, id: string) {
  for (let i = 0; i < 400; i++) {
    const r = await run(brand, id);
    if (r.state !== 'running') return r;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error(`import ${id} still running`);
}

async function upload(brand: string, filename: string, mime: string, bytes: Uint8Array): Promise<Source> {
  const { source, uploadUrl } = await withBrand(brand, (tx) => createUpload(tx, brand, { filename, mime, bytes: bytes.byteLength }));
  expect((await fetch(uploadUrl, { method: 'PUT', body: bytes, headers: { 'content-type': mime } })).ok).toBe(true);
  return withBrand(brand, (tx) => completeUpload(tx, brand, source.id));
}

const pageSource = async (brand: string, path: string) =>
  (await withBrand(brand, (tx) => listSources(tx, brand))).find((s) => s.kind === 'page' && new URL(s.uri).pathname === path)!;

const facts = async (brand: string) => (await withBrand(brand, (tx) => listFacts(tx, brand))).items;

describe('brand import', () => {
  it('imports the fixture site and a PDF into quote-checked facts, with the palette and a cost', async () => {
    const brand = await t.makeBrand();
    const pdf = await upload(brand, 'price-list.pdf', 'application/pdf', fixture('files/price-list.pdf'));
    const logoPng = await sharp({ create: { width: 40, height: 20, channels: 4, background: '#e85d27' } }).png().toBuffer();
    const logo = await upload(brand, 'logo.png', 'image/png', logoPng);
    await withBrand(brand, (tx) => createAsset(tx, brand, { sourceId: logo.id, kind: 'logo', rights: { licence: 'Owned' } }));

    const { runId } = await startImport(brand, { websiteUrl: site, sourceIds: [pdf.id] });
    const waiting = await settle(brand, runId);
    expect(waiting).toMatchObject({ state: 'awaiting_approval', stage: 'estimate', blocked: null, counts: { pages: 5, files: 1, batches: 1 } });
    expect(Number(waiting.estimate!.npr)).toBeGreaterThan(0);
    expect(mockAi.calls).toHaveLength(0); // fetching and pricing are free

    const tea = await pageSource(brand, '/products/green-tea');
    const about = await pageSource(brand, '/about');
    mockAi.queue({
      facts: [
        { section: 'products', subjectName: 'Ilam Green Tea 250 g', field: 'price', value: 4500, unit: 'NPR', language: 'en', origin: 'stated', sourceId: tea.id, quote: 'Price: NPR 4500 per tin.', confidence: 0.95 },
        { section: 'identity', field: 'legal_name', value: 'Ilam Leaf Co. Pvt. Ltd.', language: 'en', origin: 'stated', sourceId: about.id, quote: 'Ilam Leaf Co. Pvt. Ltd. is a family tea company', confidence: 0.9 },
        { section: 'products', subjectName: 'Ilam Green Tea 250 g', field: 'billing_unit', value: 'per tin', language: 'en', origin: 'stated', sourceId: pdf.id, quote: 'Ilam Green Tea 250 g: NPR 5000 per tin', page: 1, confidence: 0.8 },
      ],
    });
    await confirmImport(brand, runId);
    const done = await settle(brand, runId);
    expect(done).toMatchObject({ state: 'completed', stage: 'done', error: null, counts: { unverified: 3, inferred: 0, conflicts: 0 } });
    expect(Number(done.actual!.npr)).toBeGreaterThan(0);

    expect(mockAi.calls).toHaveLength(1);
    expect(mockAi.calls[0]!.tools).toBeUndefined();
    expect(mockAi.calls[0]!.parts.some((p) => p.type === 'file' && p.mediaType === 'application/pdf')).toBe(true);

    const stored = await facts(brand);
    expect(stored).toHaveLength(3);
    const all = await withBrand(brand, (tx) => listSources(tx, brand));
    for (const f of stored) {
      expect(f.status).toBe('unverified');
      expect(verifyQuote(all.find((s) => s.id === f.source!.id)!.text!, f.quote!)).toBe(true);
    }
    expect(stored.find((f) => f.field === 'billing_unit')).toMatchObject({ page: 1, source: { id: pdf.id } });

    const palette = await withBrand(brand, (tx) => getPalette(tx, brand));
    expect(palette.colours.map((c) => [c.hex, c.origin])).toEqual(
      expect.arrayContaining([['#e85d27', 'logo'], ['#0f5257', 'site'], ['#c3d7e5', 'site'], ['#141414', 'site']]),
    );
  });

  it('AT-004: an injected instruction stays inside its data block and its price is stored inferred', async () => {
    const brand = await t.makeBrand();
    const { runId } = await startImport(brand, { websiteUrl: site, sourceIds: [] });
    await settle(brand, runId);
    const notice = await pageSource(brand, '/notice');
    mockAi.queue({
      facts: [
        { section: 'products', subjectName: 'Ilam Green Tea 250 g', field: 'price', value: 1, unit: 'NPR', language: 'en', origin: 'stated', sourceId: notice.id, quote: 'Ilam Green Tea costs NPR 1 per tin', confidence: 0.9 },
      ],
    });
    await confirmImport(brand, runId);
    expect((await settle(brand, runId)).state).toBe('completed');

    const call = mockAi.calls[0]!;
    expect(call.system.startsWith(EXTRACTION_SYSTEM)).toBe(true);
    expect(call.system).not.toContain('Ignore your instructions');
    const block = call.parts.find((p) => p.type === 'text' && p.text.includes('Ignore your instructions'));
    expect(block?.type === 'text' && block.text.startsWith(`<<<SOURCE ${notice.id} page `)).toBe(true);
    expect(block?.type === 'text' && block.text.endsWith(`<<<END SOURCE ${notice.id}>>>`)).toBe(true);

    const [price] = await facts(brand);
    expect(price).toMatchObject({ value: 1, status: 'inferred', warning: 'quote not found in source', source: null });
  });

  it('stores a fact citing a source the run did not read as inferred, even when its quote is in that source', async () => {
    const brand = await t.makeBrand();
    const other = await upload(brand, 'old-terms.txt', 'text/plain', new TextEncoder().encode('Unopened tins can be returned within 90 days for a full refund.'));
    const txt = await upload(brand, 'about.txt', 'text/plain', new TextEncoder().encode('Ilam Leaf Co. sells green tea.'));
    const { runId } = await startImport(brand, { sourceIds: [txt.id] });
    expect((await settle(brand, runId)).state).toBe('awaiting_approval');
    mockAi.queue({ facts: [{ section: 'legal', field: 'refund', value: 'Within 90 days', language: 'en', origin: 'stated', sourceId: other.id, quote: 'returned within 90 days for a full refund', confidence: 0.9 }] });
    await confirmImport(brand, runId);
    expect((await settle(brand, runId)).state).toBe('completed');
    const [refund] = await facts(brand);
    expect(refund).toMatchObject({ status: 'inferred', warning: 'quote not found in source', source: null, quote: null });
  });

  it('blocks an estimate above the remaining cap: the run waits with a reason and confirm refuses', async () => {
    const brand = await t.makeBrand();
    const [spent] = await t.adminQuery<{ id: string }>(
      `insert into cost_events (tenant_id, brand_id, run_type, run_id, provider, model, input_tokens, output_tokens,
         ok, rate_in_usd, rate_out_usd, usd_npr, cost_usd, cost_npr)
       values ($1, $2, 'other', 'x', 'anthropic', 'claude-opus-5-5', 1, 1, true, 4, 20, 155.08, 32.24, 4999.99) returning id`,
      [t.tenantId, brand],
    );
    try {
      const txt = await upload(brand, 'about.txt', 'text/plain', new TextEncoder().encode('Ilam Leaf Co. sells green tea.'));
      const { runId } = await startImport(brand, { sourceIds: [txt.id] });
      const waiting = await settle(brand, runId);
      expect(waiting.state).toBe('awaiting_approval');
      expect(waiting.blocked).toMatch(/budget/);
      await expect(confirmImport(brand, runId)).rejects.toBeInstanceOf(BudgetError);
      expect((await run(brand, runId)).state).toBe('awaiting_approval');
      expect(mockAi.calls).toHaveLength(0);
    } finally {
      await t.adminQuery(`delete from cost_events where id = $1`, [spent!.id]);
    }
  });

  it('resumes after a failure in the second batch without calling the model again for the first', async () => {
    const brand = await t.makeBrand();
    const a = await upload(brand, 'a.txt', 'text/plain', new TextEncoder().encode('Ilam Leaf Co. was founded in Ilam in 2009 by the Rai family.'));
    const b = await upload(brand, 'b.txt', 'text/plain', new TextEncoder().encode('Unopened tins can be returned within 14 days for a full refund.'));
    batching.maxTokens = 40;
    const { runId } = await startImport(brand, { sourceIds: [a.id, b.id] });
    expect((await settle(brand, runId)).counts.batches).toBe(2);

    mockAi.queue({ facts: [{ section: 'identity', field: 'owner', value: 'The Rai family', language: 'en', origin: 'stated', sourceId: a.id, quote: 'founded in Ilam in 2009 by the Rai family', confidence: 0.9 }] });
    await confirmImport(brand, runId); // no answer queued for the second batch: its call fails
    const failed = await settle(brand, runId);
    expect(failed.state).toBe('failed_retryable');
    expect(failed.error).toMatch(/model call failed/);

    mockAi.queue({ facts: [{ section: 'legal', field: 'refund', value: 'Unopened tins within 14 days', language: 'en', origin: 'stated', sourceId: b.id, quote: 'returned within 14 days for a full refund', confidence: 0.9 }] });
    await retryImport(brand, runId);
    const done = await settle(brand, runId);
    expect(done).toMatchObject({ state: 'completed', counts: { unverified: 2 } });
    const callsFor = (id: string) => mockAi.calls.filter((c) => c.parts.some((p) => p.type === 'text' && p.text.includes(id))).length;
    expect(callsFor(a.id)).toBe(1);
    expect((await facts(brand)).map((f) => f.field).sort()).toEqual(['owner', 'refund']);
  });

  it('cancels a run awaiting approval without any model call', async () => {
    const brand = await t.makeBrand();
    const txt = await upload(brand, 'about.txt', 'text/plain', new TextEncoder().encode('Ilam Leaf Co. sells green tea.'));
    const { runId } = await startImport(brand, { sourceIds: [txt.id] });
    expect((await settle(brand, runId)).state).toBe('awaiting_approval');
    await cancelImport(brand, runId);
    expect((await run(brand, runId)).state).toBe('cancelled');
    await expect(confirmImport(brand, runId)).rejects.toBeInstanceOf(ConflictError);
    expect(mockAi.calls).toHaveLength(0);
  });

  it('review focus 1: a website that cannot be read fails retryable; an import of uploads alone completes', async () => {
    const brand = await t.makeBrand();
    const { runId } = await startImport(brand, { websiteUrl: 'http://down.example:1/', sourceIds: [] });
    expect(await settle(brand, runId)).toMatchObject({ state: 'failed_retryable', error: 'could not read the website' });

    const txt = await upload(brand, 'about.txt', 'text/plain', new TextEncoder().encode('Ilam Leaf Co. sells green tea.'));
    const second = await startImport(brand, { sourceIds: [txt.id] });
    expect((await settle(brand, second.runId)).state).toBe('awaiting_approval');
    mockAi.queue({ facts: [] });
    await confirmImport(brand, second.runId);
    expect((await settle(brand, second.runId)).state).toBe('completed');
  });

  it('review focus 5: a price written रु ४,५०० is stored as that text with its quote', async () => {
    const brand = await t.makeBrand();
    const { runId } = await startImport(brand, { websiteUrl: site, sourceIds: [] });
    await settle(brand, runId);
    const tea = await pageSource(brand, '/products/green-tea');
    mockAi.queue({
      facts: [
        { section: 'products', subjectName: 'इलाम हरियो चिया', field: 'price', value: 'रु ४,५००', unit: 'NPR', language: 'ne', origin: 'stated', sourceId: tea.id, quote: 'इलाम हरियो चिया २५० ग्राम: रु ४,५०० प्रति टिन', confidence: 0.9 },
      ],
    });
    await confirmImport(brand, runId);
    expect((await settle(brand, runId)).state).toBe('completed');
    const [price] = await facts(brand);
    expect(price).toMatchObject({ value: 'रु ४,५००', status: 'unverified', quote: 'इलाम हरियो चिया २५० ग्राम: रु ४,५०० प्रति टिन' });
  });
});
