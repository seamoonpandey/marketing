import { expect, test, type Page } from '@playwright/test';

// The Home screen against a stubbed API. Bodies follow server/openapi.json; the server is not needed.
const B = 'brand-1';
const NOW = '2026-11-28T04:00:00.000Z'; // 09:45 in Kathmandu
const money = (npr: string) => ({ npr, usd: (Number(npr) / 150).toFixed(4) });
const brand = { id: B, name: 'Himal Pashmina', slug: 'himal', website: null, country: 'NP', timezone: 'Asia/Kathmandu', currency: 'NPR', defaultLanguage: 'en', languages: ['en', 'ne'], status: 'active', createdAt: NOW };
const at = (path: string) => `/app/b/${B}${path}`;
const item = (o: object) => ({ count: null, due: null, ...o });

const modules = (status: Record<string, string | null> = {}) =>
  ['publish', 'approve', 'studio', 'plan', 'research', 'brand'].map((m) => ({
    module: m, href: at(`/${m}`), status: m in status ? status[m] : `${m} is fine`,
  }));
const costs = { month: '2026-11', total: money('244.20'), byModule: [{ module: 'brand', cost: money('66') }, { module: 'research', cost: money('0') }, { module: 'plan', cost: money('46.20') }, { module: 'studio', cost: money('132') }] };
const base = { brand: { id: B, name: brand.name, timezone: brand.timezone }, now: NOW, upcoming: [], partial: [], paused: null, modules: modules(), costs };

const busy = {
  ...base,
  items: [
    item({ kind: 'publish_manual', module: 'publish', urgency: 'now', title: '3 posts are ready to publish by hand', detail: 'Post it on the platform, then confirm it with its link.', count: 3, due: '2026-11-28T03:00:00.000Z', href: at('/publish') }),
    item({ kind: 'publish_stuck', module: 'publish', urgency: 'now', title: 'A post is blocked or failed', detail: 'It was not published; retry it, post it by hand or cancel it.', due: '2026-11-29T04:15:00.000Z', href: at('/publish/jobs/j-1') }),
    item({ kind: 'approvals_due', module: 'approve', urgency: 'today', title: '2 drafts are waiting for your approval', detail: 'They are planned for today or tomorrow and nothing goes out without your approval.', count: 2, due: '2026-11-27T18:15:00.000Z', href: at('/approve') }),
    item({ kind: 'run_confirm', module: 'plan', urgency: 'today', title: 'A run is waiting for your cost confirmation', detail: 'Nothing is spent until you accept the estimate.', href: at('/plan') }),
    item({ kind: 'plan_week_missing', module: 'plan', urgency: 'soon', title: 'Next week has no approved plan', detail: 'Studio writes posts only for approved plan items.', due: '2026-11-28T18:15:00.000Z', href: at('/plan/calendar?week=2026-11-29') }),
    item({ kind: 'facts_review', module: 'brand', urgency: 'soon', title: '4 facts are waiting for review', detail: 'Only approved facts reach a draft.', count: 4, href: at('/brand/review') }),
    item({ kind: 'opportunities_new', module: 'research', urgency: 'later', title: '2 opportunities are waiting for a decision', detail: 'Accept the ones worth a campaign and dismiss the rest.', count: 2, href: at('/research/opportunities') }),
    item({ kind: 'readiness_missing', module: 'brand', urgency: 'later', title: '9 readiness criteria are missing', detail: 'Readiness is 52 of 100; next: a logo.', count: 9, href: at('/brand/sources') }),
  ],
};

async function stub(page: Page, home: object) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/brands') return send([brand]);
    if (path === `/api/brands/${B}`) return send(brand);
    if (path === `/api/brands/${B}/home`) return send(home);
    return send({ error: { code: 'not_found', message: 'Not stubbed' } }, 404);
  });
}

test('a busy queue shows every urgency in order, the now items impossible to miss, with times in the brand zone', async ({ page }) => {
  await stub(page, busy);
  await page.goto(at(''));
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(page.getByText('Times are in Asia/Kathmandu.')).toBeVisible();
  // the order of rows is the ranked order
  await expect(page.locator('article[data-urgency]')).toHaveCount(8);
  expect(await page.locator('article[data-urgency]').evaluateAll((els) => els.map((e) => e.getAttribute('data-urgency')))).toEqual(['now', 'now', 'today', 'today', 'soon', 'soon', 'later', 'later']);
  expect(await page.locator('main h3').allTextContents()).toEqual(expect.arrayContaining(['Needs you now', 'Today', 'Coming up', 'When you have time']));
  const now = page.locator('article[data-urgency="now"]').first();
  await expect(now).toContainText('3 posts are ready to publish by hand');
  await expect(now).toContainText('Overdue: was due Sat 28 Nov, 08:45 (Asia/Kathmandu)');
  await expect(now.getByRole('link', { name: /Post and confirm/ })).toHaveAttribute('href', at('/publish'));
  // a day with no time of its own shows the date only
  await expect(page.locator('article[data-urgency="soon"]').first()).toContainText('Due Sun 29 Nov (Asia/Kathmandu)');
  // now outweighs later: the now card's title is larger and heavier
  const size = (l: ReturnType<Page['locator']>) => l.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(await size(now.locator('span.font-semibold').first())).toBeGreaterThan(await size(page.locator('article[data-urgency="later"] span.font-medium').first()));
  if (process.env.HOME_SHOT_DESKTOP) await page.screenshot({ path: process.env.HOME_SHOT_DESKTOP, fullPage: true });
  // below the queue: cost by module with the total, and the six modules
  await expect(page.getByRole('heading', { name: 'AI cost this month' })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="cost-h"]')).toContainText('NPR 244.20');
  await expect(page.locator('section[aria-labelledby="mods-h"] a')).toHaveCount(6);
  await expect(page.locator('section[aria-labelledby="mods-h"] a').first()).toHaveAttribute('href', at('/publish'));
});

