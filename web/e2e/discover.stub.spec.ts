import { expect, test, type Page } from '@playwright/test';

// Find competitors against a stubbed API. Bodies follow server/openapi.json; the server branch is not needed.
const B = 'brand-1';
const NOW = '2026-11-28T06:00:00.000Z';
const money = (npr: string) => ({ npr, usd: (Number(npr) / 150).toFixed(4) });
const brand = { id: B, name: 'Himal Momo', slug: 'himal', website: null, country: 'NP', timezone: 'Asia/Kathmandu', currency: 'NPR', defaultLanguage: 'en', languages: ['en', 'ne'], status: 'active', createdAt: NOW };
const inferred = (value: string, confidence = 'medium') => ({ value, basis: 'inferred', reason: `Its page talks about ${value}`, evidence: ['src-1', 'fact-9'], confidence });
const quoted = (value: string) => ({ value, basis: 'quoted', quote: value, sourceId: 'src-1' });
const cand = (o: object = {}) => ({ id: 'cand-1', name: 'Momo Hut', site: 'https://momohut.example', channels: ['https://facebook.com/momohut', 'javascript:alert(1)'], place: { address: null, category: null, rating: 4.4, ratingCount: 120, phone: null, cid: 'c1' }, cells: { kind: inferred('direct'), sells: quoted('Momo, thukpa'), sellsTo: inferred('Students'), overlap: inferred('high') }, sourceIds: ['src-1'], rank: 1, status: 'new', competitorId: null, lastFoundAt: NOW, dismissedAt: null, ...o });
const FOUND = () => [
  cand(),
  cand({ id: 'cand-2', name: 'Bhojan Ghar', site: 'https://bhojan.example', channels: [], place: null, cells: { kind: inferred('indirect'), overlap: inferred('medium') }, rank: 2 }),
  cand({ id: 'cand-3', name: 'दाइको मोमो', site: null, channels: [], place: null, cells: { kind: inferred('direct') }, rank: 3 }),
];
const run = (o: object = {}) => ({ id: 'd-1', keywords: ['momo Lalitpur'], state: 'awaiting_approval', error: null, startedAt: NOW, finishedAt: null, estimate: money('300'), actual: null, counts: {}, ownRow: null, createdAt: NOW, ...o });
const DONE = { state: 'completed', finishedAt: NOW, estimate: money('300'), actual: money('120'), counts: { queries: 4, results: 40, found: 3, skipped: 2, profiled: 3, dropped: 1 }, ownRow: { sells: { value: 'Steamed and frozen momo', factIds: ['fact-1'] }, where: { value: 'Kathmandu', factIds: ['fact-2'] } } };

type World = { calls: string[]; bodies: any[]; runs: any[]; cands: any[]; found: any[]; targets: any[]; unreadable: string[] };

async function stub(page: Page, init: Partial<World> = {}) {
  const w: World = { calls: [], bodies: [], runs: [], cands: [], found: FOUND(), targets: [], unreadable: [], ...init };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(`/api/brands/${B}`, '') || '/';
    const m = req.method();
    const body = req.postDataJSON?.() ?? null;
    w.calls.push(`${m} ${path}`);
    w.bodies.push(body);
    const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    let x: RegExpMatchArray | null;
    if (path === '/api/brands') return send([brand]);
    if (path === '/') return send(brand);
    if (path === '/competitors') return send([]);
    if (path === '/costs') return send({ month: '2026-11', total: money('0'), cap: money('1000'), remaining: money('1000'), runs: [] });
    if (path === '/sources') return send([{ id: 'src-1', brandId: B, kind: 'page', uri: 'https://momohut.example/', mime: 'text/html', checksum: 'x', capturedAt: NOW, trust: 'external', meta: { title: 'Momo Hut home' }, hasText: true, downloadUrl: '' }]);
    if (path === '/research/targets') return send(w.targets);
    if (path === '/research/discovery/keywords') return send({ keywords: ['momo restaurant Kathmandu', 'frozen momo Nepal'] });
    if (path === '/research/discoveries' && m === 'GET') return send(w.runs);
    if (path === '/research/discoveries' && m === 'POST') { const r = run({ keywords: body.keywords }); w.runs.unshift(r); return send(r, 201); }
    if ((x = path.match(/^\/research\/discoveries\/([\w-]+)(\/confirm)?$/))) {
      const r = w.runs.find((r: any) => r.id === x![1]);
      if (x[2]) { Object.assign(r, DONE, w.found.length ? {} : { counts: { ...DONE.counts, found: 0 } }); w.cands = w.found; }
      return send(r);
    }
    if (path === '/research/candidates' && m === 'GET') return send(w.cands.filter((c: any) => (url.searchParams.get('status') ? c.status === url.searchParams.get('status') : c.status !== 'dismissed')));
    if (path === '/research/candidates/watch') {
      const watched = w.cands.filter((c: any) => body.ids.includes(c.id)).map((c: any) => Object.assign(c, { status: 'watched', competitorId: `comp-${c.id}` }));
      return send({ watched, unreadable: w.unreadable });
    }
    if ((x = path.match(/^\/research\/candidates\/([\w-]+)\/(dismiss|restore)$/))) {
      const c = w.cands.find((c: any) => c.id === x![1]);
      c.status = x[2] === 'dismiss' ? 'dismissed' : 'new';
      return send(c);
    }
    return send({ error: { code: 'not_stubbed', message: `${m} ${path}` } }, 404);
  });
  return w;
}

