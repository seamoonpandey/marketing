import { expect, test } from '@playwright/test';
import { aiCalls, clearPages, fixtureUrl, queueAi, resetAi, resetSearch, setPage, setSearch } from './helpers';

const html = (price: string) =>
  `<html><head><title>Rival</title></head><body><h1>Shawl prices</h1><p>Classic pashmina shawl costs ${price} rupees</p><p>Free delivery inside Kathmandu valley</p></body></html>`;
const OFFER = '<html><head><title>Offers</title></head><body><h1>Offers</h1><p>Dashain discount of ten percent on all scarves</p></body></html>';

test.beforeEach(async () => { await resetAi(); await resetSearch(); await clearPages(); });

test('add a competitor, watch two pages, confirm the baseline, see the price change, accept an opportunity, approve a battlecard', async ({ page, request }) => {
  test.setTimeout(120_000);
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

  // The price changes. The run reads the change, then stops at the opportunity call, which has no answer queued. The
  // answer is queued only once the run has failed, so the retry is what makes that call, and it repeats none before it.
  await setPage('/rival/pricing', html('4,200'));
  await queueAi({ observations: [{ type: 'price_change', summary: 'Classic shawl price cut from 5,000 to 4,200 rupees', before: { quote: 'Classic pashmina shawl costs 5,000 rupees' }, after: { quote: 'Classic pashmina shawl costs 4,200 rupees' }, confidence: 'high' }] });
  await page.getByRole('button', { name: 'Run now' }).click();
  const retry = page.getByRole('button', { name: /Retry/ });
  await expect(retry).toBeVisible({ timeout: 60_000 });
  expect(await aiCalls()).toBe(4);
  await queueAi({ opportunities: [{ title: 'Answer the shawl price cut', hypothesis: 'The rival cut its price to win price-led buyers.', suggestedAction: 'Lead with hand-woven quality.', whyItMatters: 'Price is compared first.', kind: 'change', evidence: ['e1'], impact: 'medium', effort: 'medium', confidence: 'medium' }] });
  await retry.click();
  await expect(page.getByText(/2 pages read: 1 changed, 1 unchanged/)).toBeVisible({ timeout: 60_000 });
  expect(await aiCalls()).toBe(5);

  const card = page.getByRole('article', { name: /Price change/ });
  await expect(card).toBeVisible();
  await expect(card.getByText('“Classic pashmina shawl costs 5,000 rupees”')).toBeVisible();
  await expect(card.getByText('“Classic pashmina shawl costs 4,200 rupees”')).toBeVisible();

  // Inside its card: "Accept" alone would match the Accepted filter first.
  await page.goto(`/app/b/${brand.id}/research/opportunities`);
  const opportunity = page.getByRole('article', { name: 'Answer the shawl price cut' });
  await opportunity.getByRole('button', { name: 'Accept' }).click();
  await expect(opportunity).toBeHidden();
  expect((await (await request.get(`${b}/research/opportunities?status=accepted`)).json()).map((o: { title: string }) => o.title)).toEqual(['Answer the shawl price cut']);

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
  expect(await aiCalls()).toBe(6);
});

const RIVAL_HOME = `<html><head><title>Shawl Rival</title></head><body><h1>Shawl Rival</h1><p>Hand-made pashmina shawls from Kathmandu</p><a href="/rival/pricing">Pricing</a></body></html>`;

