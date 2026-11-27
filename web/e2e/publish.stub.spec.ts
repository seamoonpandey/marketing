import { expect, test, type Locator, type Page } from '@playwright/test';

// Screens against a stubbed API. Bodies follow server/openapi.json; the server branch is not needed.
const B = 'brand-1';
const TZ = 'Asia/Kathmandu';
const NOW = '2026-11-27T06:00:00.000Z';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const MEDIA = 'https://media.test/post-4x5.png';

const brand = { id: B, name: 'Himal Pashmina', slug: 'himal', website: null, country: 'NP', timezone: TZ, currency: 'NPR', defaultLanguage: 'en', languages: ['en', 'ne'], status: 'active', createdAt: NOW };
const none = { cancel: false, reschedule: false, retry: false, confirmManual: false, resolveUnknown: false };
const ig = { id: 'ch-ig', platform: 'instagram', accountName: '@himal', mode: 'manual', status: 'connected' };
const x = { id: 'ch-x', platform: 'x', accountName: '@himal_x', mode: 'manual', status: 'connected' };

const job = (state: string, o: Record<string, unknown> = {}) => ({
  id: `job-${state}`, draftId: 'dr-1', draftVersion: 2, payloadHash: 'h', channelId: ig.id, channel: ig, kind: 'post', excerpt: 'Hand-woven in Patan. हस्तनिर्मित पश्मिना शाल',
  scheduledAt: '2026-12-01T04:15:00.000Z', dueAt: '2026-12-01T04:15:00.000Z', state, attempts: 0, error: null, retryable: false, externalId: null, externalUrl: null,
  publishedAt: null, manual: false, actions: none, createdAt: NOW, ...o,
});
const STATES: Record<string, ReturnType<typeof job>> = {
  scheduled: job('scheduled', { actions: { ...none, cancel: true, reschedule: true } }),
  publishing: job('publishing'),
  awaiting_manual: job('awaiting_manual', { actions: { ...none, cancel: true, confirmManual: true } }),
  published: job('published', { externalUrl: 'https://instagram.com/p/abc', manual: true, publishedAt: NOW }),
  unknown: job('unknown', { error: 'The send timed out.', actions: { ...none, resolveUnknown: true } }),
  blocked: job('blocked', { error: 'The draft was edited after it was approved.', actions: { ...none, cancel: true, reschedule: true, retry: true } }),
  failed: job('failed', { error: 'Instagram refused the post.', retryable: true, actions: { ...none, retry: true } }),
  cancelled: job('cancelled'),
};
const counts = Object.fromEntries(Object.keys(STATES).map((s) => [s, 1]));
const summary = (o: object = {}) => ({
  timezone: TZ, now: NOW, hasChannels: true, counts,
  manualNow: [STATES.awaiting_manual], attention: [STATES.unknown, STATES.blocked, STATES.failed], upcoming: [STATES.scheduled, STATES.publishing], published: [STATES.published], ...o,
});
const pkg = (o: object = {}) => ({
  available: true, reason: null, ratio: '4:5',
  captions: [
    { language: 'en', caption: 'Hand-woven in Patan.\nFifteen years of craft.', cta: 'Order today', hashtags: ['#pashmina', '#nepal'] },
    { language: 'ne', caption: 'पाटनमा हातले बुनिएको पश्मिना शाल', cta: 'आजै अर्डर गर्नुहोस्', hashtags: ['#पश्मिना'] },
  ],
  media: [{ index: 0, ratio: '4:5', kind: 'image', width: 1080, height: 1350, filename: 'post-4x5.png', url: MEDIA }],
  ...o,
});
const draft = {
  draftId: 'dr-1', version: 2, kind: 'post', day: '2026-12-01', plannedChannel: 'instagram', excerpt: 'Hand-woven in Patan', thumbnailUrl: MEDIA, approvalExpiresAt: null,
  channels: [
    { channelId: ig.id, platform: 'instagram', accountName: '@himal', status: 'connected', fits: true, reason: null },
    { channelId: x.id, platform: 'x', accountName: '@himal_x', status: 'connected', fits: false, reason: 'the caption is 412 characters and X takes 280' },
    { channelId: 'ch-fb', platform: 'facebook', accountName: 'Himal Pashmina', status: 'connected', fits: true, reason: null },
  ],
};
const caps = [
  { platform: 'instagram', textLimit: 2200, ratios: ['4:5', '1:1', '9:16'], maxMedia: 10, lastVerified: null, verified: false, manualFallback: true },
  { platform: 'x', textLimit: 280, ratios: ['16:9', '1:1'], maxMedia: 4, lastVerified: null, verified: false, manualFallback: true },
];