test('suggest, edit, confirm, compare, watch one and hide one', async ({ page }) => {
  const w = await stub(page);
  await page.goto(`/app/b/${B}/research/discover`);
  await page.getByRole('button', { name: 'Suggest keywords' }).click();
  const chips = page.getByRole('list', { name: 'Keywords' });
  await expect(chips).toContainText('momo restaurant Kathmandu');
  await expect(chips).toContainText('frozen momo Nepal');
  await chips.getByRole('button', { name: 'Remove frozen momo Nepal' }).click();
  await page.getByLabel('Add a keyword').fill('momo Lalitpur');
  await page.getByRole('button', { name: 'Add keyword' }).click();
  await expect(chips).toContainText('momo Lalitpur');

  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const confirm = page.getByRole('region', { name: 'Confirm the cost' });
  await expect(confirm).toContainText('NPR 300');
  expect(w.bodies[w.calls.lastIndexOf('POST /research/discoveries')]).toEqual({ keywords: ['momo restaurant Kathmandu', 'momo Lalitpur'] });
  await confirm.getByRole('button', { name: 'Confirm and start' }).click();
  await expect(page.getByText('Found 3 businesses, described 3; 2 you already watch or hid were skipped; 1 unsupported cell dropped.')).toBeVisible();

  const table = page.getByRole('table', { name: 'Competitors found' });
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText('Your brand');
  await expect(rows.first()).toContainText('Steamed and frozen momo');

  const hut = rows.filter({ hasText: 'Momo Hut' });
  await hut.getByRole('button', { name: /^high/ }).click();
  const pop = page.locator('[popover]:popover-open');
  await expect(pop).toContainText('Its page talks about high');
  await expect(pop).toContainText('medium confidence');
  await expect(pop.getByRole('link', { name: /momohut\.example/ })).toBeVisible();
  await expect(pop.getByRole('link', { name: 'Brand review' })).toHaveAttribute('href', `/app/b/${B}/brand/review`);
  await page.keyboard.press('Escape');

  await hut.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Watch selected' }).click();
  await expect(hut).toContainText('Watching');
  expect(w.bodies[w.calls.indexOf('POST /research/candidates/watch')]).toEqual({ ids: ['cand-1'] });

  const bhojan = rows.filter({ hasText: 'Bhojan Ghar' });
  await bhojan.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Not a competitor' }).click();
  await expect(bhojan).toHaveCount(0);
  await page.getByText('Hidden (1)').click();
  await page.getByRole('button', { name: /Restore/ }).click();
  await expect(rows.filter({ hasText: 'Bhojan Ghar' })).toBeVisible();
});

test('shows the empty state when nothing was found', async ({ page }) => {
  await stub(page, { found: [] });
  await page.goto(`/app/b/${B}/research/discover`);
  await page.getByLabel('Add a keyword').fill('momo');
  await page.getByRole('button', { name: 'Add keyword' }).click();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and start' }).click();
  await expect(page.getByText('No businesses found. Try broader keywords.')).toBeVisible();
});

