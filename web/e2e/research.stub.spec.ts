import { expect, test, type Locator, type Page } from '@playwright/test';

// Screens against a stubbed API. Bodies follow server/openapi.json; the server branch is not needed.
const B = 'brand-1';
const C = 'comp-1';
const NOW = '2026-11-23T06:00:00.000Z';
const money = (npr: string) => ({ npr, usd: (Number(npr) / 150).toFixed(4) });

const brand = { id: B, name: 'Himal Pashmina', slug: 'himal', website: null, country: 'NP', timezone: 'Asia/Kathmandu', currency: 'NPR', defaultLanguage: 'en', languages: ['en', 'ne'], status: 'active', createdAt: NOW };
const competitor = { id: C, name: 'Rival Shawls', kind: 'direct', site: 'https://rival.example', handles: {}, adLibraryUrl: 'https://www.facebook.com/ads/library/?q=rival', priority: 1 };
const run = (o: object = {}) => ({ id: 'run-1', trigger: 'weekly', state: 'completed', error: null, startedAt: NOW, finishedAt: NOW, estimate: null, actual: money('12.5'), counts: { pages: 2, changed: 1, unchanged: 1, failed: 0, observations: 2, discarded: 0, opportunities: 1 }, createdAt: NOW, ...o });
const target = (o: object = {}) => ({ id: 't-1', competitorId: C, url: 'https://rival.example/pricing', label: 'Pricing', status: 'active', failCount: 0, lastError: null, lastSourceId: 's-1', createdAt: NOW, ...o });
const obs = [
  { id: 'o-1', competitorId: C, competitorName: 'Rival Shawls', runId: 'run-1', type: 'price_change', summary: 'Pashmina shawl price cut from NPR 4,500 to NPR 3,900', before: { quote: 'Pashmina shawl NPR 4,500', sourceId: 's-0' }, after: { quote: 'Pashmina shawl NPR 3,900', sourceId: 's-1' }, url: 'https://rival.example/pricing', observedAt: NOW, confidence: 'high' },
  { id: 'o-2', competitorId: C, competitorName: 'Rival Shawls', runId: 'run-1', type: 'new_offer', summary: 'Dashain offer on the home page', before: null, after: { quote: 'दशैं विशेष छुट — सुपर पश्मिना सल रु ३,९००', sourceId: 's-2' }, url: 'https://rival.example/', observedAt: NOW, confidence: 'medium' },
];
const opp = { id: 'op-1', runId: 'run-1', title: 'Answer the shawl price cut', hypothesis: 'Rival’s cut will pull price-led buyers.', suggestedAction: 'Lead the next post with the hand-woven proof.', whyItMatters: 'Price is the first thing shoppers compare.', observationIds: ['o-1'], confidence: 'medium', status: 'new', decidedAt: null, createdAt: NOW };
const statement = (text: string) => ({ text, factIds: ['f-1'], observationIds: ['o-1'] });
const card = (o: object = {}) => ({ id: 'bc-2', competitorId: C, version: 2, status: 'draft', body: { differ: [statement('Hand-woven in Patan')], proof: [statement('Fifteen years of weaving')], objections: [statement('Rival is cheaper')], responses: [statement('Ours lasts a generation')] }, leftOut: [{ text: 'Ours is the softest shawl in Nepal', reason: 'no approved fact' }], approvedAt: null, createdAt: NOW, ...o });

type World = Record<string, any> & { calls: string[] };

