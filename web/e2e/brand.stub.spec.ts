import { expect, test, type Page, type Route } from '@playwright/test';

// The brand screens against a stubbed API. Bodies follow server/openapi.json; the stub keeps its own state so
// approve, edit, reject, resolve and the import run behave as the server will.

const B = '11111111-1111-4111-8111-111111111111';
const API = `/api/brands/${B}`;
const NEPALI = 'हिमालयको चिसोमा न्यानो पश्मिना, हातले बुनेको र नेपालमै बनाइएको, पुस्तौँदेखि चलिआएको कला';

type J = Record<string, unknown>;
const money = (usd: string, npr: string) => ({ usd, npr });
const page1 = { id: 's-page', kind: 'page', uri: 'https://himalpashmina.example/shop', meta: { title: 'Shop | Himal Pashmina' }, downloadUrl: 'https://himalpashmina.example/shop' };
const file1 = { id: 's-file', kind: 'upload', uri: 'price-list.pdf', meta: { filename: 'price-list.pdf', pages: 2 }, downloadUrl: '/stub-storage/price-list.pdf' };

function fact(p: J): J {
  return {
    id: 'x', section: 'products', subjectType: 'product', subjectId: 'sub-1', subjectName: 'Pashmina Shawl', field: 'name', fieldLabel: 'Name',
    value: 'x', unit: null, language: 'en', status: 'unverified', origin: 'stated', confidence: 0.9, source: page1,
    quote: 'q', page: null, warning: null, version: 1, supersedesId: null, isCurrent: true, verifiedBy: null, verifiedAt: null,
    expiresAt: null, importRunId: 'run-0', createdAt: '2026-11-20T10:00:00Z', ...p,
  };
}

const catalogue = [
  { key: 'identity', label: 'Identity', subject: 'brand', fields: [{ key: 'tagline', label: 'Tagline', type: 'text', multi: false }] },
  {
    key: 'products', label: 'Products and services', subject: 'product',
    fields: [
      { key: 'name', label: 'Name', type: 'text', multi: false },
      { key: 'description', label: 'Description', type: 'longtext', multi: false },
      { key: 'price', label: 'Price', type: 'money', multi: false, asksExpiry: true },
      { key: 'features', label: 'Features', type: 'list', multi: true },
    ],
  },
  { key: 'positioning', label: 'Positioning', subject: 'brand', fields: [{ key: 'value_proposition', label: 'Value proposition', type: 'longtext', multi: false }] },
  {
    key: 'goals', label: 'Goals and economics', subject: 'brand',
    fields: [
      { key: 'primary_objective', label: 'Primary objective', type: 'enum', multi: false, options: ['sales', 'leads', 'awareness'] },
      { key: 'max_ai_spend', label: 'Maximum AI spend', type: 'money', multi: false },
    ],
  },
];

function seed() {
  return {
    facts: [
      fact({ id: 'f-name', field: 'name', fieldLabel: 'Name', value: 'Himalayan Pashmina Shawl', quote: 'Himalayan Pashmina Shawl, hand-woven' }),
      fact({ id: 'f-desc', field: 'description', fieldLabel: 'Description', value: 'A warm everyday shawl for the Kathmandu winter.', status: 'inferred', origin: 'inferred', confidence: 0.55, source: null, quote: null, warning: 'quote not found in source' }),
      fact({ id: 'f-feat', field: 'features', fieldLabel: 'Features', value: ['100% cashmere', 'Hand-woven'], quote: '100% cashmere' }),
      fact({ id: 'f-pa', field: 'price', fieldLabel: 'Price', value: 4500, unit: 'NPR', status: 'conflicting', quote: 'Price: NPR 4,500' }),
      fact({ id: 'f-pb', field: 'price', fieldLabel: 'Price', value: 'रु ५,०००', language: 'ne', status: 'conflicting', source: file1, quote: 'मूल्य रु ५,०००', page: 1 }),
      fact({ id: 'f-tag', section: 'identity', subjectType: 'brand', subjectId: null, subjectName: null, field: 'tagline', fieldLabel: 'Tagline', value: 'Warmth from the Himalaya', quote: 'Warmth from the Himalaya' }),
      fact({ id: 'f-vp', section: 'positioning', subjectType: 'brand', subjectId: null, subjectName: null, field: 'value_proposition', fieldLabel: 'Value proposition', value: NEPALI, language: 'ne', quote: NEPALI }),
    ] as J[],
    competitors: [] as J[],
    sources: [] as J[],
    assets: [] as J[],
    palette: [
      { id: 'c1', hex: '#0f5257', role: null, origin: 'logo', share: 0.42, rgb: { r: 15, g: 82, b: 87 }, cmyk: { c: 83, m: 6, y: 0, k: 66 } },
      { id: 'c2', hex: '#f5efe5', role: null, origin: 'site', share: null, rgb: { r: 245, g: 239, b: 229 }, cmyk: { c: 0, m: 2, y: 7, k: 4 } },
      { id: 'c3', hex: '#24201d', role: null, origin: 'logo', share: 0.3, rgb: { r: 36, g: 32, b: 29 }, cmyk: { c: 0, m: 11, y: 19, k: 86 } },
    ] as J[],
    run: null as J | null,
    phase: 'fetching',
    n: 0,
    calls: [] as { method: string; path: string; body: unknown }[],
    failApi: false,
  };
}
type State = ReturnType<typeof seed>;

