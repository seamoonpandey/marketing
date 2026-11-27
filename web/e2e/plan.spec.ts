import { expect, test } from '@playwright/test';
import { aiCalls, queueAi, resetAi } from './helpers';

// Full flow against the real API and the mock model. It runs after the server is merged.
test.describe.skip('plan full flow', () => {
  test.beforeEach(async () => { await resetAi(); });

  test('choose channels, draft a week from approved facts, fix a blocker, approve it, then edit it back to draft', async ({ page, request }) => {
    const brand = await (await request.post('/api/brands', { data: { name: `Plan ${Date.now()}`, website: 'https://fixtures.example', defaultLanguage: 'en', languages: ['en'] } })).json();
    const b = `/app/b/${brand.id}/plan`;

    // Settings: two channels, three posts each.
    await page.goto(`${b}/settings`);
    await page.getByRole('checkbox', { name: 'Facebook' }).check();
    await page.getByRole('checkbox', { name: 'Instagram' }).check();
    await page.getByRole('checkbox', { name: 'Education' }).check();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status')).toContainText('Saved');

    // The week is drafted from the mock model's answer: Facebook twice on day 0 breaks a blocking rule.
    const item = (dayOffset: number, channel: string, idea: string) => ({ dayOffset, channel, format: 'image', pillar: 'education', funnel: 'problem_aware', intent: 'teach', idea, cta: 'Visit the shop', factIds: [] });
    await queueAi({ items: [item(0, 'facebook', 'Real or blended pashmina'), item(0, 'facebook', 'Three ways to wear a shawl'), item(1, 'facebook', 'Care for your shawl'), item(2, 'instagram', 'Behind the loom'), item(3, 'instagram', 'Meet the weavers'), item(5, 'instagram', 'Dashain gift ideas')] });
    await page.goto(`${b}/calendar`);
    await page.getByRole('button', { name: /^Draft/ }).click();
    await page.getByRole('button', { name: 'Confirm and start' }).click();
    await expect(page.getByRole('article', { name: /Instagram/ }).first()).toBeVisible({ timeout: 60_000 });
    expect(await aiCalls()).toBe(1);
    await expect(page.getByRole('button', { name: 'Approve week' })).toBeDisabled();

    // Move one Facebook item to another day; nothing blocks any more and the week can be approved.
    await page.getByRole('button', { name: /Edit the Facebook idea on Sunday/ }).first().click();
    await page.getByLabel('Day').selectOption({ index: 4 });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: 'Approve week' })).toBeEnabled();
    await page.getByRole('button', { name: 'Approve week' }).click();
    await expect(page.getByText(/Approved on/)).toBeVisible();

    // Editing an approved item puts the week back in draft.
    await page.getByRole('button', { name: /Edit the Instagram idea/ }).first().click();
    await page.getByLabel('Call to action').fill('Order today');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Approval withdrawn')).toBeVisible();
  });
});
