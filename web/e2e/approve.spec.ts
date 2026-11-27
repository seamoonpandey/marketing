import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { queueAi, resetAi } from './helpers';

const FIXTURES = '../server/test/fixtures/studio/render';
const SHOTS = process.env.SHOTS_DIR;

test.describe('approve, real API and mock model', () => {
  test.beforeEach(async () => { await resetAi(); });

  test('three ready drafts are approved, edited, withdrawn, bulk-approved and paused', async ({ page, request }) => {
    test.setTimeout(300_000);
    const api = async (method: 'post' | 'put', path: string, data?: object) => {
      const res = await request[method](path, data ? { data } : {});
      expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
      return res.json();
    };
    const brand = await api('post', '/api/brands', { name: `Approve ${Date.now()}`, defaultLanguage: 'en', languages: ['en'] });
    const b = `/api/brands/${brand.id}`;
    const shawl = await api('post', `${b}/knowledge/subjects`, { type: 'product', name: 'Pashmina shawl' });
    const price = await api('post', `${b}/knowledge/facts`, { section: 'products', subjectId: shawl.id, field: 'price', value: 4000, unit: 'NPR', language: 'en' });
    await api('put', `${b}/knowledge/palette`, { colours: [{ hex: '#0f5257', role: 'primary' }, { hex: '#141414', role: 'text' }, { hex: '#f5efe5', role: 'background' }, { hex: '#c6a46a', role: 'accent' }] });
    const bytes = readFileSync(`${FIXTURES}/logo-wide.png`);
    const { source, uploadUrl } = await api('post', `${b}/sources/uploads`, { filename: 'logo-wide.png', mime: 'image/png', bytes: bytes.length });
    expect((await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: bytes })).ok).toBe(true);
    await api('post', `${b}/sources/${source.id}/complete`);
    await api('post', `${b}/knowledge/assets`, { sourceId: source.id, kind: 'logo', rights: { licence: 'Own artwork, all uses' } });

    // One week, one channel: three image posts on three days.
    await api('put', `${b}/plan/settings`, { channels: [{ channel: 'instagram', postsPerWeek: 7 }], pillars: [], weekStarts: 0 });
    const { weekStart } = (await (await request.get(`${b}/plan/overview`)).json()).weeks[0] as { weekStart: string };
    const day = (n: number) => new Date(Date.parse(`${weekStart}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    for (const [n, idea] of [[0, 'Winter warmth'], [1, 'Morning chill'], [2, 'Shawl of the week']] as const)
      await api('post', `${b}/plan/weeks/${weekStart}/items`, { day: day(n), channel: 'instagram', format: 'image', pillar: 'product', funnel: 'product_aware', intent: 'persuade', idea, cta: 'Visit the shop', factIds: [price.id] });
    const { plan } = (await (await request.get(`${b}/plan/weeks/${weekStart}`)).json()) as { plan: { version: number } };
    await api('post', `${b}/plan/weeks/${weekStart}/approve`, { version: plan.version });

    const planned = (await (await request.get(`${b}/studio/overview?weekStart=${weekStart}`)).json()) as { items: { item: { id: string; day: string } }[] };
    const ids = planned.items.map((i) => i.item.id);
    expect(planned.items.map((i) => i.item.day)).toEqual([day(0), day(1), day(2)]);

    const LOW_A = 'Warm for the whole winter.';
    const LOW_B = 'Soft wool for cold mornings.';
    const MEDIUM = 'Pashmina shawl from NPR 4,000.';
    const copy = (text: string, claim = false, factIds: string[] = []) => ({ copies: [{ language: 'en', sentences: [{ text, claim, factIds }], hashtags: ['pashmina'], cta: 'Visit the shop' }] });
    await queueAi(
      { ...copy(LOW_A), slides: [{ headline: 'Warm winter shawls' }] },
      { ...copy(LOW_B), slides: [{ headline: 'Cold mornings' }] },
      { ...copy(MEDIUM, true, [price.id]), slides: [{ headline: 'Shawl of the week' }] },
    );
    const run = await api('post', `${b}/studio/drafts`, { planItemIds: ids });
    await expect.poll(async () => (await (await request.get(`${b}/studio/runs/${run.id}`)).json()).state, { timeout: 60_000 }).toBe('completed');

    const overview = (await (await request.get(`${b}/studio/overview?weekStart=${weekStart}`)).json()) as { items: { item: { id: string }; draft: { id: string } }[] };
    const draftIds = ids.map((id) => overview.items.find((i) => i.item.id === id)!.draft.id);
    const readyViaApi = async (draftId: string) => {
      const r = await api('post', `${b}/studio/drafts/${draftId}/render`);
      await expect.poll(async () => (await (await request.get(`${b}/studio/runs/${r.id}`)).json()).state, { timeout: 60_000 }).toBe('completed');
      await api('post', `${b}/studio/drafts/${draftId}/ready`);
    };
    for (const d of draftIds) await readyViaApi(d);
    const [A, B, C] = draftIds as [string, string, string];

    // An edit in the Studio screens saves a new version; finishing renders it and marks it ready.
    const studioEdit = async (draftId: string, headline: string) => {
      await page.goto(`/app/b/${brand.id}/studio/drafts/${draftId}`);
      await page.getByRole('textbox', { name: 'Headline', exact: true }).fill(headline);
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText(/^Version \d+, written by you/)).toBeVisible();
    };
    const studioFinish = async () => {
      await page.getByRole('button', { name: /^Render/ }).click();
      await expect(page.getByRole('region', { name: 'Rendered previews' }).getByRole('img')).toHaveCount(1, { timeout: 60_000 });
      await page.getByRole('button', { name: 'Mark ready' }).click();
      await expect(page.getByText(/^Ready as version/)).toBeVisible();
    };
    const row = (text: string) => page.getByRole('article').filter({ hasText: text });
    const approvePage = (draftId: string) => page.goto(`/app/b/${brand.id}/approve/${draftId}`);

    // The queue: all three waiting, soonest first.
    await page.goto(`/app/b/${brand.id}/approve`);
    await expect(page.locator('[data-approve-state="waiting"]')).toHaveCount(3);
    await expect(page.getByRole('article').getByRole('link')).toHaveText([LOW_A, LOW_B, MEDIUM]);
    await expect(row(MEDIUM)).toContainText('Medium risk');
    await expect(row(LOW_A)).toContainText('Low risk');
    await expect(page.locator('main img[alt^="Preview of"]').first()).toBeVisible();
    await expect.poll(() => page.locator('main img[alt^="Preview of"]').evaluateAll((els) => (els as HTMLImageElement[]).map((e) => e.complete && e.naturalWidth > 0))).toEqual([true, true, true]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/queue.png`, fullPage: true });

    // Open one: the exact copy and the rendered image, then approve it.
    await page.getByRole('link', { name: LOW_A }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Approve version 1' })).toBeVisible();
    const exact = page.getByRole('region', { name: 'Exactly as it will appear' });
    await expect(exact).toContainText(LOW_A);
    await expect(exact).toContainText('Visit the shop');
    const img = exact.getByRole('img');
    await expect(img).toHaveCount(2); // the draft is rendered at 1:1 and 4:5, both shown at their own shape
    await expect.poll(() => img.evaluateAll((els) => (els as HTMLImageElement[]).map((e) => [e.naturalWidth, e.naturalHeight]))).toEqual([[1080, 1080], [1080, 1350]]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/preview.png`, fullPage: true });
    await page.getByRole('button', { name: 'Approve version 1' }).click();
    await expect(page.getByRole('heading', { name: 'You approved this version' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to the queue' }).click();
    await expect(row(LOW_A)).toContainText('Approved');

    // Edit it in Studio: the approval no longer counts, and the queue says so.
    await studioEdit(A, 'Warm winter shawls, hand-woven');
    await page.goto(`/app/b/${brand.id}/approve`);
    await expect(row(LOW_A).locator('[data-approve-state="invalid"]')).toBeVisible();
    await expect(row(LOW_A)).toContainText('The draft changed');
    // Marked ready again: the new version waits for a new decision.
    await page.goto(`/app/b/${brand.id}/studio/drafts/${A}`);
    await studioFinish();
    await page.goto(`/app/b/${brand.id}/approve`);
    await expect(row(LOW_A).locator('[data-approve-state="waiting"]')).toBeVisible();
    await page.getByRole('link', { name: LOW_A }).click();
    await page.getByRole('button', { name: 'Approve version 2' }).click();
    await expect(page.getByRole('heading', { name: 'You approved this version' })).toBeVisible();

    // Withdraw the approval with a reason.
    await page.getByRole('button', { name: 'Withdraw approval…' }).click();
    const withdraw = page.getByRole('button', { name: 'Withdraw approval', exact: true });
    await expect(withdraw).toBeDisabled();
    await page.getByLabel(/Why are you withdrawing it/).fill('Wrong season');
    await withdraw.click();
    await expect(page.getByRole('heading', { name: 'You rejected this version' })).toBeVisible();
    await expect(page.getByText('Reason: Wrong season')).toBeVisible();
    await page.goto(`/app/b/${brand.id}/approve`);
    await expect(row(LOW_A).locator('[data-approve-state="rejected"]')).toBeVisible();

    // Back to the owner with a new version, ready again.
    await studioEdit(A, 'Warm winter shawls, now in stock');
    await studioFinish();

    // Every item is opened first: a bulk approval only takes items whose exact version was previewed.
    await approvePage(A);
    await expect(page.getByRole('button', { name: 'Approve version 3' })).toBeVisible();
    await approvePage(B);
    await expect(page.getByRole('button', { name: 'Approve version 1' })).toBeVisible();
    await approvePage(C);
    await expect(page.getByRole('button', { name: 'Approve version 1' })).toBeVisible();

    // Bulk: the medium-risk item cannot join a low-risk selection.
    await page.goto(`/app/b/${brand.id}/approve`);
    await page.getByRole('checkbox', { name: new RegExp(LOW_A) }).check();
    await page.getByRole('checkbox', { name: new RegExp(MEDIUM) }).click({ force: true });
    await expect(page.getByText(/A bulk approval covers one risk level\. Your selection is low risk, this is medium risk\./)).toBeVisible();
    await expect(page.getByRole('checkbox', { name: new RegExp(MEDIUM) })).not.toBeChecked();
    await page.getByRole('checkbox', { name: new RegExp(LOW_A) }).uncheck();

    // The two low-risk items are approved together.
    await page.goto(`/app/b/${brand.id}/approve`);
    await page.getByRole('checkbox', { name: new RegExp(LOW_A) }).check();
    await page.getByRole('checkbox', { name: new RegExp(LOW_B) }).check();
    const bar = page.getByRole('region', { name: 'Bulk approval' });
    await expect(bar).toContainText('2 selected');
    await bar.getByRole('button', { name: 'Approve 2 selected' }).click();
    await expect(page.locator('[data-approve-state="approved"]')).toHaveCount(2);
    await expect(row(MEDIUM).locator('[data-approve-state="waiting"]')).toBeVisible();

    // Pause: approved items show as paused. Resume reverses it.
    await page.getByRole('button', { name: 'Pause approvals…' }).click();
    await page.getByLabel('Reason').fill('Checking the offer');
    await page.getByRole('button', { name: 'Pause approvals', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Approvals are paused' })).toBeVisible();
    await expect(page.locator('[data-approve-state="paused"]')).toHaveCount(2);
    await expect(page.locator('[data-approve-state="approved"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Resume approvals…' }).click();
    await page.getByLabel('Reason').fill('Offer checked');
    await page.getByRole('button', { name: 'Resume approvals', exact: true }).click();
    await expect(page.locator('[data-approve-state="approved"]')).toHaveCount(2);
  });
});
