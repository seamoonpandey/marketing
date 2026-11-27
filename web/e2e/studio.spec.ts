import { expect, test } from '@playwright/test';
import { queueAi, resetAi } from './helpers';

// Runs after the Studio server is merged: it needs the real routes and the mock model.
test.describe.skip('studio, real API and mock model', () => {
  test.beforeEach(async () => { await resetAi(); });

  test('draft an approved plan item, render it, fix the blocking finding, mark it ready', async ({ page, request }) => {
    test.setTimeout(180_000);
    const brand = await (await request.post('/api/brands', { data: { name: `Studio ${Date.now()}`, defaultLanguage: 'en', languages: ['en'] } })).json();
    const b = `/api/brands/${brand.id}`;
    const fact = await (await request.post(`${b}/knowledge/facts`, { data: { section: 'positioning', field: 'value_proposition', value: 'Hand-woven pashmina from Patan, priced from NPR 4,500.', language: 'en' } })).json();

    // One approved plan item: a carousel for Instagram.
    const { weekStart } = await (await request.get(`${b}/plan/overview`)).json();
    await request.post(`${b}/plan/weeks/${weekStart}/items`, { data: { day: weekStart, channel: 'instagram', format: 'carousel', pillar: 'product', funnel: 'product_aware', intent: 'persuade', idea: 'Winter shawls', cta: 'Visit the shop', factIds: [fact.id] } });
    await request.post(`${b}/plan/weeks/${weekStart}/approve`);

    // The mock model writes one claim that cites the fact, one that cites nothing, and a number no fact holds.
    await queueAi({
      languages: [{ language: 'en', sentences: [
        { text: 'Hand-woven in Patan.', claim: true, factIds: [fact.id] },
        { text: 'The lowest price in Kathmandu.', claim: true, factIds: [] },
        { text: 'Save 15% this week.', claim: false, factIds: [] },
      ], hashtags: ['pashmina'], cta: 'Visit the shop' }],
      slides: [{ headline: 'Winter warmth' }, { headline: 'Hand-woven in Patan' }],
    });

    await page.goto(`/app/b/${brand.id}/studio?week=${weekStart}`);
    await expect(page.getByRole('article', { name: 'Instagram carousel' })).toContainText('Winter shawls');
    await page.getByRole('button', { name: /^Draft all/ }).click();
    const confirm = page.getByRole('region', { name: 'Confirm the cost' });
    await expect(confirm).toContainText('NPR');
    await confirm.getByRole('button', { name: 'Confirm and start' }).click();
    await expect(page.getByText('1 drafted.')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('link', { name: /Open draft/ }).click();

    // The left-out claim and the invented number are visible, and Ready is refused.
    await expect(page.getByText('The lowest price in Kathmandu.')).toBeVisible();
    await expect(page.getByText('Number not in a cited fact')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark ready' })).toBeDisabled();

    // Remove the number, save, render (NPR 0), and the draft can be marked ready.
    await page.getByLabel('Sentence 3 in English').fill('Warm for the whole winter.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Version 2, written by you')).toBeVisible();
    await page.getByRole('button', { name: /^Render/ }).click();
    await expect(page.getByRole('region', { name: 'Rendered previews' }).getByRole('img').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Mark ready' }).click();
    await expect(page.getByText('Ready as version 2')).toBeVisible();
  });
});
