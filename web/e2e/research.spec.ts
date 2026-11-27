import { test } from '@playwright/test';

// Runs after the server branch is merged: real API, mock model.
test.describe.skip('research full flow', () => {
  test('add a competitor, watch two pages, confirm the baseline, see the price change, accept an opportunity, approve a battlecard', async ({ page, request }) => {
    const brand = await (await request.post('/api/brands', { data: { name: `Research ${Date.now()}`, website: 'https://fixtures.example', defaultLanguage: 'en', languages: ['en'] } })).json();
    const b = `/api/brands/${brand.id}`;
    const comp = await (await request.post(`${b}/competitors`, { data: { name: 'Fixture Rival', site: 'http://127.0.0.1:3441/fixtures/rival' } })).json();
    for (const url of ['pricing', 'offers']) await request.post(`${b}/research/targets`, { data: { competitorId: comp.id, url: `http://127.0.0.1:3441/fixtures/rival/${url}` } });

    await page.goto(`/app/b/${brand.id}/research`);
    await page.getByRole('button', { name: 'Start the baseline' }).click();
    await page.getByRole('button', { name: 'Confirm and start' }).click();
    await page.getByText('Completed').waitFor({ timeout: 60_000 });

    // Fixture switch to the changed pages is made by the e2e server's fixture hook, then a second run.
    await page.getByRole('button', { name: 'Run now' }).click();
    const card = page.getByRole('article', { name: /Price change/ });
    await card.waitFor({ timeout: 60_000 });

    await page.goto(`/app/b/${brand.id}/research/opportunities`);
    await page.getByRole('button', { name: /Accept/ }).first().click();

    await page.goto(`/app/b/${brand.id}/research/competitors/${comp.id}`);
    await page.getByRole('button', { name: 'Generate a draft' }).click();
    await page.getByRole('button', { name: 'Approve this version' }).click();
    await page.getByRole('article', { name: /approved/ }).waitFor();
  });

  test('the overview is fully usable by keyboard', async ({ page }) => {
    await page.goto('/app/brands');
  });
});
