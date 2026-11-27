import { expect, test } from '@playwright/test';

test('create a brand, find it in the list, and see it as the active brand on both module pages', async ({ page }) => {
  const name = `Himal Pashmina ${Date.now()}`;
  await page.goto('/app/brands');
  await expect(page.getByRole('heading', { level: 1, name: 'Brands' })).toBeVisible();

  await page.getByRole('link', { name: 'New brand' }).first().click();
  await page.getByLabel('Brand name').fill(name);
  await page.getByLabel(/Website/).fill('himalpashmina.example');
  await page.getByRole('button', { name: 'Add brand' }).click();
  await expect(page).toHaveURL(/\/app\/b\/[0-9a-f-]{36}\/brand$/);

  await page.goto('/app/brands');
  const row = page.getByRole('list', { name: 'Brands' }).getByRole('link', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await row.click();

  await expect(page).toHaveURL(/\/brand$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Brand' })).toBeVisible();
  await expect(page.getByTestId('active-brand')).toHaveText(name);

  await page.getByRole('navigation', { name: 'Product' }).getByRole('link', { name: 'Research' }).click();
  await expect(page).toHaveURL(/\/research$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Research' })).toBeVisible();
  await expect(page.getByTestId('active-brand')).toHaveText(name);
});

test('shows the error state, not a blank page, when the API is down', async ({ page }) => {
  // What the browser gets from the /api proxy when the API process is stopped.
  await page.route('**/api/**', (route) => route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' }));
  await page.goto('/app/brands');
  const state = page.locator('[data-state="error"]');
  await expect(state).toBeVisible({ timeout: 15_000 });
  await expect(state).toContainText('The brands could not be loaded');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});
