import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { queueAi, resetAi } from './helpers';

const FIXTURES = '../server/test/fixtures/studio/render';
const SHOTS = process.env.SHOTS_DIR;

test.describe('studio, real API and mock model', () => {
  test.beforeEach(async () => { await resetAi(); });

  test('draft three approved plan items, render, fix the blocking findings, mark ready, edit back to draft', async ({ page, request }) => {
    test.setTimeout(240_000);
    const api = async (method: 'post' | 'put', path: string, data?: object) => {
      const res = await request[method](path, data ? { data } : {});
      expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
      return res.json();
    };
    const brand = await api('post', '/api/brands', { name: `Studio ${Date.now()}`, defaultLanguage: 'en', languages: ['en'] });
    const b = `/api/brands/${brand.id}`;

    // Approved facts: a product with a price, a discount offer with a number, a voice fact with a prohibited word.
    const shawl = await api('post', `${b}/knowledge/subjects`, { type: 'product', name: 'Pashmina shawl' });
    const price = await api('post', `${b}/knowledge/facts`, { section: 'products', subjectId: shawl.id, field: 'price', value: 4000, unit: 'NPR', language: 'en' });
    const offer = await api('post', `${b}/knowledge/facts`, { section: 'positioning', field: 'proof', value: 'Hand-woven pashmina, 15% off until 24 October', language: 'en' });
    await api('post', `${b}/knowledge/facts`, { section: 'voice', field: 'prohibited_words', value: ['guarantee'], language: 'en' });

    // Palette roles, and a logo with a licence (the upload goes to the object store the API presigned for).
    await api('put', `${b}/knowledge/palette`, { colours: [{ hex: '#0f5257', role: 'primary' }, { hex: '#141414', role: 'text' }, { hex: '#f5efe5', role: 'background' }, { hex: '#c6a46a', role: 'accent' }] });
    const upload = async (file: string, mime: string, kind: 'logo' | 'photo', rights: object | undefined = { licence: 'Own artwork, all uses' }) => {
      const bytes = readFileSync(`${FIXTURES}/${file}`);
      const { source, uploadUrl } = await api('post', `${b}/sources/uploads`, { filename: file, mime, bytes: bytes.length });
      const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes });
      expect(put.ok, `PUT ${file}`).toBe(true);
      await api('post', `${b}/sources/${source.id}/complete`);
      await api('post', `${b}/knowledge/assets`, { sourceId: source.id, kind, ...(rights ? { rights } : {}) });
    };
    await upload('logo-wide.png', 'image/png', 'logo');
    await upload('photo.jpg', 'image/jpeg', 'photo');

    // Plan: settings, a week with a text, an image and a carousel item, approved.
    await api('put', `${b}/plan/settings`, { channels: [{ channel: 'instagram', postsPerWeek: 7 }], pillars: [], weekStarts: 0 });
    const { weekStart } = (await (await request.get(`${b}/plan/overview`)).json()).weeks[0] as { weekStart: string };
    const day = (n: number) => new Date(Date.parse(`${weekStart}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    for (const [n, format, idea] of [[0, 'text', 'Dashain greeting'], [1, 'image', 'Shawl of the week'], [2, 'carousel', 'Winter shawls']] as const)
      await api('post', `${b}/plan/weeks/${weekStart}/items`, { day: day(n), channel: 'instagram', format, pillar: 'product', funnel: 'product_aware', intent: 'persuade', idea, cta: 'Visit the shop', factIds: [price.id, offer.id] });
    await api('post', `${b}/plan/weeks/${weekStart}/approve`);

    // The mock model answers in item order: text, image, carousel. The carousel has a claim citing nothing and a number no cited fact holds.
    const cite = (...ids: string[]) => ids;
    const copy = (sentences: object[]) => ({ language: 'en', sentences, hashtags: ['pashmina'], cta: 'Visit the shop' });
    await queueAi(
      { copies: [copy([{ text: 'Pashmina shawl from NPR 4,000.', claim: true, factIds: cite(price.id) }, { text: 'Enjoy 15% off until 24 October.', claim: true, factIds: cite(offer.id) }])] },
      { copies: [copy([{ text: 'Warm for the whole winter.', claim: false, factIds: [] }])], slides: [{ headline: 'Warm winter shawls', subline: 'Pashmina from NPR 4,000' }] },
      {
        copies: [copy([
          { text: 'Hand-woven pashmina from NPR 4,000.', claim: true, factIds: cite(price.id) },
          { text: 'The lowest price in Kathmandu.', claim: true, factIds: [] },
          { text: 'Save 20% this week.', claim: false, factIds: [] },
        ])],
        slides: [{ headline: 'Winter warmth' }, { headline: 'Hand-woven in Patan' }, { headline: 'Shop now' }],
      },
    );

    await page.goto(`/app/b/${brand.id}/studio?week=${weekStart}`);
    await expect(page.getByRole('article', { name: 'Instagram carousel' })).toContainText('Winter shawls');
    await expect(page.getByRole('article', { name: 'Instagram text post' })).toContainText('Dashain greeting');
    await expect(page.getByRole('article', { name: 'Instagram single image' })).toContainText('Shawl of the week');
    await page.getByRole('button', { name: /^Draft all/ }).click();
    const confirm = page.getByRole('region', { name: 'Confirm the cost' });
    await expect(confirm).toContainText('NPR');
    await confirm.getByRole('button', { name: 'Confirm and start' }).click();
    await expect(page.getByText('3 drafted.')).toBeVisible({ timeout: 60_000 });
    for (const name of ['Instagram text post', 'Instagram single image', 'Instagram carousel'])
      await expect(page.getByRole('article', { name }).getByRole('link', { name: /Open draft/ })).toBeVisible();

    // Render the image draft through the API, so the dashboard has a second thumbnail.
    const image = page.getByRole('article', { name: 'Instagram single image' }).getByRole('link', { name: /Open draft/ });
    const imageId = (await image.getAttribute('href'))!.split('/').pop()!;
    const { id: runId } = await api('post', `${b}/studio/drafts/${imageId}/render`);
    await expect.poll(async () => (await (await request.get(`${b}/studio/runs/${runId}`)).json()).state, { timeout: 60_000 }).toBe('completed');

    await page.getByRole('article', { name: 'Instagram carousel' }).getByRole('link', { name: /Open draft/ }).click();

    // The left-out claim and the invented number are visible, and Ready is refused.
    await expect(page.getByRole('heading', { name: 'Winter shawls' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Left out' }).getByText('The lowest price in Kathmandu.')).toBeVisible();
    const findings = page.getByRole('region', { name: /block Ready/ });
    await expect(findings.getByText('Number not in a cited fact')).toBeVisible();
    await expect(findings.getByText('20 is not in any approved fact this draft cites')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark ready' })).toBeDisabled();

    // Remove the number, save, render (NPR 0), and see the slides at two sizes.
    await page.getByLabel('Sentence 2 in English').fill('Warm for the whole winter.');
    // Slide 2 gets a photo from the brand's assets: the only photo offered is the one with a licence.
    await page.getByRole('button', { name: 'Choose a photo for slide 2' }).click();
    await page.getByRole('group', { name: 'Photos for slide 2' }).getByRole('button', { name: /photo.jpg/ }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Version 2, written by you')).toBeVisible();
    await expect(page.getByText('Number not in a cited fact')).toHaveCount(0);
    await page.getByRole('button', { name: /^Render/ }).click();
    const previews = page.getByRole('region', { name: 'Rendered previews' });
    await expect(previews.getByRole('img')).toHaveCount(3, { timeout: 60_000 });
    const shown = async () => previews.getByRole('img').evaluateAll((els) => (els as HTMLImageElement[]).map((e) => ({ w: e.naturalWidth, h: e.naturalHeight, ok: e.complete })));
    await expect.poll(shown).toEqual([1, 2, 3].map(() => ({ w: 1080, h: 1080, ok: true })));
    await previews.getByRole('button', { name: /4:5/ }).click();
    await expect(previews.getByRole('img').first()).toHaveAccessibleName('Slide 1 of 3 at 4:5');
    await expect.poll(shown).toEqual([1, 2, 3].map(() => ({ w: 1080, h: 1350, ok: true })));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/editor.png`, fullPage: true });

    await page.getByRole('button', { name: 'Mark ready' }).click();
    await expect(page.getByText('Ready as version 2')).toBeVisible();

    // Editing it makes a new version and drops it back to draft.
    await page.getByLabel('Headline, slide 1').fill('Winter warmth, hand-woven');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Version 3, written by you')).toBeVisible();
    await expect(page.getByText('Ready as version 2')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mark ready' })).toBeDisabled(); // the new version has no render yet

    // The back link opens the draft's own week.
    await page.getByRole('link', { name: 'Back to Studio' }).click();
    await expect(page).toHaveURL(new RegExp(`studio\\?week=${weekStart}`));
    await expect(page.getByRole('article', { name: 'Instagram carousel' }).getByText('Draft', { exact: true })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dashboard.png`, fullPage: true });
  });
});