test('a candidate without a website says so, and a javascript: channel is not a link', async ({ page }) => {
  await stub(page, { cands: FOUND(), runs: [run({ ...DONE })] });
  await page.goto(`/app/b/${B}/research/discover`);
  const rows = page.getByRole('table', { name: 'Competitors found' }).locator('tbody tr');
  await expect(rows.filter({ hasText: 'दाइको मोमो' })).toContainText('No website to watch');
  const hut = rows.filter({ hasText: 'Momo Hut' });
  await expect(hut.getByRole('link', { name: /FB/ })).toHaveAttribute('href', 'https://facebook.com/momohut');
  await expect(hut.getByRole('link', { name: /Map 4\.4/ })).toBeVisible();
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
});

test('the Maps listing a run stored among the channels shows once, as the Map chip', async ({ page }) => {
  const listed = cand({ channels: ['https://www.google.com/maps?cid=c1', 'https://facebook.com/momohut'] });
  await stub(page, { cands: [listed], runs: [run({ ...DONE })] });
  await page.goto(`/app/b/${B}/research/discover`);
  const hut = page.getByRole('table', { name: 'Competitors found' }).locator('tbody tr').filter({ hasText: 'Momo Hut' });
  await expect(hut.getByRole('link', { name: /Map 4\.4/ })).toHaveAttribute('href', 'https://maps.google.com/?cid=c1');
  await expect(hut.getByRole('link', { name: /FB/ })).toBeVisible();
  await expect(hut.getByRole('link', { name: /google|Map/ })).toHaveCount(1);
});

test('a watched business whose site could not be read links to its competitor page', async ({ page }) => {
  await stub(page, { cands: FOUND(), runs: [run({ ...DONE })], unreadable: ['cand-1'] });
  await page.goto(`/app/b/${B}/research/discover`);
  const hut = page.getByRole('table', { name: 'Competitors found' }).locator('tbody tr').filter({ hasText: 'Momo Hut' });
  await hut.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Watch selected' }).click();
  await expect(hut).toContainText('Watching');
  await expect(hut).toContainText('Couldn’t read the site');
  await expect(hut.getByRole('link', { name: 'the competitor’s page' })).toHaveAttribute('href', `/app/b/${B}/research/competitors/comp-cand-1`);
});

test('blocks ticking more competitors with a website than free slots', async ({ page }) => {
  const targets = Array.from({ length: 9 }, (_, i) => ({ id: `t-${i}`, competitorId: `c-${i}`, url: `https://c${i}.example`, label: null, status: 'active', failCount: 0, lastError: null, lastSourceId: null, createdAt: NOW }));
  await stub(page, { cands: FOUND(), runs: [run({ ...DONE })], targets });
  await page.goto(`/app/b/${B}/research/discover`);
  const rows = page.getByRole('table', { name: 'Competitors found' }).locator('tbody tr');
  await rows.filter({ hasText: 'Momo Hut' }).getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: 'Watch selected' })).toBeEnabled();
  await rows.filter({ hasText: 'Bhojan Ghar' }).getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: 'Watch selected' })).toBeDisabled();
  await expect(page.getByText('1 slot free')).toBeVisible();
});

test('the page does not scroll sideways at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await stub(page, { cands: FOUND(), runs: [run({ ...DONE })] });
  await page.goto(`/app/b/${B}/research/discover`);
  await expect(page.getByRole('table', { name: 'Competitors found' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('a long Devanagari keyword and a Devanagari quote fit at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const quote = 'काठमाडौंको सबैभन्दा मिठो र ताजा मःमः, हरेक दिन बिहानै बनाइन्छ';
  await stub(page, { cands: [cand({ name: 'दाइको मोमो पसल', cells: { kind: inferred('direct'), pitch: quoted(quote) } })], runs: [run({ ...DONE })] });
  await page.goto(`/app/b/${B}/research/discover`);
  const keyword = 'काठमाडौंमाघरघरैमामःमःडेलिभरीगर्नेरेस्टुरेन्टहरूकोसूचीरमूल्यतुलना';
  await page.getByLabel('Add a keyword').fill(keyword);
  await page.getByRole('button', { name: 'Add keyword' }).click();
  await expect(page.getByRole('list', { name: 'Keywords' })).toContainText(keyword);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole('button', { name: new RegExp(`^${quote.slice(0, 12)}`) }).click();
  const pop = page.locator('[popover]:popover-open');
  await expect(pop).toContainText(quote);
  const box = (await pop.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