const brand = { id: B, name: 'Himal Pashmina', slug: 'himal-pashmina', website: 'https://himalpashmina.example', country: 'NP', timezone: 'Asia/Kathmandu', currency: 'NPR', defaultLanguage: 'en', languages: ['en', 'ne'], status: 'active', createdAt: '2026-11-01T00:00:00Z' };

const counts = { pages: 6, pagesFailed: 0, files: 1, batches: 1, unverified: 5, inferred: 1, conflicts: 1, unchanged: 0, dropped: 0, colours: 3 };

function readiness() {
  const c = (label: string, pass: boolean) => ({ label, pass, fixPath: `/app/b/${B}/brand/review?section=products` });
  const later = (key: string, label: string, note: string) => ({ key, label, weight: 10, earned: 0, note, criteria: [] });
  return {
    score: 42, band: 'blocked',
    gates: [{ label: 'The price of Pashmina Shawl is in conflict', fixPath: `/app/b/${B}/brand/review?section=products` }],
    dimensions: [
      { key: 'product_truth', label: 'Product truth', weight: 15, earned: 5, criteria: [c('At least one product', true), c('Every product has an approved price', false)] },
      { key: 'positioning_audience', label: 'Positioning and audience', weight: 15, earned: 15, criteria: [c('An approved value proposition', true)] },
      { key: 'voice_visual', label: 'Voice and visual', weight: 10, earned: 3, criteria: [c('A logo asset', true), c('Palette roles assigned', false)] },
      { key: 'legal_trust_rights', label: 'Legal, trust and rights', weight: 15, earned: 5, criteria: [c('Approved refund terms', false)] },
      { key: 'goals_budget_approval', label: 'Goals, budget and approval', weight: 10, earned: 4, criteria: [c('An approved primary objective', true)] },
      { key: 'competitor_baseline', label: 'Competitor baseline', weight: 5, earned: 0, criteria: [c('Three competitors, each with a site', false)] },
      later('channels', 'Channels', 'Set up with Publish'),
      later('website_analytics', 'Website and analytics', 'Set up with Results'),
      later('crm', 'CRM and communication', 'Set up with Leads'),
    ],
  };
}

function contrasts(st: State) {
  const t = st.palette.filter((c) => c.role === 'text');
  const bg = st.palette.filter((c) => c.role === 'background');
  return t.flatMap((a) => bg.map((b) => ({ text: a.hex, background: b.hex, ratio: 14.07, aa: true, aaLarge: true })));
}

const pal = (st: State) => ({ colours: st.palette, contrasts: contrasts(st) });