async function stub(page: Page, init: Partial<World> = {}) {
  const w: World = { competitors: [competitor], targets: [target()], runs: [run()], observations: obs, opportunities: [opp], battlecard: { approved: null, draft: null }, suggest: ['https://rival.example/offers'], calls: [], ...init };
  const costs = { month: '2026-11', total: money('12.5'), cap: money('1000'), remaining: money('987.5'), runs: [{ runType: 'research', runId: 'run-1', calls: 1, failedCalls: 0, inputTokens: 1, outputTokens: 1, cost: money('12.5'), lastAt: NOW }] };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(`/api/brands/${B}`, '') || '/';
    const m = req.method();
    const body = req.postDataJSON?.() ?? null;
    w.calls.push(`${m} ${path}`);
    const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: data === undefined ? '' : JSON.stringify(data) });
    let x: RegExpMatchArray | null;
    if (path === '/api/brands') return send([brand]);
    if (path === '/') return send(brand);
    if (path === '/competitors') return send(w.competitors);
    if (path === '/costs') return send(costs);
    if (path === '/research/targets' && m === 'GET') return send(w.targets);
    if (path === '/research/targets' && m === 'POST') { const t = target({ id: `t-${w.targets.length + 1}`, url: body.url, label: body.label ?? null }); w.targets.push(t); return send(t, 201); }
    if (path === '/research/targets/suggest') return send({ urls: w.suggest });
    if ((x = path.match(/^\/research\/targets\/([\w-]+)$/))) {
      const t = w.targets.find((t: any) => t.id === x![1]);
      if (m === 'PATCH') { t.status = body.status; return send(t); }
      w.targets = w.targets.filter((t: any) => t.id !== x![1]);
      return send(undefined, 204);
    }
    if (path === '/research/runs' && m === 'GET') return send(w.runs);
    if (path === '/research/runs' && m === 'POST') {
      const r = run({ id: 'run-2', trigger: body.trigger, state: body.trigger === 'baseline' ? 'awaiting_approval' : 'running', estimate: money('40'), actual: null, finishedAt: null, counts: { pages: 2, changed: 0, unchanged: 0, failed: 0, observations: 0, discarded: 0, opportunities: 0 }, createdAt: '2026-11-27T06:00:00.000Z' });
      w.runs.unshift(r);
      return send(r, 201);
    }
    if ((x = path.match(/^\/research\/runs\/([\w-]+)(\/confirm)?$/))) {
      const r = w.runs.find((r: any) => r.id === x![1]);
      if (x[2]) r.state = 'running';
      return send(r);
    }
    if (path === '/research/schedule') return send({ enabled: true, weekday: 1, hour: 6, lastRunAt: NOW });
    if (path === '/research/observations') return send(w.observations);
    if (path === `/research/competitors/${C}/profile`) return send({ error: { code: 'not_found', message: 'No profile' } }, 404);
    if (path === '/research/opportunities') return send(w.opportunities.filter((o: any) => o.status === new URL(req.url()).searchParams.get('status')));
    if ((x = path.match(/^\/research\/opportunities\/([\w-]+)\/(accept|dismiss)$/))) { const o = w.opportunities.find((o: any) => o.id === x![1]); o.status = x[2] === 'accept' ? 'accepted' : 'dismissed'; return send(o); }
    if (path === `/research/competitors/${C}/battlecard`) return send(w.battlecard);
    if (path === `/research/competitors/${C}/battlecard/generate`) { w.battlecard = { ...w.battlecard, draft: card() }; return send(w.battlecard.draft, 201); }
    if (path === `/research/competitors/${C}/battlecard/approve`) { const a = { ...w.battlecard.draft, status: 'approved', approvedAt: NOW }; w.battlecard = { approved: a, draft: null }; return send(a); }
    return send({ error: { code: 'not_stubbed', message: `${m} ${path}` } }, 404);
  });
  return w;
}

/** Tab until the locator has focus; a control that cannot be reached by keyboard fails here. */
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('not reachable by Tab');
}

test('overview shows a price change with both quotes, and a Devanagari quote untruncated', async ({ page }) => {
  await stub(page);
  await page.goto(`/app/b/${B}/research`);
  const card = page.getByRole('article', { name: /Price change/ });
  await expect(card).toBeVisible();
  await expect(card.getByText('“Pashmina shawl NPR 4,500”')).toBeVisible();
  await expect(card.getByText('“Pashmina shawl NPR 3,900”')).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Before' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Rival Shawls' })).toBeVisible();
  await expect(page.getByText('“दशैं विशेष छुट — सुपर पश्मिना सल रु ३,९००”')).toBeVisible();
  await expect(page.getByText('Research this month')).toBeVisible();
});

test('a brand with no competitors gets an empty state linking to the brand review', async ({ page }) => {
  await stub(page, { competitors: [] });
  await page.goto(`/app/b/${B}/research`);
  await expect(page.locator('[data-state="empty"]')).toContainText('No competitors to watch yet');
  await expect(page.getByRole('link', { name: 'Review the brand' })).toHaveAttribute('href', `/app/b/${B}/brand/review`);
});