test('from no competitors to a planned opportunity', async ({ page, request }) => {
  test.setTimeout(120_000);
  const brand = await (await request.post('/api/brands', { data: { name: `Discover ${Date.now()}`, website: 'https://fixtures.example', defaultLanguage: 'en', languages: ['en'] } })).json();
  const b = `/api/brands/${brand.id}`;
  const fact = await (await request.post(`${b}/knowledge/facts`, { data: { section: 'positioning', field: 'value_proposition', value: 'Hand-woven pashmina shawls from Patan', language: 'en' } })).json();
  const F = fact.id as string;

  // 1. Nothing watched yet: Research points to Find competitors.
  await page.goto(`/app/b/${brand.id}/research`);
  await page.getByRole('link', { name: 'Find competitors' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Find competitors' })).toBeVisible();

  // 2. Suggest keywords, edit one, search, see the estimate, confirm.
  await queueAi({ keywords: ['pashmina shawl Kathmandu', 'wool scarf Nepal'] });
  await page.getByRole('button', { name: 'Suggest keywords' }).click();
  const chips = page.getByRole('list', { name: 'Keywords' });
  await expect(chips).toContainText('wool scarf Nepal');
  await chips.getByRole('button', { name: 'Remove wool scarf Nepal' }).click();
  await page.getByLabel('Add a keyword').fill('pashmina Patan');
  await page.getByRole('button', { name: 'Add keyword' }).click();
  await expect(chips).toContainText('pashmina Patan');

  await setPage('/rival', RIVAL_HOME);
  await setPage('/rival/pricing', html('5,000'));
  await setSearch('web', 'pashmina shawl Kathmandu', [{ title: 'Shawl Rival', url: fixtureUrl('/rival'), snippet: 'Pashmina shawls made in Kathmandu', place: null }]);
  await setSearch('places', 'pashmina shawl Kathmandu', [{ title: 'Patan Wool House', url: null, snippet: 'Handwoven wool and pashmina shop in Patan', place: { address: 'Patan Durbar Square', category: 'Wool store', rating: 4.6, ratingCount: 80, phone: null, cid: '555' } }]);
  await queueAi(
    { businesses: [
      { name: 'Shawl Rival', site: fixtureUrl('/rival'), resultIds: ['r1'], socials: [], placeCid: null, rank: 1 },
      { name: 'Patan Wool House', site: null, resultIds: ['r2'], socials: [], placeCid: '555', rank: 2 },
    ] },
    { sells: { value: 'Pashmina shawls', basis: 'quoted', quote: 'Hand-made pashmina shawls from Kathmandu', sourceId: 'page' }, kind: { value: 'direct', basis: 'inferred', reason: 'It sells the same shawls.', evidence: [F, 'results'], confidence: 'high' }, overlap: { value: 'high', basis: 'inferred', reason: 'Same product, same city.', evidence: [F], confidence: 'high' } },
    { sells: { value: 'Wool and pashmina', basis: 'quoted', quote: 'Handwoven wool and pashmina shop in Patan', sourceId: 'results' }, kind: { value: 'indirect', basis: 'inferred', reason: 'A shop, not a maker.', evidence: [F, 'results'], confidence: 'medium' } },
    { sells: { value: 'Hand-woven shawls', factIds: [F] } },
  );
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const confirm = page.getByRole('region', { name: 'Confirm the cost' });
  await expect(confirm).toContainText('NPR');
  await confirm.getByRole('button', { name: 'Confirm and start' }).click();
  await expect(page.getByText(/Found 2 businesses, described 2/)).toBeVisible({ timeout: 60_000 });
  // One keyword call, one group call, one profile per business, one own row.
  expect(await aiCalls()).toBe(5);

  // 3. The table: the brand's row and two businesses; an inferred and a quoted cell open.
  const rows = page.getByRole('table', { name: 'Competitors found' }).locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('Your brand');
  await expect(rows.first()).toContainText('Hand-woven shawls');
  const rival = rows.filter({ hasText: 'Shawl Rival' });
  const wool = rows.filter({ hasText: 'Patan Wool House' });
  await expect(wool).toContainText('No website to watch');
  await rival.getByRole('button', { name: /^high/ }).first().click();
  await expect(page.locator('[popover]:popover-open')).toContainText('Same product, same city.');
  await page.keyboard.press('Escape');
  await rival.getByRole('button', { name: /^Pashmina shawls/ }).click();
  await expect(page.locator('[popover]:popover-open')).toContainText('Hand-made pashmina shawls from Kathmandu');
  await page.keyboard.press('Escape');

  // 4. Watch the one with a site; hide the other.
  await rival.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Watch selected' }).click();
  await expect(rival).toContainText('Watching');
  await wool.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Not a competitor' }).click();
  await expect(wool).toHaveCount(0);
  await expect(page.getByText('Hidden (1)')).toBeVisible();

  await page.goto(`/app/b/${brand.id}/research`);
  await expect(page.getByRole('heading', { name: 'Competitors' })).toBeVisible();
  await expect(page.getByText('Shawl Rival').first()).toBeVisible();
  await page.getByRole('link', { name: /Shawl Rival/ }).click();
  await expect(page.getByRole('list', { name: 'Watched pages' }).getByRole('listitem')).toHaveCount(2);
  await page.goBack();

  // 5. Baseline (one profile answer per watched page), then the price changes.
  await queueAi(
    { entries: [{ kind: 'product', text: 'Hand-made pashmina shawls', price: null, quote: 'Hand-made pashmina shawls from Kathmandu' }] },
    { entries: [{ kind: 'product', text: 'Classic pashmina shawl', price: 'NPR 5,000', quote: 'Classic pashmina shawl costs 5,000 rupees' }] },
  );
  await page.getByRole('button', { name: 'Start the baseline' }).click();
  await page.getByRole('button', { name: 'Confirm and start' }).click();
  await expect(page.getByText(/2 pages read: 2 changed, 0 unchanged/)).toBeVisible({ timeout: 60_000 });

  await setPage('/rival/pricing', html('4,200'));
  await queueAi(
    { observations: [{ type: 'price_change', summary: 'Classic shawl price cut from 5,000 to 4,200 rupees', before: { quote: 'Classic pashmina shawl costs 5,000 rupees' }, after: { quote: 'Classic pashmina shawl costs 4,200 rupees' }, confidence: 'high' }] },
    { opportunities: [{ kind: 'change', title: 'Answer the shawl price cut', hypothesis: 'The rival cut its price to win price-led buyers.', suggestedAction: 'Lead with hand-woven quality.', whyItMatters: 'Price is compared first.', evidence: ['e1'], impact: 'high', effort: 'low', confidence: 'medium' }] },
  );
  await page.getByRole('button', { name: 'Run now' }).click();
  const card = page.getByRole('article', { name: /Price change/ });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText('“Classic pashmina shawl costs 5,000 rupees”')).toBeVisible();
  await expect(card.getByText('“Classic pashmina shawl costs 4,200 rupees”')).toBeVisible();

  // 6. Opportunities: the change one is there; Find opportunities adds a gap citing the competitor.
  await page.goto(`/app/b/${brand.id}/research/opportunities`);
  await expect(page.getByRole('article', { name: 'Answer the shawl price cut' })).toContainText('Answer a change');
  await queueAi({ opportunities: [{ kind: 'gap', title: 'Offer a pashmina care guide', hypothesis: 'No rival explains shawl care.', suggestedAction: 'Publish a short care guide.', whyItMatters: 'Care questions come before buying.', evidence: ['e1'], impact: 'medium', effort: 'low', confidence: 'medium' }] });
  await page.getByRole('button', { name: 'Find opportunities' }).click();
  const gap = page.getByRole('article', { name: 'Offer a pashmina care guide' });
  await expect(gap).toContainText('Gap');
  await expect(gap).toContainText('Shawl Rival');
  await gap.getByRole('button', { name: 'Accept' }).click();
  await expect(gap).toBeHidden();
  // Since the discovery: two baseline profiles, the change, its opportunity, and the scan.
  expect(await aiCalls()).toBe(10);

  await page.goto(`/app/b/${brand.id}/plan`);
  await expect(page.getByRole('heading', { name: 'Offer a pashmina care guide' })).toBeVisible();
});