async function stubApi(page: Page, st: State) {
  await page.route('**/stub-storage/**', async (route) => {
    if (route.request().method() === 'PUT') await new Promise((r) => setTimeout(r, 600));
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>' });
  });
  await page.route('**/api/**', async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    const path = url.pathname;
    const body = (req.postData() ? req.postDataJSON() : undefined) as J | undefined;
    const ok = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const err = (status: number, code: string, message: string) => ok({ error: { code, message } }, status);
    if (st.failApi) return route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' });
    if (method !== 'GET') st.calls.push({ method, path: path.replace(API, ''), body });

    if (path === '/api/brands') return ok([brand]);
    if (path === API) return ok(brand);
    const rel = path.slice(API.length);
    const findFact = (id: string) => st.facts.find((f) => f.id === id);
    const version = (f: J, patch: J) => {
      const next = { ...f, ...patch, id: `${f.id}-v${(f.version as number) + 1}`, version: (f.version as number) + 1, supersedesId: f.id, verifiedBy: 'operator', verifiedAt: '2026-11-27T09:00:00Z' };
      st.facts[st.facts.indexOf(f)] = next;
      return next;
    };

    if (rel === '/knowledge/catalogue') return ok(catalogue);
    if (rel === '/knowledge/facts' && method === 'GET') {
      // Pages like the server: at most `limit` (500) facts, and a cursor (the offset) for the next page.
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);
      const at = Number(url.searchParams.get('cursor') ?? 0);
      return ok({ items: st.facts.slice(at, at + limit), next: at + limit < st.facts.length ? String(at + limit) : null });
    }
    if (rel === '/knowledge/facts' && method === 'POST') {
      const f = fact({ id: `new-${++st.n}`, section: body!.section, subjectType: 'brand', subjectId: null, subjectName: null, field: body!.field, fieldLabel: String(body!.field).replaceAll('_', ' '), value: body!.value, unit: body!.unit ?? null, language: body!.language, status: 'approved', origin: 'owner', confidence: null, source: null, quote: null, verifiedBy: 'operator', verifiedAt: '2026-11-27T09:00:00Z' });
      st.facts.push(f);
      return ok(f, 201);
    }
    if (rel === '/knowledge/facts/approve-batch') {
      const ids = body!.ids as string[];
      if (ids.some((id) => findFact(id)?.status !== 'unverified')) return err(409, 'conflict', 'Only quote-checked facts can be approved in a batch.');
      return ok(ids.map((id) => version(findFact(id)!, { status: 'approved' })));
    }
    let m = rel.match(/^\/knowledge\/facts\/([^/]+)\/(approve|reject|history)$/);
    if (m) {
      const f = findFact(m[1]!);
      if (!f) return err(404, 'not_found', 'Not found.');
      if (m[2] === 'history') return ok([f]);
      return ok(version(f, { status: m[2] === 'approve' ? 'approved' : 'rejected' }));
    }
    m = rel.match(/^\/knowledge\/facts\/([^/]+)$/);
    if (m && method === 'PATCH') return ok(version(findFact(m[1]!)!, { value: body!.value, status: 'approved', origin: 'owner' }));
    if (rel === '/knowledge/conflicts/resolve') {
      const keep = (body!.keepFactId ? findFact(body!.keepFactId as string) : st.facts.find((f) => f.status === 'conflicting' && f.field === body!.field))!;
      for (const f of st.facts) if (f.status === 'conflicting' && f.field === keep.field && f !== keep) f.status = 'rejected';
      return ok(version(keep, { status: 'approved', ...(body!.keepFactId ? {} : { value: body!.value, origin: 'owner' }) }));
    }
    if (rel === '/knowledge/subjects') return ok([{ id: 'sub-1', type: 'product', name: 'Pashmina Shawl', createdAt: '2026-11-20T10:00:00Z' }]);

    if (rel === '/competitors' && method === 'GET') return ok(st.competitors);
    if (rel === '/competitors' && method === 'POST') {
      const c = { id: `comp-${++st.n}`, name: body!.name, kind: body!.kind ?? 'direct', site: body!.site ?? null, handles: {}, adLibraryUrl: null, priority: 0 };
      st.competitors.push(c);
      return ok(c, 201);
    }

    if (rel === '/knowledge/palette' && method === 'GET') return ok(pal(st));
    if (rel === '/knowledge/palette' && method === 'PUT') {
      for (const c of body!.colours as { hex: string; role: string | null }[]) {
        const p = st.palette.find((x) => x.hex === c.hex);
        if (p) p.role = c.role;
      }
      return ok(pal(st));
    }
    if (rel === '/knowledge/assets') return method === 'GET' ? ok(st.assets) : ok({ id: 'a-1', ...body, licensed: false, source: file1, createdAt: '2026-11-27T09:00:00Z' }, 201);
    if (rel === '/knowledge/book') {
      const approved = st.facts.filter((f) => f.status === 'approved');
      return ok({
        sections: catalogue.map((s) => ({ key: s.key, label: s.label, facts: approved.filter((f) => f.section === s.key) })),
        palette: pal(st), competitors: st.competitors, readiness: readiness(),
        assets: [{ id: 'logo-1', sourceId: 'lf', kind: 'logo', variant: 'full colour', rights: {}, licensed: true, source: { id: 'lf', kind: 'upload', uri: 'logo.png', meta: { filename: 'logo.png' }, downloadUrl: '/stub-storage/logo.png' }, createdAt: '2026-11-20T10:00:00Z' }],
      });
    }

    if (rel === '/sources' && method === 'GET') return ok(st.sources);
    if (rel === '/sources/uploads') {
      if (body!.mime !== 'application/pdf') return err(400, 'unsupported_type', `Files of type ${body!.mime} are not accepted. Upload a PDF, an image, a Word file or a text file.`);
      const s = { id: 's-file', brandId: B, kind: 'upload', uri: body!.filename, mime: body!.mime, checksum: 'abc', capturedAt: '2026-11-27T09:00:00Z', trust: 'owner', meta: { filename: body!.filename }, hasText: false, downloadUrl: '/stub-storage/price-list.pdf' };
      return ok({ source: s, uploadUrl: '/stub-storage/up-1' }, 201);
    }
    if (rel === '/sources/s-file/complete') {
      const s = { id: 's-file', brandId: B, kind: 'upload', uri: 'price-list.pdf', mime: 'application/pdf', checksum: 'abc', capturedAt: '2026-11-27T09:00:00Z', trust: 'owner', meta: { filename: 'price-list.pdf' }, hasText: true, downloadUrl: '/stub-storage/price-list.pdf' };
      st.sources = [s];
      return ok(s);
    }

    const run = (state: string, stage: string, extra: J = {}) => ({ id: 'run-1', websiteUrl: 'https://himalpashmina.example', sourceIds: ['s-page', 's-file'], stage, state, error: null, blocked: null, estimate: null, actual: null, remaining: money('12.0000', '1860.00'), counts: { ...counts, unverified: 0, inferred: 0, conflicts: 0, colours: 0 }, startedAt: '2026-11-27T09:00:00Z', finishedAt: null, createdAt: '2026-11-27T09:00:00Z', ...extra });
    if (rel === '/knowledge/imports' && method === 'GET') return ok(st.run ? [st.run] : []);
    if (rel === '/knowledge/imports' && method === 'POST') {
      st.phase = 'fetching';
      st.run = run('running', 'fetch');
      return ok(st.run, 201);
    }
    if (rel === '/knowledge/imports/run-1' && method === 'GET') {
      // The first poll still sees the fetch; the next sees the estimate; after confirm, extraction then done.
      if (st.phase === 'fetching') { st.phase = 'awaiting'; st.run = run('running', 'fetch'); }
      else if (st.phase === 'awaiting') st.run = run('awaiting_approval', 'estimate', { estimate: money('0.0950', '12.40') });
      else if (st.phase === 'extracting') { st.phase = 'done'; st.run = run('running', 'extract', { estimate: money('0.0950', '12.40') }); }
      else st.run = run('completed', 'done', { estimate: money('0.0950', '12.40'), actual: money('0.0632', '9.80'), counts, finishedAt: '2026-11-27T09:02:00Z' });
      return ok(st.run);
    }
    if (rel === '/knowledge/imports/run-1/confirm') {
      st.phase = 'extracting';
      st.run = run('running', 'extract', { estimate: money('0.0950', '12.40') });
      return ok(st.run);
    }
    return err(501, 'not_implemented', `No stub for ${method} ${rel}`);
  });
}