test('add a watched page, then pause it', async ({ page }) => {
  const w = await stub(page, { targets: [] });
  await page.goto(`/app/b/${B}/research/competitors/${C}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Rival Shawls' })).toBeVisible();
  await page.getByLabel('Page address').fill('https://rival.example/offers');
  await page.getByLabel('Name (optional)').fill('Offers');
  await page.getByRole('button', { name: 'Add page' }).click();
  const list = page.getByRole('list', { name: 'Watched pages' });
  await expect(list).toContainText('Offers');
  expect(w.calls).toContain('POST /research/targets');
  await list.getByRole('button', { name: /Pause/ }).click();
  await expect(list.getByRole('button', { name: /Resume/ })).toBeVisible();
  await expect(list.locator('[data-status="paused"]')).toBeVisible();
  await expect(page.getByRole('link', { name: /Ad library/ })).toHaveAttribute('href', /facebook\.com/);
});

test('the baseline run waits for a cost confirmation', async ({ page }) => {
  const w = await stub(page, { runs: [], observations: [] });
  await page.goto(`/app/b/${B}/research`);
  await page.getByRole('button', { name: 'Start the baseline' }).click();
  const confirm = page.getByRole('region', { name: 'Confirm the cost' });
  await expect(confirm).toContainText('NPR 40');
  expect(w.calls).not.toContain('POST /research/runs/run-2/confirm');
  await confirm.getByRole('button', { name: 'Confirm and start' }).click();
  await expect(confirm).toBeHidden();
  expect(w.calls).toContain('POST /research/runs/run-2/confirm');
});

test('accept an opportunity', async ({ page }) => {
  const w = await stub(page);
  await page.goto(`/app/b/${B}/research/opportunities`);
  const o = page.getByRole('article', { name: 'Answer the shawl price cut' });
  await expect(o).toContainText('Pashmina shawl price cut');
  await o.getByRole('button', { name: /Accept/ }).click();
  await expect(page.locator('[data-state="empty"]')).toContainText('No new opportunities');
  expect(w.calls).toContain('POST /research/opportunities/op-1/accept');
  await page.getByRole('button', { name: 'Accepted' }).click();
  await expect(page.getByRole('article', { name: 'Answer the shawl price cut' })).toBeVisible();
});

test('a battlecard lists what was left out, and the draft can be approved', async ({ page }) => {
  const w = await stub(page);
  await page.goto(`/app/b/${B}/research/competitors/${C}`);
  await page.getByRole('button', { name: 'Generate a draft' }).click();
  const draft = page.getByRole('article', { name: /version 2, draft/ });
  await expect(draft).toContainText('Hand-woven in Patan');
  await expect(draft.getByRole('list', { name: 'Left out' })).toContainText('Ours is the softest shawl in Nepal — no approved fact');
  await draft.getByRole('button', { name: 'Approve this version' }).click();
  await expect(page.getByRole('article', { name: /version 2, approved/ })).toBeVisible();
  expect(w.calls).toContain(`POST /research/competitors/${C}/battlecard/approve`);
});

test('the overview works by keyboard alone', async ({ page }) => {
  const w = await stub(page);
  await page.goto(`/app/b/${B}/research`);
  await expect(page.getByRole('button', { name: 'Run now' })).toBeVisible();
  await tabTo(page, page.getByRole('button', { name: 'Run now' }));
  await page.keyboard.press('Enter');
  await expect.poll(() => w.calls).toContain('POST /research/runs');
  await tabTo(page, page.getByRole('checkbox', { name: 'Run every week' }));
  await page.keyboard.press('Space');
  await tabTo(page, page.getByRole('button', { name: 'Save schedule' }));
  await page.keyboard.press('Enter');
  await expect.poll(() => w.calls).toContain('PUT /research/schedule');
  await page.getByRole('heading', { name: 'Competitors' }).scrollIntoViewIfNeeded();
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await tabTo(page, page.getByRole('list').getByRole('link', { name: /Rival Shawls/ }).last());
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/research/competitors/${C}$`));
});

test('shows the error state when the API fails', async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === `/api/brands/${B}` || p === '/api/brands') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(p === '/api/brands' ? [brand] : brand) });
    return route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' });
  });
  await page.goto(`/app/b/${B}/research`);
  const state = page.locator('[data-state="error"]');
  await expect(state).toBeVisible({ timeout: 15_000 });
  await expect(state).toContainText('could not be loaded');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});
