import { expect, test, type Page } from '@playwright/test';

// RunProgress polls a run every 3 seconds. These tests stub one run on the Studio dashboard and
// check that polling survives a failed poll and a tab that is not in front.
const B = 'brand-1';
const NOW = '2026-11-27T06:00:00.000Z';
const money = (npr: string) => ({ npr, usd: (Number(npr) / 150).toFixed(4) });
const brand = { id: B, name: 'Himal Pashmina', slug: 'himal', website: null, country: 'NP', timezone: 'Asia/Kathmandu', currency: 'NPR', defaultLanguage: 'en', languages: ['en'], status: 'active', createdAt: NOW };
const run = (state: string) => ({ id: 'run-1', kind: 'generate', targets: [], state, error: null, startedAt: NOW, finishedAt: null, estimate: money('12'), actual: null, counts: {}, createdAt: NOW });

/** `answer(n)` is what the run's n-th poll gets: a state, or 'fail' for a 500 with the API's error body. */
async function stubRun(page: Page, answer: (n: number) => string) {
  const polls = { count: 0 };
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/brands') return send([brand]);
    if (path === `/api/brands/${B}`) return send(brand);
    if (path === `/api/brands/${B}/studio/overview`) {
      return send({ weekStart: '2026-11-29', planApproved: true, ready: { facts: true }, latestRun: run('running'), monthCost: money('0'), items: [] });
    }
    if (path === `/api/brands/${B}/studio/runs/run-1`) {
      const a = answer(++polls.count);
      return a === 'fail' ? send({ error: { code: 'internal', message: 'The run broke.' } }, 500) : send(run(a));
    }
    return send({ error: { code: 'not_stubbed', message: path } }, 404);
  });
  return polls;
}

test('a failed poll does not end polling: the run still settles on screen', async ({ page }) => {
  // Poll 1 runs, polls 2 and 3 fail (a poll and its retry), poll 4 onwards the run has finished.
  const polls = await stubRun(page, (n) => (n === 1 ? 'running' : n <= 3 ? 'fail' : 'completed'));
  await page.goto(`/app/b/${B}/studio`);
  const region = page.getByRole('region', { name: 'Writing drafts' });
  await expect(region.getByText('Running')).toBeVisible();
  await expect(region.getByText('Completed')).toBeVisible({ timeout: 20_000 });
  expect(polls.count).toBeGreaterThanOrEqual(4);
});

test('a tab that is not in front keeps polling, so the run is settled when it comes back', async ({ page }) => {
  const polls = await stubRun(page, (n) => (n <= 2 ? 'running' : 'completed'));
  await page.goto(`/app/b/${B}/studio`);
  const region = page.getByRole('region', { name: 'Writing drafts' });
  await expect(region.getByText('Running')).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => polls.count, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(region.getByText('Completed')).toBeVisible({ timeout: 10_000 });
});
