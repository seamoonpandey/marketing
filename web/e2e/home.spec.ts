import { expect, test } from '@playwright/test';

// Full flow against the real API.
test('a new brand shows the setup path, and an approved fact moves it to the next step', async ({ page, request }) => {
  const created = await request.post('/api/brands', { data: { name: `Home ${Date.now()}`, website: 'https://fixtures.example', defaultLanguage: 'en', languages: ['en'] } });
  const id = (await created.json()).id as string;

  await page.goto(`/app/b/${id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  const rows = page.locator('article[data-urgency]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Add your brand\'s sources and import');
  await expect(rows.first().getByRole('link', { name: /Add sources/ })).toHaveAttribute('href', `/app/b/${id}/brand/sources`);
  await expect(page.locator('section[aria-labelledby="mods-h"] a')).toHaveCount(6);
  await expect(page.locator('section[aria-labelledby="cost-h"]')).toContainText('Total');

  // An approved fact entered through the Brand API: the first step is done, the next one appears.
  const fact = await request.post(`/api/brands/${id}/knowledge/facts`, { data: { section: 'positioning', field: 'value_proposition', value: 'Hand-woven in Patan', language: 'en' } });
  expect(fact.ok(), await fact.text()).toBe(true);
  await page.reload();
  await expect(page.getByText('Choose the channels you post on').first()).toBeVisible();
  await expect(rows.first()).toContainText('Choose the channels you post on');
  await expect(rows.first()).not.toContainText('sources and import');
  await expect(page.getByRole('link', { name: /Choose channels/ })).toHaveAttribute('href', `/app/b/${id}/plan/settings`);

  // Choosing channels moves it on again: the week needs a plan.
  await request.put(`/api/brands/${id}/plan/settings`, { data: { channels: [{ channel: 'facebook', postsPerWeek: 3 }], pillars: [], weekStarts: 0 } });
  await page.reload();
  await expect(page.getByText('Choose the channels you post on')).toHaveCount(0);
  await expect(page.getByText(/have no approved plan/).first()).toBeVisible();
  await page.getByRole('link', { name: /Plan the week/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/b/${id}/plan/calendar`));
});
