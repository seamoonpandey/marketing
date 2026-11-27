import { expect, test } from '@playwright/test';
import { aiCalls, clearPages, fixtureUrl, queueAi, resetAi, setPage } from './helpers';

const html = (price: string) =>
  `<html><head><title>Rival</title></head><body><h1>Shawl prices</h1><p>Classic pashmina shawl costs ${price} rupees</p><p>Free delivery inside Kathmandu valley</p></body></html>`;
const OFFER = '<html><head><title>Offers</title></head><body><h1>Offers</h1><p>Dashain discount of ten percent on all scarves</p></body></html>';

test.beforeEach(async () => { await resetAi(); await clearPages(); });

test('add a competitor, watch two pages, confirm the baseline, see the price change, accept an opportunity, approve a battlecard', async ({ page, request }) => {
  const brand = await (await request.post('/api/brands', { data: { name: `Research ${Date.now()}`, website: 'https://fixtures.example', defaultLanguage: 'en', languages: ['en'] } })).json();
  const b = `/api/brands/${brand.id}`;
  const comp = await (await request.post(`${b}/competitors`, { data: { name: 'Fixture Rival', site: fixtureUrl('/rival') } })).json();
  await setPage('/rival/pricing', html('5,000'));
  await setPage('/rival/offers', OFFER);

  // Watch both pages from the competitor screen.
  await page.goto(`/app/b/${brand.id}/research/competitors/${comp.id}`);
  for (const [path, name] of [['pricing', 'Pricing'], ['offers', 'Offers']]) {
    await page.getByLabel('Page address').fill(fixtureUrl(`/rival/${path}`));
    await page.getByLabel('Name (optional)').fill(name);
    await page.getByRole('button', { name: 'Add page' }).click();
    await expect(page.getByRole('list', { name: 'Watched pages' })).toContainText(name);
  }

  // Baseline: one profile answer per page, in the order the pages were added.
  await queueAi(
    { entries: [{ kind: 'product', text: 'Classic pashmina shawl', price: 'NPR 5,000', quote: 'Classic pashmina shawl costs 5,000 rupees' }] },
    { entries: [{ kind: 'offer', text: 'Dashain discount', price: null, quote: 'Dashain discount of ten percent on all scarves' }] },
  );
  await page.goto(`/app/b/${brand.id}/research`);
  await page.getByRole('button', { name: 'Start the baseline' }).click();
  await page.getByRole('button', { name: 'Confirm and start' }).click();
  await expect(page.getByText(/2 pages read: 2 changed, 0 unchanged/)).toBeVisible({ timeout: 60_000 });
  expect(await aiCalls()).toBe(2);

  // A run over unchanged pages costs no model call.
  await page.getByRole('button', { name: 'Run now' }).click();
  await expect(page.getByText(/2 pages read: 0 changed, 2 unchanged/)).toBeVisible({ timeout: 60_000 });
  expect(await aiCalls()).toBe(2);

  // The price changes. Opportunities must cite real observation ids, which exist only after the
  // observation is saved, so the opportunity answer is queued after that and the run is retried.
  await setPage('/rival/pricing', html('4,200'));
  await queueAi({ observations: [{ type: 'price_change', summary: 'Classic shawl price cut from 5,000 to 4,200 rupees', before: { quote: 'Classic pashmina shawl costs 5,000 rupees' }, after: { quote: 'Classic pashmina shawl costs 4,200 rupees' }, confidence: 'high' }] });
  await page.getByRole('button', { name: 'Run now' }).click();
  await expect.poll(async () => (await (await request.get(`${b}/research/observations`)).json()).length, { timeout: 60_000 }).toBe(1);
  const [obs] = await (await request.get(`${b}/research/observations`)).json();
  await queueAi({ opportunities: [{ title: 'Answer the shawl price cut', hypothesis: 'The rival cut its price to win price-led buyers.', suggestedAction: 'Lead with hand-woven quality.', whyItMatters: 'Price is compared first.', observationIds: [obs.id], confidence: 'medium' }] });
  await page.getByRole('button', { name: /Retry/ }).click({ timeout: 60_000 });

  const card = page.getByRole('article', { name: /Price change/ });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText('“Classic pashmina shawl costs 5,000 rupees”')).toBeVisible();
  await expect(card.getByText('“Classic pashmina shawl costs 4,200 rupees”')).toBeVisible();

  await page.goto(`/app/b/${brand.id}/research/opportunities`);
  await page.getByRole('button', { name: /Accept/ }).first().click();
  await expect(page.getByText('Answer the shawl price cut')).toBeHidden();

  // Battlecard: the objection is backed by a profile quote; the model's other statements cite no approved fact.
  await queueAi({
    differ: [{ text: 'Ours is hand-woven' }], proof: [], responses: [],
    objections: [{ text: 'The rival is cheaper', profileQuote: 'Classic pashmina shawl costs 5,000 rupees' }],
  });
  await page.goto(`/app/b/${brand.id}/research/competitors/${comp.id}`);
  await page.getByRole('button', { name: 'Generate a draft' }).click();
  await expect(page.getByText('The rival is cheaper')).toBeVisible();
  await page.getByRole('button', { name: 'Approve this version' }).click();
  await expect(page.getByRole('article', { name: /approved/ })).toBeVisible();
});