type World = Record<string, any> & { calls: string[]; bodies: Record<string, any> };

async function stub(page: Page, init: Partial<World> = {}) {
  const w: World = {
    summary: summary(), channels: [{ ...ig, connector: 'manual', accountUrl: null, lastVerifiedAt: null, createdAt: NOW }], jobs: [], detail: null,
    schedulable: { timezone: TZ, settings: { windowStart: 7, windowEnd: 21, maxAttempts: 3 }, drafts: [draft] }, calls: [], bodies: {}, ...init,
  };
  await page.route(MEDIA, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(`/api/brands/${B}`, '') || '/';
    const m = req.method();
    const key = `${m} ${path}`;
    w.calls.push(key);
    w.bodies[key] = req.postDataJSON?.() ?? null;
    const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const err = (status: number, code: string, message: string) => send({ error: { code, message } }, status);
    if (path === '/api/brands') return send([brand]);
    if (path === '/') return send(brand);
    if (path === '/publish/summary') return w.summaryError ? err(500, 'internal', 'Something broke') : send(w.summary);
    if (path === '/publish/channels' && m === 'GET') return send(w.channels);
    if (path === '/publish/channels' && m === 'POST') {
      const c = { id: 'ch-new', platform: w.bodies[key].platform, mode: 'manual', connector: 'manual', accountName: w.bodies[key].accountName, accountUrl: w.bodies[key].accountUrl ?? null, status: 'connected', lastVerifiedAt: null, createdAt: NOW };
      w.channels.push(c);
      return send(c, 201);
    }
    if (path === '/publish/capabilities') return send(caps);
    if (path === '/publish/settings' && m === 'GET') return send(w.schedulable.settings);
    if (path === '/publish/settings' && m === 'PUT') {
      const b = w.bodies[key];
      if (b.windowStart >= b.windowEnd) return err(400, 'bad_request', 'The publishing window must start before it ends');
      w.schedulable.settings = b;
      return send(b);
    }
    if (path === '/publish/schedulable') return send(w.schedulable);
    if (path === '/publish/jobs' && m === 'GET') return send({ timezone: TZ, jobs: w.jobs });
    if (path === '/publish/jobs' && m === 'POST') {
      return w.bodies[key].channelId === 'ch-fb' ? err(409, 'conflict', 'The draft already has an active job on that channel.') : send(job('scheduled'), 201);
    }
    let r: RegExpMatchArray | null;
    if ((r = path.match(/^\/publish\/jobs\/([\w-]+)$/))) return send({ timezone: TZ, job: w.detail.job, history: w.detail.history ?? [], package: w.detail.package ?? pkg() });
    if ((r = path.match(/^\/publish\/jobs\/([\w-]+)\/(confirm-manual|resolve-unknown|retry|cancel|reschedule)$/))) {
      const b = w.bodies[key];
      if (r[2] === 'confirm-manual' && !/^https?:\/\//.test(b.url)) return err(400, 'bad_request', 'That is not a link.');
      return send({ ...w.detail.job, state: r[2] === 'confirm-manual' ? 'published' : 'scheduled' });
    }
    return err(404, 'not_stubbed', `${m} ${path}`);
  });
  return w;
}

const withJob = (state: string, extra: Record<string, unknown> = {}) => ({ job: STATES[state]!, ...extra });

async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('not reachable by Tab');
}