async function open(page: Page, path: string, mutate?: (st: State) => void) {
  const st = seed();
  mutate?.(st);
  await stubApi(page, st);
  await page.goto(`/app/b/${B}/brand${path}`);
  return st;
}

const row = (page: Page, name: string | RegExp) => page.locator('[data-fact-row]').filter({ has: page.getByRole('heading', { name }) });

test.describe('sources and import', () => {
  test('starts an import, shows the run, confirms the estimate and ends with the actual cost', async ({ page }) => {
    test.setTimeout(90_000);
    const st = await open(page, '/sources');
    await expect(page.getByLabel('Website address')).toHaveValue('https://himalpashmina.example');

    // A refused file type shows the server's own message.
    await page.getByLabel('Choose files to upload').setInputFiles({ name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
    await expect(page.getByRole('alert').filter({ hasText: 'Files of type application/x-msdownload are not accepted' })).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss setup.exe' }).click();

    // An accepted one shows its progress, then joins the list.
    await page.getByLabel('Choose files to upload').setInputFiles({ name: 'price-list.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await expect(page.getByRole('progressbar', { name: 'Uploading price-list.pdf' })).toBeVisible();
    const files = page.getByRole('list', { name: 'Uploaded files' });
    await expect(files.getByRole('listitem')).toContainText('price-list.pdf');
    await expect(files.getByRole('checkbox', { name: /price-list.pdf/ })).toBeChecked();

    await page.getByRole('button', { name: 'Start import' }).click();
    const start = st.calls.find((c) => c.path === '/knowledge/imports')!;
    expect(start.body).toMatchObject({ websiteUrl: 'https://himalpashmina.example', sourceIds: ['s-file'] });

    await expect(page.getByRole('region', { name: 'Import' }).getByText('Running')).toBeVisible();
    const confirm = page.getByRole('region', { name: 'Confirm the cost' });
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await expect(confirm).toContainText('NPR 12.40');
    await expect(confirm).toContainText('NPR 1,860.00');
    await expect(confirm).toContainText('Reading 6 pages and 1 file');
    await confirm.getByRole('button', { name: 'Confirm and start' }).click();
    expect(st.calls.some((c) => c.path === '/knowledge/imports/run-1/confirm')).toBe(true);

    const result = page.getByRole('region', { name: 'Import result' });
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result).toContainText('NPR 9.80');
    await expect(result.getByRole('link', { name: /Review the facts/ })).toHaveAttribute('href', `/app/b/${B}/brand/review`);
  });
});

test.describe('review', () => {
  test('shows a quote-checked fact with its source and quote, an inferred one with its warning, and the conflict first', async ({ page }) => {
    await open(page, '/review?section=products');
    const name = row(page, 'Name');
    await expect(name).toContainText('Himalayan Pashmina Shawl');
    await expect(name).toContainText('“Himalayan Pashmina Shawl, hand-woven”');
    await expect(name.getByRole('link', { name: /Shop \| Himal Pashmina/ })).toHaveAttribute('href', 'https://himalpashmina.example/shop');

    const inferred = row(page, 'Description');
    await expect(inferred).toContainText('Quote not found in source');
    await expect(inferred.getByText('Inferred')).toBeVisible();

    const conflict = page.locator('[data-conflict]');
    await expect(conflict).toContainText('Pashmina Shawl: Price: which is right?');
    await expect(conflict).toContainText('“मूल्य रु ५,०००”');
    await expect(conflict.getByRole('link', { name: /price-list\.pdf/ })).toBeVisible();
    const [c, f] = [await conflict.boundingBox(), await name.boundingBox()];
    expect(c!.y).toBeLessThan(f!.y);
    // Conflicting facts have no approve button of their own.
    await expect(page.getByRole('button', { name: /^Approve .*Price/ })).toHaveCount(0);
  });

  test('approves, edits and rejects a fact', async ({ page }) => {
    const st = await open(page, '/review?section=products');
    await page.getByRole('button', { name: 'Approve Pashmina Shawl, Name' }).click();
    await expect(row(page, 'Name')).toHaveCount(0);
    expect(st.calls.at(-1)).toMatchObject({ method: 'POST', path: '/knowledge/facts/f-name/approve' });

    await page.getByRole('button', { name: 'Edit Pashmina Shawl, Description' }).click();
    await page.getByLabel('Value for Description').fill('Hand-woven in Kathmandu from Himalayan cashmere.');
    await page.getByRole('button', { name: 'Save and approve' }).click();
    expect(st.calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/knowledge/facts/f-desc', body: { value: 'Hand-woven in Kathmandu from Himalayan cashmere.' } });

    await page.getByRole('button', { name: 'Reject Pashmina Shawl, Features' }).click();
    await page.getByLabel(/Why reject it/).fill('Not true of the whole range');
    await page.getByRole('button', { name: 'Reject Features', exact: true }).click();
    expect(st.calls.at(-1)).toMatchObject({ path: '/knowledge/facts/f-feat/reject', body: { reason: 'Not true of the whole range' } });

    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^Approved/ }).click();
    await expect(row(page, 'Name').getByText('Approved')).toBeVisible();
    await expect(row(page, 'Description')).toContainText('Hand-woven in Kathmandu');
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^Rejected/ }).click();
    await expect(row(page, 'Features').getByText('Rejected')).toBeVisible();
  });

  test('resolves the price conflict by keeping one value', async ({ page }) => {
    const st = await open(page, '/review?section=products');
    await page.getByRole('button', { name: /Keep NPR 4500 for Pashmina Shawl: Price/ }).click();
    await expect(page.locator('[data-conflict]')).toHaveCount(0);
    expect(st.calls.at(-1)).toMatchObject({ path: '/knowledge/conflicts/resolve', body: { keepFactId: 'f-pa' } });
  });

  test('resolves a conflict by typing the right value', async ({ page }) => {
    const st = await open(page, '/review?section=products');
    await page.getByRole('button', { name: /Type the right value for Pashmina Shawl: Price/ }).click();
    await page.getByLabel(/The right value for/).fill('4800');
    await page.getByRole('button', { name: 'Use this value' }).click();
    await expect(page.locator('[data-conflict]')).toHaveCount(0);
    expect(st.calls.at(-1)).toMatchObject({ path: '/knowledge/conflicts/resolve', body: { section: 'products', subjectId: 'sub-1', field: 'price', value: 4800, unit: 'NPR' } });
  });

  test('"Approve all shown" approves quote-checked facts and skips conflicting and inferred ones', async ({ page }) => {
    const st = await open(page, '/review?section=products');
    await page.getByRole('button', { name: 'Approve all shown (2)' }).click();
    await expect(page.getByText('Approve 2 quote-checked facts?')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, approve 2' }).click();
    const batch = st.calls.find((c) => c.path === '/knowledge/facts/approve-batch')!;
    expect((batch.body as { ids: string[] }).ids.sort()).toEqual(['f-feat', 'f-name']);
    await expect(page.getByText('Approved 2 facts.')).toBeVisible();
    // The conflict and the inferred fact are still waiting.
    await expect(page.locator('[data-conflict]')).toBeVisible();
    await expect(row(page, 'Description')).toBeVisible();
  });

  test('loads every page of facts for a brand with more than 500', async ({ page }) => {
    await open(page, '/review?section=products', (st) => {
      for (let i = 0; i < 1100; i++) st.facts.push(fact({ id: `bulk-${i}`, subjectId: `bulk-sub-${i}`, subjectName: `Bulk product ${i}`, field: 'name', fieldLabel: 'Name', value: `Bulk ${i}`, quote: `Bulk ${i} quote text` }));
    });
    // The last fact is on the third page; the seven seeded ones are on the first.
    await expect(page.getByRole('heading', { name: 'Bulk product 1099' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^To review 1105$/ })).toBeVisible();
  });

  test('enters a goal and a competitor', async ({ page }) => {
    const st = await open(page, '/review?section=goals');
    await page.getByLabel('Value for Primary objective').selectOption('sales');
    await page.getByRole('button', { name: 'Add and approve' }).click();
    expect(st.calls.at(-1)).toMatchObject({ path: '/knowledge/facts', body: { section: 'goals', field: 'primary_objective', value: 'sales', language: 'en' } });
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^Approved/ }).click();
    await expect(page.locator('[data-fact-row]')).toContainText('sales');

    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Competitors' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Kashmir Looms');
    await page.getByLabel('Website').fill('kashmirlooms.example');
    await page.getByRole('button', { name: 'Add competitor' }).click();
    expect(st.calls.at(-1)).toMatchObject({ path: '/competitors', body: { name: 'Kashmir Looms', kind: 'direct', site: 'https://kashmirlooms.example' } });
    await expect(page.getByRole('list', { name: 'Competitors' })).toContainText('Kashmir Looms');
  });

  test('renders a long Nepali value in full', async ({ page }) => {
    await open(page, '/review?section=positioning');
    const value = page.locator('[data-fact-row] p[lang="ne"]').first();
    await expect(value).toHaveText(NEPALI);
    const clipped = await value.evaluate((el) => el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === 'ellipsis');
    expect(clipped).toBe(false);
  });

  test('works from the keyboard alone, and every action has a name', async ({ page }) => {
    const st = await open(page, '/review?section=products');
    const rows = page.locator('[data-fact-row]');
    await expect(rows).toHaveCount(3);
    await rows.first().focus();

    // Tab from a fact reaches its actions, which are named.
    await page.keyboard.press('Tab'); // the source link comes first
    await expect(page.locator(':focus')).toHaveAccessibleName(/Shop \| Himal Pashmina/);
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAccessibleName('Approve Pashmina Shawl, Name');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAccessibleName('Edit Pashmina Shawl, Name');
    await rows.first().focus();

    // A approves and focus stays in the list, on the next fact.
    await page.keyboard.press('a');
    await expect.poll(() => st.calls.at(-1)?.path).toBe('/knowledge/facts/f-name/approve');
    await expect(page.locator(':focus')).toHaveAttribute('data-fact-row', 'f-desc');

    // E edits, type, Ctrl+Enter saves.
    await page.keyboard.press('e');
    await page.getByLabel('Value for Description').fill('Warm and light.');
    await page.keyboard.press('Control+Enter'); // a textarea keeps Enter for new lines
    await expect.poll(() => st.calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/knowledge/facts/f-desc' });

    // R opens the reject form; Enter in the reason submits it.
    await expect(page.locator(':focus')).toHaveAttribute('data-fact-row', 'f-feat');
    await page.keyboard.press('r');
    await page.keyboard.type('Wrong');
    await page.keyboard.press('Enter');
    await expect.poll(() => st.calls.at(-1)).toMatchObject({ path: '/knowledge/facts/f-feat/reject', body: { reason: 'Wrong' } });
  });
});

