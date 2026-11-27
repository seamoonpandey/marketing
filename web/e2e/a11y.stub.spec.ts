import { expect, test } from '@playwright/test';

// Long Devanagari names are shown whole in the shell and the page header: wrapped, never cut with an ellipsis.
const B = 'brand-1';
const NOW = '2026-11-27T06:00:00.000Z';
const NAME = 'हिमालयन पश्मिना हस्तकला तथा परम्परागत बुनाई उद्योग प्राइभेट लिमिटेड';
const brand = { id: B, name: NAME, slug: 'himal', website: null, country: 'NP', timezone: 'Asia/Kathmandu', currency: 'NPR', defaultLanguage: 'ne', languages: ['ne'], status: 'active', createdAt: NOW };

test('a long Devanagari brand name is not truncated in the switcher, and the Approve tabs are keyboard reachable', async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/brands') return send([brand]);
    if (path === `/api/brands/${B}`) return send(brand);
    if (path === `/api/brands/${B}/approve/queue`) {
      return send({ summary: { counts: { waiting: 0, approved: 0, rejected: 0, invalid: 0, expired: 0, paused: 0 }, paused: false, pausedReason: null, pausedAt: null, monthDecisions: 0 }, items: [] });
    }
    return send({ error: { code: 'not_stubbed', message: path } }, 404);
  });
  await page.goto(`/app/b/${B}/approve`);
  const name = page.getByTestId('active-brand');
  await expect(name).toHaveText(NAME);
  const cut = await name.evaluate((el) => ({ over: el.scrollWidth > el.clientWidth, ellipsis: getComputedStyle(el).textOverflow === 'ellipsis' }));
  expect(cut).toEqual({ over: false, ellipsis: false });
  const tabs = page.getByRole('navigation', { name: 'Approve' });
  await expect(tabs.getByRole('link', { name: 'Queue' })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: 'Settings' }).focus();
  await expect(tabs.getByRole('link', { name: 'Settings' })).toBeFocused();
});
