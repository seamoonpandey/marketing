import { expect, test } from '@playwright/test';
import { aiCalls, clearPages, fixtureUrl, queueAi, resetAi, setPage } from './helpers';

// No base route fetches a page (sources has list, get and uploads only), so the fetch guard seam is
// proved by server/scripts/e2e-server.test.ts; here the control server and the API are proved to be up together.
test('fixture pages and the AI queue are reachable beside a real API', async ({ request }) => {
  const brand = await request.post('/api/brands', { data: { name: `Harness ${Date.now()}`, website: 'https://harness.example' } });
  expect(brand.ok()).toBeTruthy();
  const { id } = await brand.json();
  expect((await request.get(`/api/brands/${id}/sources`)).ok()).toBeTruthy();

  await setPage('/about', '<title>About</title>');
  const page = await request.get(fixtureUrl('/about'));
  expect(page.headers()['content-type']).toContain('text/html');
  expect(await page.text()).toContain('About');
  expect((await request.get(fixtureUrl('/robots.txt'))).ok()).toBeTruthy();
  await clearPages();
  expect((await request.get(fixtureUrl('/about'))).status()).toBe(404);

  await resetAi();
  await queueAi({ a: 1 }, { b: 2 });
  expect(await aiCalls()).toBe(0);
  await resetAi();
});