test.describe('visual identity', () => {
  test('assigns palette roles and shows the contrast figure', async ({ page }) => {
    const st = await open(page, '/visual');
    await expect(page.getByText('(approximate)').first()).toBeVisible();
    await expect(page.getByText('RGB 15 82 87')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Swatch #0f5257' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'full colour' })).toBeVisible();
    await page.getByLabel('Role of #24201d').selectOption('text');
    await page.getByLabel('Role of #f5efe5').selectOption('background');
    await page.getByRole('button', { name: 'Save palette' }).click();
    await expect(page.getByRole('list', { name: 'Contrast pairs' })).toContainText('14.07:1');
    await expect(page.getByRole('list', { name: 'Contrast pairs' })).toContainText('Passes AA');
    expect(st.calls.at(-1)).toMatchObject({ method: 'PUT', path: '/knowledge/palette' });
    expect((st.calls.at(-1)!.body as { colours: unknown[] }).colours).toContainEqual({ hex: '#24201d', role: 'text' });
  });

  test('fills in the suggested roles as an unsaved draft that the owner saves', async ({ page }) => {
    const st = await open(page, '/visual', (s) => {
      for (const [c, role] of [[0, 'primary'], [1, 'background'], [2, 'text']] as const) s.palette[c]!.suggestedRole = role;
    });
    await expect(page.getByText('Prachaar suggested the roles marked below')).toBeVisible();
    await expect(page.getByLabel('Role of #0f5257')).toHaveValue('primary');
    await expect(page.getByLabel('Role of #f5efe5')).toHaveValue('background');
    await expect(page.getByText('Suggested role')).toHaveCount(3);
    expect(st.calls.some((c) => c.path === '/knowledge/palette')).toBe(false); // nothing saved until the owner says so
    await page.getByLabel('Role of #24201d').selectOption('accent');
    await expect(page.getByText('Suggested role')).toHaveCount(2);
    await page.getByRole('button', { name: 'Save palette' }).click();
    await expect.poll(() => st.calls.find((c) => c.path === '/knowledge/palette')?.body).toEqual({
      colours: [{ hex: '#0f5257', role: 'primary' }, { hex: '#f5efe5', role: 'background' }, { hex: '#24201d', role: 'accent' }],
    });
  });

  test('asks for each item with an example, and confirms the logo and font the website gave', async ({ page }) => {
    const st = await open(page, '/visual', (s) => {
      s.sources = [{ id: 's-logo', brandId: B, kind: 'upload', uri: 'https://himalpashmina.example/logo.svg', mime: 'image/svg+xml', checksum: 'c', capturedAt: '2026-11-27T09:00:00Z', trust: 'brand_site', meta: { filename: 'logo.svg', status: 'ready', foundOnSite: true }, hasText: false, downloadUrl: '/stub-storage/logo.svg' }];
      s.facts.push(fact({ id: 'f-font', section: 'visual', subjectType: 'brand', subjectId: null, subjectName: null, field: 'fonts', fieldLabel: 'Licensed fonts', value: 'Mukta', language: 'und', status: 'inferred', origin: 'inferred', confidence: 0.6, source: null, quote: null }));
    });
    await expect(page.getByText('Example: ilamleaf-logo.svg')).toBeVisible();
    await expect(page.getByText('Example: #0f5257')).toBeVisible();
    await expect(page.getByLabel('Add a font by name')).toHaveAccessibleDescription(/Example: Mukta/);

    await page.getByLabel(/We own this logo/).check();
    await page.getByRole('button', { name: 'Use this logo' }).click();
    await expect.poll(() => st.calls.find((c) => c.path === '/knowledge/assets')?.body).toEqual({
      sourceId: 's-logo', kind: 'logo', rights: { owner: 'Himal Pashmina', licence: 'Owned by the brand', commercialUse: true, paidUse: true },
    });

    await page.getByRole('button', { name: 'Yes, ours' }).click();
    await expect.poll(() => st.calls.some((c) => c.path === '/knowledge/facts/f-font/approve')).toBe(true);

    await page.getByLabel('Add a font by name').fill('Poppins');
    await page.getByRole('button', { name: 'Add font' }).click();
    await expect.poll(() => st.calls.find((c) => c.path === '/knowledge/facts')?.body).toEqual({ section: 'visual', subjectId: null, field: 'fonts', value: 'Poppins', language: 'und' });
    await expect(page.getByLabel('Add a font by name')).toHaveValue('');
  });
});

test.describe('brand book', () => {
  test('shows the score, its dimensions with the three later notes, and a gate that links to its fix', async ({ page }) => {
    await open(page, '');
    await expect(page.getByLabel('Score 42 out of 100')).toBeVisible();
    await expect(page.getByText('Blocked', { exact: true })).toBeVisible();
    const dims = page.getByRole('list', { name: 'Dimensions' });
    await expect(dims.getByRole('heading')).toHaveCount(9);
    for (const note of ['Set up with Publish', 'Set up with Results', 'Set up with Leads']) await expect(dims.getByText(note)).toBeVisible();

    const gate = page.getByRole('list', { name: 'Gates' });
    await expect(gate).toContainText('The price of Pashmina Shawl is in conflict');
    await expect(gate.getByRole('link', { name: 'Fix this' })).toHaveAttribute('href', `/app/b/${B}/brand/review?section=products`);
    await expect(dims.getByRole('link', { name: /Fix Every product has an approved price/ })).toHaveAttribute('href', `/app/b/${B}/brand/review?section=products`);
    await gate.getByRole('link', { name: 'Fix this' }).click();
    await expect(page).toHaveURL(/review\?section=products/);
  });
});

test('shows the error state when the API fails', async ({ page }) => {
  await open(page, '/review', (st) => { st.failApi = true; });
  const state = page.locator('[data-state="error"]').filter({ hasText: 'The brand fields could not be loaded' });
  await expect(state).toBeVisible({ timeout: 20_000 });
  await expect(state.getByRole('button', { name: 'Try again' })).toBeVisible();
});
