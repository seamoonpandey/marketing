import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { queueAi, resetAi } from './helpers';

const FIXTURES = '../server/test/fixtures/studio/render';
const SHOTS = process.env.SHOTS_DIR;
const TZ = 'Asia/Kathmandu';

/** A date (YYYY-MM-DD), a time (HH:MM) and the calendar's day label of an instant in the brand's timezone. */
function wall(ms: number) {
  const at = new Date(ms);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at).map((x) => [x.type, x.value]));
  const label = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(at).replace(',', '');
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, label };
}
/** The next whole minute at least `seconds` away. */
const minuteAfter = (seconds: number) => Math.ceil((Date.now() + seconds * 1000) / 60_000) * 60_000;

test.describe('publish, full flow against the real API and mock model', () => {
  test.beforeEach(async () => { await resetAi(); });

  test('a brand goes from nothing to a post published by hand, and an edited draft is blocked at send time', async ({ page, request }) => {
    test.setTimeout(600_000);
    const api = async (method: 'post' | 'put', path: string, data?: object) => {
      const res = await request[method](path, data ? { data } : {});
      expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
      return res.json();
    };
    const get = async (path: string) => (await request.get(path)).json();

    // ---- a brand with two ready drafts: a static image post for Instagram, a text post for X
    const brand = await api('post', '/api/brands', { name: `Publish ${Date.now()}`, defaultLanguage: 'en', languages: ['en'], timezone: TZ });
    const b = `/api/brands/${brand.id}`;
    const shawl = await api('post', `${b}/knowledge/subjects`, { type: 'product', name: 'Pashmina shawl' });
    const price = await api('post', `${b}/knowledge/facts`, { section: 'products', subjectId: shawl.id, field: 'price', value: 4000, unit: 'NPR', language: 'en' });
    await api('put', `${b}/knowledge/palette`, { colours: [{ hex: '#0f5257', role: 'primary' }, { hex: '#141414', role: 'text' }, { hex: '#f5efe5', role: 'background' }, { hex: '#c6a46a', role: 'accent' }] });
    const bytes = readFileSync(`${FIXTURES}/logo-wide.png`);
    const { source, uploadUrl } = await api('post', `${b}/sources/uploads`, { filename: 'logo-wide.png', mime: 'image/png', bytes: bytes.length });
    expect((await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: bytes })).ok).toBe(true);
    await api('post', `${b}/sources/${source.id}/complete`);
    await api('post', `${b}/knowledge/assets`, { sourceId: source.id, kind: 'logo', rights: { licence: 'Own artwork, all uses' } });

    await api('put', `${b}/plan/settings`, { channels: [{ channel: 'instagram', postsPerWeek: 7 }, { channel: 'x', postsPerWeek: 7 }], pillars: [], weekStarts: 0 });
    const { weekStart } = (await get(`${b}/plan/overview`)).weeks[0] as { weekStart: string };
    const day = (n: number) => new Date(Date.parse(`${weekStart}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const item = (d: number, channel: string, format: string, idea: string) =>
      api('post', `${b}/plan/weeks/${weekStart}/items`, { day: day(d), channel, format, pillar: 'product', funnel: 'product_aware', intent: 'persuade', idea, cta: 'Visit the shop', factIds: [price.id] });
    await item(0, 'instagram', 'image', 'Winter warmth');
    await item(1, 'x', 'text', 'Morning note');
    const { plan } = (await get(`${b}/plan/weeks/${weekStart}`)) as { plan: { version: number } };
    await api('post', `${b}/plan/weeks/${weekStart}/approve`, { version: plan.version });
    const planned = (await get(`${b}/studio/overview?weekStart=${weekStart}`)) as { items: { item: { id: string; channel: string } }[] };
    const idOf = (channel: string) => planned.items.find((i) => i.item.channel === channel)!.item.id;

    // The image caption is over X's 280 characters, so X must refuse it; the text post is short.
    const LONG = `${'Hand-woven in Patan from the softest winter wool, one shawl at a time. '.repeat(5)}Warm for the whole season.`;
    const SHORT = 'A quiet morning, a warm shawl.';
    const copy = (text: string) => ({ copies: [{ language: 'en', sentences: [{ text, claim: false, factIds: [] }], hashtags: ['pashmina'], cta: 'Visit the shop' }] });
    await queueAi({ ...copy(LONG), slides: [{ headline: 'Warm winter shawls' }] }, copy(SHORT));
    // One generate run per item, so each answer goes to the draft it is meant for.
    const draftOf = async (channel: string) => {
      const run = await api('post', `${b}/studio/drafts`, { planItemIds: [idOf(channel)] });
      await expect.poll(async () => (await get(`${b}/studio/runs/${run.id}`)).state, { timeout: 60_000 }).toBe('completed');
      const o = (await get(`${b}/studio/overview?weekStart=${weekStart}`)) as { items: { item: { id: string }; draft: { id: string } | null }[] };
      return o.items.find((i) => i.item.id === idOf(channel))!.draft!.id;
    };
    const staticId = await draftOf('instagram');
    const postId = await draftOf('x');
    const render = await api('post', `${b}/studio/drafts/${staticId}/render`);
    await expect.poll(async () => (await get(`${b}/studio/runs/${render.id}`)).state, { timeout: 60_000 }).toBe('completed');
    await api('post', `${b}/studio/drafts/${staticId}/ready`);
    await api('post', `${b}/studio/drafts/${postId}/ready`);

    for (const id of [staticId, postId]) {
      await page.goto(`/app/b/${brand.id}/approve/${id}`);
      await page.getByRole('button', { name: 'Approve version 1' }).click();
      await expect(page.getByRole('heading', { name: 'You approved this version' })).toBeVisible();
    }

    // ---- the settings screen: open every hour of the day, so a time a minute ahead is inside the publishing hours
    await page.goto(`/app/b/${brand.id}/publish`);
    await expect(page.getByText('Add a channel to start')).toBeVisible();
    await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
    await expect(page.getByLabel('From')).toHaveValue('7');
    await page.getByLabel('From').selectOption('0');
    await page.getByLabel('Until').selectOption('24');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status')).toContainText('Saved.');
    expect(await get(`${b}/publish/settings`)).toMatchObject({ windowStart: 0, windowEnd: 24 });

    // ---- channels: Instagram and X, both by hand
    await page.goto(`/app/b/${brand.id}/publish/channels`);
    for (const [platform, name] of [['instagram', '@himalpashmina'], ['x', '@himal_x']] as const) {
      await page.getByLabel('Platform', { exact: true }).selectOption(platform);
      await page.getByLabel('Account name').fill(name);
      await page.getByRole('button', { name: 'Add channel' }).click();
      await expect(page.getByRole('listitem').filter({ hasText: `${name}` }).first()).toContainText('Posted by hand');
    }

    // ---- calendar: the image post to Instagram, refused for X with the reason; the text post to X
    // Instagram's job is due in 1 to 2 minutes; X's three minutes later, so the edit below lands first.
    await page.goto(`/app/b/${brand.id}/publish/calendar`);
    const card = (text: string) => page.getByRole('listitem').filter({ hasText: text }).last();
    const igCard = card('Hand-woven in Patan');
    await expect(igCard.getByLabel(/X · @himal_x/)).toBeDisabled();
    await expect(igCard).toContainText(/Cannot schedule here: .*characters.*at most 280/);
    const igAt = minuteAfter(75);
    const xAt = igAt + 3 * 60_000;
    const ig = wall(igAt);
    const x = wall(xAt);
    await igCard.getByLabel(/Instagram · @himalpashmina/).check();
    await igCard.getByLabel('Day').fill(ig.date);
    await igCard.getByLabel('Time').fill(ig.time);
    await igCard.getByRole('button', { name: /^Schedule to/ }).click();
    await expect(igCard.getByRole('status')).toContainText('Instagram · @himalpashmina: scheduled');
    const xCard = card(SHORT);
    await xCard.getByLabel(/X · @himal_x/).check();
    await xCard.getByLabel('Day').fill(x.date);
    await xCard.getByLabel('Time').fill(x.time);
    await xCard.getByRole('button', { name: /^Schedule to/ }).click();
    await expect(xCard.getByRole('status')).toContainText('X · @himal_x: scheduled');

    // both on the calendar, on their day, at their time in the brand's timezone
    await expect(page.getByRole('heading', { name: new RegExp(TZ) }).first()).toBeVisible();
    await expect(page.getByRole('listitem', { name: ig.label }).getByRole('link', { name: `${ig.time} Instagram` })).toBeVisible();
    await expect(page.getByRole('listitem', { name: x.label }).getByRole('link', { name: `${x.time} X` })).toBeVisible();
    await expect(page.locator('[data-job-state="scheduled"]')).toHaveCount(2);
    if (SHOTS) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${SHOTS}/calendar-390.png`, fullPage: true });
      await page.setViewportSize({ width: 1280, height: 720 });
    }

    // ---- the owner edits the text post in Studio after it was scheduled
    await page.goto(`/app/b/${brand.id}/studio/drafts/${postId}`);
    await page.getByLabel('Sentence 1 in English').fill('A quiet morning, a different line.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/^Version \d+, written by you/)).toBeVisible();

    // ---- the first job comes due: the scheduler turns it into "post by hand now" and the dashboard's own polling shows it
    await page.goto(`/app/b/${brand.id}/publish`);
    const now = page.locator('[data-job-state="awaiting_manual"]');
    await expect(now).toHaveCount(1, { timeout: 4 * 60_000 });
    await expect(page.getByRole('heading', { name: 'Post by hand now' })).toBeVisible();
    await expect(now).toContainText(`${ig.time} ${TZ}`);
    if (SHOTS) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${SHOTS}/dashboard-390.png`, fullPage: true });
      await page.setViewportSize({ width: 1280, height: 720 });
    }

    // ---- the manual job: caption, media in Instagram's shape, then the link
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await now.getByRole('link', { name: 'Open and post' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Post this on Instagram' })).toBeVisible();
    const en = page.getByRole('group', { name: 'Text in English' });
    await en.getByRole('button', { name: 'Copy Caption' }).click();
    await expect(en.getByRole('button', { name: 'Copy Caption' })).toContainText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LONG);
    const download = page.getByRole('link', { name: /^Download instagram-1\.png/ });
    await expect(download).toContainText('1:1 · 1080 × 1080'); // Instagram takes 1:1 first; the draft also has 4:5
    await expect(page.getByRole('link', { name: /^Download / })).toHaveCount(1);
    const file = await request.get((await download.getAttribute('href'))!);
    expect(file.ok()).toBe(true);
    expect(file.headers()['content-type']).toMatch(/image\/png/);
    expect((await file.body()).subarray(1, 4).toString()).toBe('PNG');
    const img = page.getByRole('img', { name: /Image 1 of the post, 1:1/ });
    await expect.poll(() => img.evaluate((e) => [(e as HTMLImageElement).naturalWidth, (e as HTMLImageElement).naturalHeight])).toEqual([1080, 1080]);
    if (SHOTS) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${SHOTS}/job-390.png`, fullPage: true });
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    const LINK = 'https://www.instagram.com/p/Cxyz123abc/';
    await page.getByLabel('Link to your post').fill(LINK);
    await page.getByRole('button', { name: 'Confirm it is posted' }).click();
    await expect(page.getByRole('link', { name: /Open the post/ })).toHaveAttribute('href', LINK);
    await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm it is posted' })).toHaveCount(0);

    // ---- the edited draft's job is blocked at send time, with the reason, and nothing is offered to post
    await page.getByRole('link', { name: 'Back to Publish' }).click();
    await expect(page.locator('[data-job-state="published"]')).toContainText(`${ig.time} ${TZ}`);
    const blocked = page.locator('[data-job-state="blocked"]');
    await expect(blocked).toHaveCount(1, { timeout: 5 * 60_000 });
    await expect(blocked).toContainText(/changed|approval/i);
    await blocked.getByRole('link').first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'X post' })).toBeVisible();
    await expect(page.getByText(/changed|approval/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Copy/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Download/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirm it is posted' })).toHaveCount(0);
    await expect(page.locator('[data-job-state="awaiting_manual"]')).toHaveCount(0);
    expect((await get(`${b}/publish/jobs/${page.url().split('/').pop()}`)).job.state).toBe('blocked');
  });
});