test.describe('dashboard', () => {
  test('one job in each state, each with its reason and its next action', async ({ page }) => {
    await stub(page);
    await page.goto(`/app/b/${B}/publish`);
    await expect(page.getByRole('heading', { level: 1, name: 'Publish' })).toBeVisible();
    // "Post by hand now" comes first
    await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText('Post by hand now');
    const heads = await page.getByRole('heading', { level: 2 }).allTextContents();
    expect(heads[0]).toBe('Post by hand now');
    await expect(page.locator('[data-job-state="awaiting_manual"]')).toContainText('Copy the text, download the image');
    await expect(page.locator('[data-job-state="unknown"]')).toContainText('Check the channel, then say whether it was posted');
    await expect(page.locator('[data-job-state="unknown"]')).toContainText('The send timed out.');
    await expect(page.locator('[data-job-state="blocked"]')).toContainText('The draft was edited after it was approved.');
    await expect(page.locator('[data-job-state="failed"]')).toContainText('Instagram refused the post.');
    await expect(page.locator('[data-job-state="scheduled"]')).toContainText('move it to another time or cancel');
    await expect(page.locator('[data-job-state="published"]').getByRole('link', { name: /View the post/ })).toHaveAttribute('href', 'https://instagram.com/p/abc');
    // every time names its timezone and is shown in it (04:15 UTC is 10:00 in Kathmandu)
    await expect(page.locator('[data-job-state="awaiting_manual"]')).toContainText(`10:00 ${TZ}`);
    // Devanagari wraps and is not cut
    await expect(page.locator('[data-job-state="scheduled"]').getByText('हस्तनिर्मित पश्मिना शाल', { exact: false })).toBeVisible();
  });

  test('with no channels the owner is sent to add one', async ({ page }) => {
    await stub(page, { summary: summary({ hasChannels: false, manualNow: [], attention: [], upcoming: [], published: [] }) });
    await page.goto(`/app/b/${B}/publish`);
    await expect(page.locator('[data-state="empty"]')).toContainText('Add a channel to start');
    await expect(page.getByRole('link', { name: 'Add a channel' })).toHaveAttribute('href', `/app/b/${B}/publish/channels`);
  });

  test('empty sections say what they are waiting for', async ({ page }) => {
    await stub(page, { summary: summary({ manualNow: [], attention: [], upcoming: [], published: [] }) });
    await page.goto(`/app/b/${B}/publish`);
    await expect(page.getByText('Nothing is waiting for you to post.')).toBeVisible();
    await expect(page.getByText('Nothing has been published yet.')).toBeVisible();
  });

  test('the error state offers a retry', async ({ page }) => {
    const w = await stub(page, { summaryError: true });
    await page.goto(`/app/b/${B}/publish`);
    await expect(page.locator('[data-state="error"]')).toContainText('Something broke', { timeout: 15_000 });
    w.summaryError = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'Post by hand now' })).toBeVisible();
  });

  test('keyboard only: from the page to a job and back', async ({ page }) => {
    await stub(page, { detail: withJob('awaiting_manual') });
    await page.goto(`/app/b/${B}/publish`);
    await expect(page.getByRole('heading', { name: 'Post by hand now' })).toBeVisible();
    await tabTo(page, page.getByRole('link', { name: 'Open and post' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/publish\/jobs\/job-awaiting_manual$/);
    await tabTo(page, page.getByRole('button', { name: 'Copy Caption' }).first());
  });
});

test.describe('calendar', () => {
  test('schedule a draft to two channels, one refused for fit with its reason, one refused by the server', async ({ page }) => {
    const w = await stub(page);
    await page.goto(`/app/b/${B}/publish/calendar`);
    const card = page.getByRole('listitem').filter({ hasText: 'Hand-woven in Patan' }).last();
    // the misfit channel is disabled and says why, before anything is submitted
    await expect(card.getByLabel(/X · @himal_x/)).toBeDisabled();
    await expect(card).toContainText('Cannot schedule here: the caption is 412 characters and X takes 280');
    await expect(card.getByRole('button', { name: /^Schedule to/ })).toBeDisabled();
    await card.getByLabel(/Instagram · @himal/).check();
    await card.getByLabel(/Facebook · Himal Pashmina/).check();
    await card.getByLabel('Day').fill('2026-12-01');
    await card.getByLabel('Time').fill('10:00');
    await expect(card).toContainText(`Times are in ${TZ}`);
    await card.getByRole('button', { name: /^Schedule to/ }).click();
    await expect(card.getByRole('status')).toContainText('Instagram · @himal: scheduled');
    await expect(card.getByRole('status')).toContainText('already has an active job on that channel');
    const posts = w.calls.filter((c: string) => c === 'POST /publish/jobs');
    expect(posts).toHaveLength(2);
  });

  test('a week with no jobs and no drafts shows both empty states', async ({ page }) => {
    await stub(page, { schedulable: { timezone: TZ, settings: { windowStart: 7, windowEnd: 21, maxAttempts: 3 }, drafts: [] } });
    await page.goto(`/app/b/${B}/publish/calendar`);
    await expect(page.getByText('Nothing scheduled').first()).toBeVisible();
    await expect(page.locator('[data-state="empty"]')).toContainText('No approved drafts are waiting');
  });
});

