import { expect, test, type APIRequestContext } from '@playwright/test';
import { aiCalls, queueAi, resetAi } from './helpers';

// Full flow against the real API and the mock model.
test.describe('plan full flow', () => {
  test.beforeEach(async () => { await resetAi(); });

  const newBrand = async (request: APIRequestContext) =>
    (await (await request.post('/api/brands', { data: { name: `Plan ${Date.now()}`, website: 'https://fixtures.example', defaultLanguage: 'en', languages: ['en'] } })).json()).id as string;

  test('a brand with no approved fact is told to approve facts first, and no model is called', async ({ page, request }) => {
    const id = await newBrand(request);
    await request.put(`/api/brands/${id}/plan/settings`, { data: { channels: [{ channel: 'facebook', postsPerWeek: 3 }], pillars: [], weekStarts: 0 } });
    await page.goto(`/app/b/${id}/plan/calendar`);
    await expect(page.locator('[data-state="empty"]')).toContainText('No approved brand facts yet');
    await expect(page.getByRole('link', { name: 'Review the brand' })).toHaveAttribute('href', `/app/b/${id}/brand`);
    const res = await request.post(`/api/brands/${id}/plan/weeks/${(await (await request.get(`/api/brands/${id}/plan/overview`)).json()).weeks[0].weekStart}/draft`);
    expect(res.status()).toBe(400);
    expect(await aiCalls()).toBe(0);
  });

  test('brief with a left-out claim, a week drafted from approved facts, approved, edited back to draft, approved again', async ({ page, request }) => {
    test.setTimeout(180_000);
    const id = await newBrand(request);
    const api = `/api/brands/${id}`;
    const post = async (path: string, data: object) => {
      const res = await request.post(`${api}${path}`, { data });
      expect(res.ok(), `${path}: ${await res.text()}`).toBe(true);
      return res.json();
    };
    const product = await post('/knowledge/subjects', { type: 'product', name: 'Pashmina shawl' });
    const segment = await post('/knowledge/subjects', { type: 'segment', name: 'Gift buyers' });
    const productName = await post('/knowledge/facts', { section: 'products', subjectId: product.id, field: 'name', value: 'Pashmina shawl', language: 'en' });
    const price = await post('/knowledge/facts', { section: 'products', subjectId: product.id, field: 'price', value: 4500, unit: 'NPR', language: 'en' });
    const audience = await post('/knowledge/facts', { section: 'audience', subjectId: segment.id, field: 'problem', value: 'Hard to find a gift that is truly hand-woven', language: 'en' });
    const value = await post('/knowledge/facts', { section: 'positioning', field: 'value_proposition', value: 'Hand-woven in Patan', language: 'en' });
    const factIds = [productName.id, price.id, audience.id, value.id] as string[];
    const b = `/app/b/${id}/plan`;

    // Settings: two channels, three posts each, two pillars.
    await page.goto(`${b}/settings`);
    await page.getByRole('checkbox', { name: 'Facebook' }).check();
    await page.getByRole('checkbox', { name: 'Instagram' }).check();
    await page.getByRole('checkbox', { name: 'Education' }).check();
    await page.getByRole('checkbox', { name: 'Proof' }).check();
    await page.getByLabel('First day of the week').selectOption('1');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status')).toContainText('Saved');

    // A campaign, then its brief: the estimate first, then the model's answer with one uncited offer statement.
    await page.goto(`${b}/campaigns`);
    await page.getByLabel('Name').fill('Dashain shawls');
    await page.getByLabel('Objective').selectOption('conversion');
    await page.getByRole('button', { name: 'Create campaign' }).click();
    await page.waitForURL(/campaigns\/[0-9a-f-]{36}/);
    await expect(page.locator('[data-state="empty"]')).toContainText('No brief yet');
    const st = (text: string, ids?: string[]) => ({ text, ...(ids ? { factIds: ids } : {}) });
    await queueAi({
      goal_kpi: [st('Sell 40 shawls')],
      audience: [st('Gift buyers who want something hand-woven', [audience.id])],
      offer_message: [st('Hand-woven in Patan', [value.id]), st('Shawl at NPR 4,500', [price.id]), st('Softest shawl in Nepal')],
    });
    await page.getByRole('button', { name: 'Draft the brief' }).click();
    const confirmBrief = page.getByRole('region', { name: 'Confirm the cost' });
    await expect(confirmBrief).toContainText('NPR');
    expect(await aiCalls()).toBe(0);
    await confirmBrief.getByRole('button', { name: 'Confirm and start' }).click();
    await expect(page.getByRole('heading', { name: 'Brief, version 1' })).toBeVisible({ timeout: 60_000 });
    expect(await aiCalls()).toBe(1);
    await expect(page.getByRole('region', { name: 'Left out' })).toContainText('Softest shawl in Nepal');
    await expect(page.getByRole('region', { name: 'Offer and message' })).toContainText('Hand-woven in Patan');
    await expect(page.getByRole('region', { name: 'Offer and message' })).not.toContainText('Softest shawl');
    await page.getByRole('button', { name: 'Approve this brief' }).click();
    await expect(page.locator('[data-status="approved"]')).toBeVisible();

    // The dashboard drafts the week the calendar shows.
    const item = (dayOffset: number, channel: string, pillar: string, idea: string) => ({ dayOffset, channel, format: 'image', pillar, funnel: 'problem_aware', intent: 'teach', idea, cta: 'Visit the shop', factIds: [value.id] });
    await queueAi({ items: [
      item(0, 'facebook', 'education', 'Real or blended pashmina'), item(2, 'facebook', 'proof', 'Three ways to wear a shawl'), item(4, 'facebook', 'education', 'Care for your shawl'),
      item(1, 'instagram', 'proof', 'Behind the loom'), item(3, 'instagram', 'education', 'Meet the weavers'), item(5, 'instagram', 'proof', 'Dashain gift ideas'),
    ] });
    await page.goto(b);
    await page.getByRole('button', { name: 'Draft this week' }).click();
    const confirm = page.getByRole('region', { name: 'Confirm the cost' });
    await expect(confirm).toContainText('NPR');
    expect(await aiCalls()).toBe(1);
    await confirm.getByRole('button', { name: 'Confirm and start' }).click();
    await expect(page.getByText(/Last draft: 6 ideas/)).toBeVisible({ timeout: 60_000 });
    expect(await aiCalls()).toBe(2);

    const weekStart = (await (await request.get(`${api}/plan/overview`)).json()).weeks[0].weekStart as string;
    await page.goto(`${b}/calendar`);
    await expect(page.getByRole('article')).toHaveCount(6);
    await expect(page.getByRole('region', { name: 'Balance check' }).or(page.locator('section[aria-labelledby="viol-h"]'))).not.toContainText('Blocks approval');
    const view = await (await request.get(`${api}/plan/weeks/${weekStart}`)).json();
    expect(view.items).toHaveLength(6);
    expect(view.blockingCount).toBe(0);
    expect(factIds).toContain(view.items[0].factIds[0]);
    // The week starts on the settings' weekday (Monday), and it is the week the dashboard drafted.
    expect(new Date(`${weekStart}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(view.weekStart).toBe(weekStart);
    await expect(page.getByRole('region', { name: 'Days' }).getByRole('heading', { level: 3 }).first()).toHaveText('Monday');

    await page.getByRole('button', { name: 'Approve week' }).click();
    await expect(page.getByText(/Approved on/)).toBeVisible();

    await page.getByRole('button', { name: /Edit the Instagram idea/ }).first().click();
    await page.getByLabel('Call to action').fill('Order today');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Approval withdrawn')).toBeVisible();
    await page.getByRole('button', { name: 'Approve week' }).click();
    await expect(page.getByText(/Approved on/)).toBeVisible();
  });
});