test('with nothing to do it says so and shows what is scheduled next', async ({ page }) => {
  await stub(page, { ...base, items: [], upcoming: [{ title: 'Winter shawls are here', at: '2026-11-30T04:15:00.000Z', href: at('/publish/jobs/j-9') }] });
  await page.goto(at(''));
  await expect(page.locator('[data-state="empty"]')).toContainText('Nothing needs your attention');
  await expect(page.getByRole('heading', { name: 'Scheduled next' })).toBeVisible();
  const next = page.getByRole('link', { name: /Winter shawls are here/ });
  await expect(next).toContainText('Mon 30 Nov, 10:00 (Asia/Kathmandu)');
  await expect(next).toHaveAttribute('href', at('/publish/jobs/j-9'));
});

test('nothing scheduled and nothing to do points to Publish', async ({ page }) => {
  await stub(page, { ...base, items: [] });
  await page.goto(at(''));
  await expect(page.getByText('No posts are scheduled.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Publish' })).toHaveAttribute('href', at('/publish'));
});

test('a new brand sees its next setup step, with one action', async ({ page }) => {
  await stub(page, { ...base, modules: modules({ brand: 'No facts yet', plan: 'This week: no plan, Next week: no plan' }), items: [
    item({ kind: 'setup_import', module: 'brand', urgency: 'today', title: 'Add your brand\'s sources and import', detail: 'Prachaar writes only from facts you approve; the import reads your site and files and proposes them.', href: at('/brand/sources') }),
  ] });
  await page.goto(at(''));
  await expect(page.locator('article[data-urgency]')).toHaveCount(1);
  await expect(page.getByRole('link', { name: /Add sources/ })).toHaveAttribute('href', at('/brand/sources'));
  await expect(page.locator('section[aria-labelledby="mods-h"]')).toContainText('No facts yet');
});

test('a paused brand says so at the top with its reason and a link to Approve', async ({ page }) => {
  await stub(page, { ...busy, paused: { reason: 'Wrong price in the last post', at: NOW } });
  await page.goto(at(''));
  const banner = page.getByRole('alert').filter({ hasText: 'Approvals are paused' });
  await expect(banner).toContainText('Approvals are paused for Himal Pashmina');
  await expect(banner).toContainText('Wrong price in the last post');
  await expect(banner.getByRole('link', { name: 'Open Approve' })).toHaveAttribute('href', at('/approve'));
  // the banner comes before the queue
  expect(await page.evaluate(() => document.querySelector('[role="alert"]:not(#__next-route-announcer__)')!.compareDocumentPosition(document.querySelector('#queue-h')!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
});

test('a module that did not answer is named, and the rest still shows', async ({ page }) => {
  await stub(page, { ...busy, items: busy.items.filter((i) => (i as Record<string, unknown>).module !== 'approve'), partial: ['approve'], modules: modules({ approve: null }) });
  await page.goto(at(''));
  await expect(page.locator('[data-state="partial"]').first()).toContainText('Approve did not answer');
  await expect(page.locator('section[aria-labelledby="mods-h"]')).toContainText('Did not answer');
  await expect(page.locator('article[data-urgency]').first()).toBeVisible();
});

test('the costs not being readable does not hide the queue', async ({ page }) => {
  await stub(page, { ...busy, costs: null });
  await page.goto(at(''));
  await expect(page.getByText('The cost could not be read')).toBeVisible();
  await expect(page.locator('article[data-urgency]')).toHaveCount(8);
});

test('a failing server shows an error with a retry', async ({ page }) => {
  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p.endsWith('/home')) return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'The store is down' } }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(p.endsWith('/brands') ? [brand] : brand) });
  });
  await page.goto(at(''));
  await expect(page.getByRole('alert').filter({ hasText: 'The store is down' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('keyboard only: tab to the first action and press Enter to go there', async ({ page }) => {
  await stub(page, busy);
  await page.goto(at(''));
  const first = page.locator('article[data-urgency="now"]').first().getByRole('link', { name: /Post and confirm/ });
  await first.waitFor();
  for (let i = 0; i < 40 && !(await first.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForURL(`**${at('/publish')}`);
});

test('at 390 pixels nothing scrolls sideways, the now action fills the row and the modules sit in two columns', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await stub(page, { ...busy, paused: { reason: 'Wrong price in the last post', at: NOW } });
  await page.goto(at(''));
  await expect(page.locator('article[data-urgency]')).toHaveCount(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const button = page.locator('article[data-urgency="now"]').first().getByRole('link', { name: /Post and confirm/ });
  const [card, btn] = [await page.locator('article[data-urgency="now"]').first().boundingBox(), await button.boundingBox()];
  expect(btn!.width).toBeGreaterThan(card!.width * 0.7);
  expect(btn!.height).toBeGreaterThanOrEqual(36);
  const mods = await page.locator('section[aria-labelledby="mods-h"] li').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(new Set(mods).size).toBe(2);
  await page.screenshot({ path: process.env.HOME_SHOT_390, fullPage: true }).catch(() => {});
});