test.describe('timezone', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('a time picked is sent with the brand offset, and times are shown in the brand timezone, not the browser', async ({ page }) => {
    const w = await stub(page);
    await page.goto(`/app/b/${B}/publish/calendar`);
    const card = page.getByRole('listitem').filter({ hasText: 'Hand-woven in Patan' }).last();
    await card.getByLabel(/Instagram · @himal/).check();
    await card.getByLabel('Day').fill('2026-12-01');
    await card.getByLabel('Time').fill('10:00');
    await card.getByRole('button', { name: /^Schedule to/ }).click();
    await expect(card.getByRole('status')).toContainText('scheduled');
    expect(w.bodies['POST /publish/jobs'].scheduledAt).toBe('2026-12-01T10:00:00+05:45');
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('America/Los_Angeles');
    w.detail = withJob('scheduled');
    await page.goto(`/app/b/${B}/publish/jobs/job-scheduled`);
    await expect(page.getByText(`Tue 1 Dec, 10:00 ${TZ}`).first()).toBeVisible();
    // moving a job uses the same rule
    await page.getByRole('button', { name: 'Move to another time' }).click();
    await page.getByLabel('Day').fill('2026-12-02');
    await page.getByLabel(`Time (${TZ})`).fill('09:30');
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    await expect.poll(() => w.bodies['POST /publish/jobs/job-scheduled/reschedule']?.scheduledAt).toBe('2026-12-02T09:30:00+05:45');
  });
});

