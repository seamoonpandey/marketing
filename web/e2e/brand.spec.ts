import { expect, test } from '@playwright/test';
// Helpers that exist in ./helpers.ts after the server branch is merged (real API, mock model).
// @ts-ignore ./helpers.ts is created by the server branch
import { aiCalls, clearPages, fixtureUrl, queueAi, resetAi, setPage } from './helpers';

// Runs after the server branch is merged.
test.describe.skip('brand onboarding, real API and mock model', () => {
  const pageHtml = `<html><head><title>Shop</title></head><body><h1>Himalayan Pashmina Shawl</h1><p>Price: NPR 4,500</p></body></html>`;
  const fact = (p: Record<string, unknown>) => ({ section: 'products', subject: 'Himalayan Pashmina Shawl', field: 'price', value: 4500, unit: 'NPR', language: 'en', origin: 'stated', confidence: 0.9, ...p });

  test.beforeEach(async () => {
    await clearPages();
    await resetAi();
    await setPage('/shop', pageHtml);
    await setPage('/', `<html><body><a href="/shop">Shop</a></body></html>`);
  });

  test('import, approve, resolve the price conflict, assign roles and watch the score move', async ({ page }) => {
    const name = `Himal Pashmina ${Date.now()}`;
    await page.goto('/app/brands/new');
    await page.getByLabel('Brand name').fill(name);
    await page.getByLabel(/Website/).fill(fixtureUrl('/'));
    await page.getByRole('button', { name: 'Add brand' }).click();
    await expect(page).toHaveURL(/\/brand$/);
    await expect(page.getByLabel(/Score \d+ out of 100/)).toContainText('0');

    await page.getByRole('navigation', { name: 'Brand' }).getByRole('link', { name: 'Sources' }).click();
    await page.getByLabel('Choose files to upload').setInputFiles({
      name: 'price-list.txt', mimeType: 'text/plain', buffer: Buffer.from('Himalayan Pashmina Shawl\nPrice: NPR 5,000'),
    });
    await expect(page.getByRole('list', { name: 'Uploaded files' })).toContainText('price-list.txt');

    // Two answers for one price: the page says 4,500 and the file says 5,000.
    await queueAi({
      facts: [
        fact({ quote: 'Price: NPR 4,500' }),
        fact({ value: 5000, quote: 'Price: NPR 5,000' }),
      ],
    });
    await page.getByRole('button', { name: 'Start import' }).click();
    const confirm = page.getByRole('region', { name: 'Confirm the cost' });
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    await confirm.getByRole('button', { name: 'Confirm and start' }).click();
    await expect(page.getByRole('region', { name: 'Import result' })).toBeVisible({ timeout: 30_000 });
    expect(await aiCalls()).toBeGreaterThan(0);

    await page.getByRole('link', { name: /Review the facts/ }).click();
    await page.goto(page.url().replace(/review.*/, 'review?section=products'));
    await expect(page.locator('[data-conflict]')).toBeVisible();
    await page.getByRole('button', { name: /Keep NPR 4500/ }).click();
    await expect(page.locator('[data-conflict]')).toHaveCount(0);

    await page.getByRole('navigation', { name: 'Brand' }).getByRole('link', { name: 'Visual identity' }).click();
    await page.getByLabel(/^Add a colour/).fill('#24201d');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByLabel('Role of #24201d').selectOption('text');
    await page.getByLabel(/^Add a colour/).fill('#f5efe5');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByLabel('Role of #f5efe5').selectOption('background');
    await page.getByRole('button', { name: 'Save palette' }).click();
    await expect(page.getByRole('list', { name: 'Contrast pairs' })).toContainText(':1');

    await page.getByRole('navigation', { name: 'Brand' }).getByRole('link', { name: 'Brand book' }).click();
    const score = page.getByLabel(/Score \d+ out of 100/);
    await expect(score).not.toHaveText('0');
  });

  test('the review screen is usable by keyboard, with named actions', async ({ page }) => {
    await page.goto('/app/brands');
    await page.getByRole('list', { name: 'Brands' }).getByRole('link').first().click();
    await page.goto(page.url().replace(/brand.*/, 'brand/review?section=products'));
    const first = page.locator('[data-fact-row]').first();
    await first.focus();
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAccessibleName(/./);
    await page.keyboard.press('a');
  });
});