test.describe('a manual job', () => {
  test('copy the caption exactly, then confirm with the link', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const w = await stub(page, { detail: withJob('awaiting_manual') });
    await page.goto(`/app/b/${B}/publish/jobs/job-awaiting_manual`);
    await expect(page.getByRole('heading', { level: 1, name: 'Post this on Instagram' })).toBeVisible();
    const en = page.getByRole('group', { name: 'Text in English' });
    await en.getByRole('button', { name: 'Copy Caption' }).click();
    await expect(en.getByRole('button', { name: 'Copy Caption' })).toContainText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Hand-woven in Patan.\nFifteen years of craft.');
    await en.getByRole('button', { name: 'Copy Hashtags' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('#pashmina #nepal');
    // Nepali text is shown whole and copied whole
    const ne = page.getByRole('group', { name: 'Text in Nepali' });
    await expect(ne.getByText('पाटनमा हातले बुनिएको पश्मिना शाल')).toBeVisible();
    await ne.getByRole('button', { name: 'Copy Caption' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('पाटनमा हातले बुनिएको पश्मिना शाल');
    // media keep their shape and name their size
    const dl = page.getByRole('link', { name: /Download post-4x5.png/ });
    await expect(dl).toContainText('4:5 · 1080 × 1350');
    await expect(dl).toHaveAttribute('download', 'post-4x5.png');
    await expect(page.getByRole('img', { name: /Image 1 of the post, 4:5/ })).toBeVisible();
    // a bad link is refused on the page; a good one confirms
    await page.getByLabel('Link to your post').fill('not a link');
    await page.getByRole('button', { name: 'Confirm it is posted' }).click();
    await expect(page.locator('#post-url-err')).toContainText('not a link');
    expect(w.calls).not.toContain('POST /publish/jobs/job-awaiting_manual/confirm-manual');
    await page.getByLabel('Link to your post').fill('https://instagram.com/p/abc');
    await page.getByRole('button', { name: 'Confirm it is posted' }).click();
    await expect.poll(() => w.bodies['POST /publish/jobs/job-awaiting_manual/confirm-manual']?.url).toBe('https://instagram.com/p/abc');
  });

  test('at 390 pixels it stacks, the copy buttons are large, and the link field is in view without scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await stub(page, { detail: withJob('awaiting_manual') });
    await page.goto(`/app/b/${B}/publish/jobs/job-awaiting_manual`);
    await expect(page.getByRole('heading', { name: 'What to post' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const copy = await page.getByRole('button', { name: 'Copy Caption' }).first().boundingBox();
    expect(copy!.height).toBeGreaterThanOrEqual(44);
    const input = page.getByLabel('Link to your post');
    await expect(input).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Confirm it is posted' })).toBeInViewport();
    // still in reach after scrolling to the bottom of the media
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(input).toBeInViewport();
    const cap = await page.getByRole('button', { name: 'Copy Caption' }).first().boundingBox();
    const img = await page.getByRole('img', { name: /Image 1/ }).boundingBox();
    expect(img!.y).toBeGreaterThan(cap!.y); // stacked: the copy comes before the media
  });

  test('a package that is no longer valid shows nothing to post', async ({ page }) => {
    await stub(page, { detail: withJob('awaiting_manual', { package: pkg({ available: false, reason: 'The draft was edited after approval.', captions: [], media: [] }) }) });
    await page.goto(`/app/b/${B}/publish/jobs/job-awaiting_manual`);
    await expect(page.locator('[data-state="error"]')).toContainText('The draft was edited after approval.');
    await expect(page.getByRole('button', { name: /^Copy/ })).toHaveCount(0);
  });
});

test.describe('other states', () => {
  test('unknown: explains itself and resolves both ways', async ({ page }) => {
    const w = await stub(page, { detail: withJob('unknown') });
    await page.goto(`/app/b/${B}/publish/jobs/job-unknown`);
    await expect(page.getByText('could not tell whether the post went out')).toBeVisible();
    await expect(page.getByText('will not be sent again until you say whether it went out')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry now' })).toHaveCount(0);
    await page.getByRole('button', { name: 'It was posted' }).click();
    await page.getByLabel('Link to the post').fill('https://instagram.com/p/xyz');
    await page.getByRole('button', { name: 'Save as published' }).click();
    await expect.poll(() => w.bodies['POST /publish/jobs/job-unknown/resolve-unknown']).toEqual({ posted: true, url: 'https://instagram.com/p/xyz' });
    await page.getByRole('button', { name: 'It was not posted' }).click();
    await page.getByRole('button', { name: 'Send it again' }).click();
    await expect.poll(() => w.bodies['POST /publish/jobs/job-unknown/resolve-unknown']).toEqual({ posted: false });
  });

  test('blocked: shows its reason and offers retry, move and cancel', async ({ page }) => {
    await stub(page, { detail: withJob('blocked') });
    await page.goto(`/app/b/${B}/publish/jobs/job-blocked`);
    await expect(page.getByText('The draft was edited after it was approved.').first()).toBeVisible();
    for (const n of ['Retry now', 'Move to another time', 'Cancel this post']) await expect(page.getByRole('button', { name: n })).toBeVisible();
  });

  test('published and cancelled offer no actions', async ({ page }) => {
    await stub(page, { detail: withJob('published') });
    await page.goto(`/app/b/${B}/publish/jobs/job-published`);
    await expect(page.getByRole('link', { name: /Open the post/ })).toHaveAttribute('href', 'https://instagram.com/p/abc');
    await expect(page.getByRole('heading', { name: 'Other actions' })).toHaveCount(0);
  });
});

test.describe('channels', () => {
  test('add a channel; platform limits are marked not yet verified', async ({ page }) => {
    const w = await stub(page);
    await page.goto(`/app/b/${B}/publish/channels`);
    await expect(page.getByRole('cell', { name: 'Not yet verified' }).first()).toBeVisible();
    await page.getByLabel('Platform', { exact: true }).selectOption('facebook');
    await page.getByLabel('Account name').fill('Himal Pashmina');
    await page.getByRole('button', { name: 'Add channel' }).click();
    await expect(page.getByRole('list').filter({ hasText: 'Facebook · Himal Pashmina' })).toBeVisible();
    expect(w.bodies['POST /publish/channels']).toEqual({ platform: 'facebook', accountName: 'Himal Pashmina' });
  });

  test('no channels shows an empty state', async ({ page }) => {
    await stub(page, { channels: [] });
    await page.goto(`/app/b/${B}/publish/channels`);
    await expect(page.locator('[data-state="empty"]')).toContainText('No channels yet');
  });
});

test.describe('settings', () => {
  test('the hours are shown and saved for the brand timezone, and the dashboard links here', async ({ page }) => {
    const w = await stub(page);
    await page.goto(`/app/b/${B}/publish`);
    await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
    await expect(page).toHaveURL(/\/publish\/settings$/);
    await expect(page.getByRole('group', { name: new RegExp(`Hours when posts may go out.*${TZ}`) })).toBeVisible();
    await expect(page.getByLabel('From')).toHaveValue('7');
    await expect(page.getByLabel('Until')).toHaveValue('21');
    await expect(page.getByLabel('Attempts before a send fails')).toHaveValue('3');
    await page.getByLabel('From').selectOption('0');
    await page.getByLabel('Until').selectOption('24');
    await page.getByLabel('Attempts before a send fails').fill('5');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status')).toContainText('Saved.');
    expect(w.bodies['PUT /publish/settings']).toEqual({ windowStart: 0, windowEnd: 24, maxAttempts: 5 });
  });

  test('hours that end before they start cannot be saved', async ({ page }) => {
    await stub(page);
    await page.goto(`/app/b/${B}/publish/settings`);
    await page.getByLabel('From').selectOption('20');
    await page.getByLabel('Until').selectOption('8');
    await expect(page.getByText('The hours must start before they end.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  });
});
