import { expect, test, type Locator, type Page } from '@playwright/test';

// Studio screens against a stubbed API. Bodies follow server/openapi.json; the server branch is not needed.
const B = 'brand-1';
const NOW = '2026-11-27T06:00:00.000Z';
const WEEK = '2026-11-29';
const money = (npr: string) => ({ npr: Number(npr).toFixed(2), usd: (Number(npr) / 150).toFixed(4) });
const brand = { id: B, name: 'Himal Pashmina', slug: 'himal', website: null, country: 'NP', timezone: 'Asia/Kathmandu', currency: 'NPR', defaultLanguage: 'en', languages: ['en', 'ne'], status: 'active', createdAt: NOW };

// A 1x1 PNG; the previews are drawn at the sizes the contract names, not at the file's own.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const IMG = 'https://img.test/render.png';
const VID = 'https://img.test/render.mp4';

const planItem = (id: string, o: object = {}) => ({ id, day: WEEK, channel: 'instagram', format: 'carousel', idea: `Idea ${id}`, cta: 'Visit the shop', kind: 'carousel', ...o });
const card = (id: string, o: object = {}) => ({ id, kind: 'carousel', status: 'draft', currentVersion: 1, blockingCount: 0, thumbnailUrl: null, ...o });
const run = (o: object = {}) => ({ id: 'run-1', kind: 'generate', targets: ['pi-3'], state: 'running', error: null, startedAt: NOW, finishedAt: null, estimate: money('12'), actual: null, counts: {}, createdAt: NOW, ...o });
const sentence = (text: string, claim = false, factIds: string[] = []) => ({ text, claim, factIds });
const fact = { id: 'f-1', section: 'products', subjectName: 'Pashmina shawl', field: 'price', value: 4500, unit: 'NPR' };
const NEPALI = 'हिमालयको चिसोमा न्यानो पश्मिना, हातले बुनेको र नेपालमै बनाइएको';

const overview = (o: object = {}) => ({
  weekStart: WEEK, planApproved: true, ready: { facts: true }, latestRun: null, monthCost: money('38.5'),
  items: [
    { item: planItem('pi-1', { idea: 'Winter shawl carousel' }), draft: card('d-1', { blockingCount: 2, thumbnailUrl: IMG }) },
    { item: planItem('pi-2', { channel: 'facebook', format: 'text', kind: 'post', idea: 'Dashain greeting' }), draft: card('d-2', { kind: 'post', status: 'ready', currentVersion: 2 }) },
    { item: planItem('pi-3', { day: '2026-11-30', idea: 'Behind the loom video', format: 'short_video', kind: 'video' }), draft: null },
  ],
  ...o,
});

const render = (ratio: string, width: number, height: number, index = 0, extra: object = {}) => ({ ratio, width, height, overflow: false, index, type: 'image', url: IMG, ...extra });
const view = (o: Record<string, any> = {}) => ({
  draft: { id: 'd-1', planItemId: 'pi-1', kind: 'post', status: 'draft', currentVersion: 1, readyVersion: null, readyAt: null, createdAt: NOW },
  version: { version: 1, origin: 'model', createdAt: NOW },
  versions: [{ version: 1, origin: 'model', createdAt: NOW }],
  planItem: planItem('pi-1', { kind: 'post', format: 'text', idea: 'Winter shawl post' }),
  planApproved: true, channel: 'instagram', languages: ['en', 'ne'], missingLanguages: [],
  content: {
    copies: [
      { language: 'en', sentences: [sentence('Hand-woven in Patan.'), sentence('Priced at NPR 4,500.', true, ['f-1'])], hashtags: ['pashmina'], cta: 'Visit the shop' },
      { language: 'ne', sentences: [sentence(NEPALI)], hashtags: [], cta: 'पसल भ्रमण गर्नुहोस्' },
    ],
    slides: [], scenes: [], template: 'headline', ratios: ['1:1'],
  },
  leftOut: [{ language: 'en', text: 'The lowest price in Kathmandu', reason: 'no approved fact' }],
  facts: [fact],
  findings: [
    { check: 'many_hashtags', blocking: false, where: 'hashtags en', message: 'There are 12 hashtags; 10 or fewer read better.' },
    { check: 'unverified_number', blocking: true, where: 'caption en', message: '15 is not in any cited fact.' },
  ],
  blockingCount: 1, renders: [], canMarkReady: false, cannotMarkReadyReason: '1 blocking finding: fix the unverified number first.', latestRun: null,
  ...o,
});
const visualView = (o: Record<string, any> = {}) => {
  const slides = [{ headline: 'Winter warmth' }, { headline: 'हिमाल पश्मिना — १५% छुट', subline: 'Hand-woven' }, { headline: 'Visit us' }];
  return view({
    draft: { id: 'd-1', planItemId: 'pi-1', kind: 'carousel', status: 'draft', currentVersion: 1, readyVersion: null, readyAt: null, createdAt: NOW },
    content: { ...view().content, slides, ratios: ['1:1', '9:16'] },
    findings: [{ check: 'not_rendered', blocking: true, where: 'carousel', message: 'This version has no render.' }],
    blockingCount: 1, cannotMarkReadyReason: 'Render the slides first.',
    ...o,
  });
};
const sized = () => [0, 1, 2].flatMap((i) => [render('1:1', 1080, 1080, i), render('9:16', 1080, 1920, i)]);

type World = { calls: string[]; bodies: any[]; overview: any; draft: any; runs: any[] };

async function stub(page: Page, init: Partial<World> & { failOverview?: boolean; failDraft?: boolean } = {}) {
  const w: World = { calls: [], bodies: [], overview: overview(), draft: view(), runs: [], ...init };
  await page.route('https://img.test/**', (r) =>
    r.request().url().endsWith('.mp4') ? r.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.alloc(0) }) : r.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(`/api/brands/${B}`, '') || '/';
    const m = req.method();
    const body = req.postDataJSON?.() ?? null;
    w.calls.push(`${m} ${path}`);
    w.bodies.push({ m, path, body });
    const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const fail = (status: number, code: string, message: string) => send({ error: { code, message } }, status);
    let x: RegExpMatchArray | null;
    if (path === '/api/brands') return send([brand]);
    if (path === '/') return send(brand);
    if (path === '/studio/overview') return init.failOverview ? fail(500, 'internal', 'The overview broke.') : send(w.overview);
    if (path === '/studio/templates') {
      return send({
        templates: [{ name: 'headline', label: 'Headline', description: 'A big line of text' }, { name: 'offer', label: 'Offer', description: 'A badge and a price' }, { name: 'quote', label: 'Quote', description: 'A customer quote' }],
        ratios: [{ ratio: '1:1', width: 1080, height: 1080, label: 'Square' }, { ratio: '4:5', width: 1080, height: 1350, label: 'Portrait' }, { ratio: '9:16', width: 1080, height: 1920, label: 'Story' }, { ratio: '16:9', width: 1920, height: 1080, label: 'Wide' }],
      });
    }
    if (path === '/studio/drafts/estimate') return send({ estimate: money('18'), remaining: money('960'), count: body.planItemIds.length });
    if (path === '/studio/drafts' && m === 'POST') {
      w.runs = [run({ targets: body.planItemIds })];
      return send(w.runs[0], 201);
    }
    if ((x = path.match(/^\/studio\/drafts\/([\w-]+)$/))) {
      if (init.failDraft) return fail(500, 'internal', 'The draft broke.');
      if (m === 'PATCH') {
        const c = w.draft.content;
        w.draft = { ...w.draft, draft: { ...w.draft.draft, status: 'draft', currentVersion: w.draft.version.version + 1 }, version: { version: w.draft.version.version + 1, origin: 'owner', createdAt: NOW }, content: { ...c, ...body, copies: c.copies.map((k: any) => body.copies?.find((n: any) => n.language === k.language) ?? k) }, renders: [], canMarkReady: true, cannotMarkReadyReason: null, findings: [], blockingCount: 0 };
      }
      return send(w.draft);
    }
    if (path === '/studio/drafts/d-1/render') {
      w.runs = [run({ id: 'run-r', kind: 'render', targets: ['d-1'] })];
      return send(w.runs[0], 201);
    }
    if (path === '/studio/drafts/d-1/ready') {
      w.draft = { ...w.draft, draft: { ...w.draft.draft, status: 'ready', readyVersion: w.draft.version.version, readyAt: NOW } };
      return send(w.draft);
    }
    if ((x = path.match(/^\/studio\/runs\/([\w-]+)$/))) {
      const r = w.runs.find((r) => r.id === x![1]) ?? run({ id: x![1], state: 'completed' });
      // The first poll is still running; the next one finishes and the results appear.
      if (r.polled) {
        r.state = 'completed';
        r.counts = r.kind === 'generate' ? { drafted: r.targets.length, failed: 0 } : { rendered: 6 };
        if (r.kind === 'generate') w.overview = { ...w.overview, items: w.overview.items.map((i: any) => (r.targets.includes(i.item.id) ? { ...i, draft: card('d-9', { kind: i.item.kind }) } : i)) };
        else w.draft = { ...w.draft, renders: sized(), findings: [], blockingCount: 0, canMarkReady: true, cannotMarkReadyReason: null };
      }
      r.polled = true;
      return send(r);
    }
    return fail(404, 'not_stubbed', `${m} ${path}`);
  });
  return w;
}

/** Tab until the locator has focus; a control that cannot be reached by keyboard fails here. */
async function tabTo(page: Page, target: Locator, key = 'Tab') {
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press(key);
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('not reachable by keyboard');
}

test('dashboard shows drafted, ready and undrafted items by day, with the month cost', async ({ page }) => {
  await stub(page);
  await page.goto(`/app/b/${B}/studio`);
  await expect(page.getByRole('heading', { name: 'Studio', exact: true })).toBeVisible();
  const drafted = page.getByRole('article', { name: 'Instagram carousel' });
  await expect(drafted.getByText('Winter shawl carousel', { exact: true })).toBeVisible();
  await expect(drafted.getByText('Draft', { exact: true })).toBeVisible();
  await expect(drafted.getByText('2 blocking')).toBeVisible();
  await expect(drafted.getByRole('img', { name: /First image/ })).toBeVisible();
  await expect(drafted.getByRole('link', { name: /Open draft/ })).toHaveAttribute('href', `/app/b/${B}/studio/drafts/d-1`);
  const ready = page.getByRole('article', { name: 'Facebook text post' });
  await expect(ready.getByText('Ready', { exact: true })).toBeVisible();
  const undrafted = page.getByRole('article', { name: 'Instagram video' });
  await expect(undrafted.getByText('Not drafted')).toBeVisible();
  await expect(undrafted.getByRole('button', { name: /Draft/ })).toBeEnabled();
  await expect(page.getByRole('heading', { name: /Sunday/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Monday/ })).toBeVisible();
  await expect(page.getByText('NPR 38.50')).toBeVisible();
});

test('the week switcher asks for the next week', async ({ page }) => {
  const w = await stub(page);
  await page.goto(`/app/b/${B}/studio`);
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page).toHaveURL(/week=2026-12-06/);
  await expect.poll(() => w.calls.includes('GET /studio/overview')).toBe(true);
  expect(w.bodies.filter((b) => b.path === '/studio/overview').length).toBeGreaterThan(1);
});

test('a week with no approved plan says so and links to the Plan calendar', async ({ page }) => {
  await stub(page, { overview: overview({ planApproved: false, items: [] }) });
  await page.goto(`/app/b/${B}/studio`);
  await expect(page.getByText('This week has no approved plan')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the Plan calendar' })).toHaveAttribute('href', new RegExp(`/app/b/${B}/plan`));
  await expect(page.getByRole('button', { name: /Draft all/ })).toHaveCount(0);
});

test('Draft all asks for the cost first, then follows the run until the items are drafted', async ({ page }) => {
  const w = await stub(page);
  await page.goto(`/app/b/${B}/studio`);
  await page.getByRole('button', { name: 'Draft all (1)' }).click();
  const confirm = page.getByRole('region', { name: 'Confirm the cost' });
  await expect(confirm).toContainText('NPR 18.00');
  await expect(confirm).toContainText('NPR 960.00');
  expect(w.calls).not.toContain('POST /studio/drafts');
  await confirm.getByRole('button', { name: 'Confirm and start' }).click();
  await expect(page.getByRole('region', { name: 'Writing drafts' })).toBeVisible();
  expect(w.bodies.find((b) => b.m === 'POST' && b.path === '/studio/drafts')!.body).toEqual({ planItemIds: ['pi-3'] });
  await expect(page.getByText('1 drafted.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('article', { name: 'Instagram video' }).getByRole('link', { name: /Open draft/ })).toBeVisible();
});

test('a single item can be drafted through the same confirmation, and can be declined', async ({ page }) => {
  const w = await stub(page);
  await page.goto(`/app/b/${B}/studio`);
  await page.getByRole('article', { name: 'Instagram video' }).getByRole('button', { name: /Draft/ }).click();
  await page.getByRole('region', { name: 'Confirm the cost' }).getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('region', { name: 'Confirm the cost' })).toHaveCount(0);
  expect(w.calls).not.toContain('POST /studio/drafts');
});

test('drafting is blocked with its reason while the brand has no approved fact', async ({ page }) => {
  await stub(page, { overview: overview({ ready: { facts: false } }) });
  await page.goto(`/app/b/${B}/studio`);
  await expect(page.getByText('Drafting needs an approved fact')).toBeVisible();
  await expect(page.getByRole('button', { name: /Draft all/ })).toBeDisabled();
});

test('the editor shows copy with cited facts, the left-out claim and findings with blocking first, and Mark ready is disabled with its reason', async ({ page }) => {
  await stub(page);
  await page.goto(`/app/b/${B}/studio/drafts/d-1`);
  await expect(page.getByRole('heading', { name: 'Winter shawl post' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1 thing blocks Ready' })).toBeVisible();
  const items = page.getByRole('region', { name: /thing blocks Ready/ }).getByRole('listitem');
  await expect(items.nth(0)).toContainText('Number not in a cited fact');
  await expect(items.nth(0)).toContainText('Blocks Ready');
  await expect(items.nth(1)).toContainText('Advice only');
  await expect(page.getByText('The lowest price in Kathmandu')).toBeVisible();
  await expect(page.getByText('Fact: Pashmina shawl · price: 4500 NPR')).toBeVisible();
  await expect(page.getByLabel('Sentence 1 in नेपाली (Nepali)')).toHaveValue(NEPALI);
  const mark = page.getByRole('button', { name: 'Mark ready' });
  await expect(mark).toBeDisabled();
  await expect(page.getByText('1 blocking finding: fix the unverified number first.')).toBeVisible();
  // Devanagari is never clipped: the box grows to its text.
  const box = await page.getByLabel('Sentence 1 in नेपाली (Nepali)').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
});

test('a text post says it has no picture', async ({ page }) => {
  await stub(page);
  await page.goto(`/app/b/${B}/studio/drafts/d-1`);
  await expect(page.getByText('A text post has no picture')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Render/ })).toHaveCount(0);
});

test('editing a ready draft sends it back to draft as a new version', async ({ page }) => {
  const w = await stub(page, { draft: view({ draft: { ...view().draft, status: 'ready', readyVersion: 1, readyAt: NOW }, findings: [], blockingCount: 0, canMarkReady: true, cannotMarkReadyReason: null }) });
  await page.goto(`/app/b/${B}/studio/drafts/d-1`);
  await expect(page.getByText('Ready as version 1')).toBeVisible();
  await page.getByLabel('Sentence 1 in English').fill('Hand-woven in Patan, Nepal.');
  await expect(page.getByText(/Saving makes version 2 and puts this draft back to draft/)).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Ready as version 1')).toHaveCount(0);
  await expect(page.getByText('Version 2, written by you')).toBeVisible();
  const patch = w.bodies.find((b) => b.m === 'PATCH')!.body;
  expect(patch.baseVersion).toBe(1);
  expect(patch.copies.find((c: any) => c.language === 'en').sentences[0].text).toBe('Hand-woven in Patan, Nepal.');
  await expect(page.getByRole('button', { name: 'Mark ready' })).toBeEnabled();
});

test('marking a draft ready sends the request and shows the ready version', async ({ page }) => {
  const w = await stub(page, { draft: view({ findings: [], blockingCount: 0, canMarkReady: true, cannotMarkReadyReason: null }) });
  await page.goto(`/app/b/${B}/studio/drafts/d-1`);
  await page.getByRole('button', { name: 'Mark ready' }).click();
  await expect(page.getByText('Ready as version 1')).toBeVisible();
  expect(w.calls).toContain('POST /studio/drafts/d-1/ready');
});

test('Render costs NPR 0, follows its run, and then shows the slides in order at two sizes with their pixel size', async ({ page }) => {
  const w = await stub(page, { draft: visualView() });
  await page.goto(`/app/b/${B}/studio/drafts/d-1`);
  await expect(page.getByText('Not rendered yet')).toBeVisible();
  const btn = page.getByRole('button', { name: /^Render/ });
  await expect(btn).toContainText('NPR 0');
  await btn.click();
  await expect(page.getByRole('region', { name: 'Rendering' })).toBeVisible();
  expect(w.calls).toContain('POST /studio/drafts/d-1/render');
  const previews = page.getByRole('region', { name: 'Rendered previews' });
  await expect(previews.getByRole('img')).toHaveCount(3, { timeout: 15_000 });
  await expect(previews.getByRole('img').nth(0)).toHaveAccessibleName('Slide 1 of 3 at 1:1');
  await expect(previews.getByRole('img').nth(2)).toHaveAccessibleName('Slide 3 of 3 at 1:1');
  await expect(previews.getByText('1:1 · 1080 × 1080 px').first()).toBeVisible();
  const ratioOf = async (i: number) => previews.getByRole('img').nth(i).evaluate((el: HTMLImageElement) => el.getBoundingClientRect().width / el.getBoundingClientRect().height);
  expect(await ratioOf(0)).toBeCloseTo(1, 1);
  await previews.getByRole('button', { name: /9:16/ }).click();
  await expect(previews.getByRole('img').nth(0)).toHaveAccessibleName('Slide 1 of 3 at 9:16');
  await expect(previews.getByText('9:16 · 1080 × 1920 px').first()).toBeVisible();
  expect(await ratioOf(0)).toBeCloseTo(1080 / 1920, 1);
  await expect(page.getByRole('button', { name: 'Mark ready' })).toBeEnabled();
});

test('a slide that overflows is flagged on its preview', async ({ page }) => {
  await stub(page, { draft: visualView({ renders: [render('1:1', 1080, 1080, 0, { overflow: true }), render('1:1', 1080, 1080, 1)] }) });
  await page.goto(`/app/b/${B}/studio/drafts/d-1`);
  await expect(page.getByText('Text does not fit')).toHaveCount(1);
});

test('a video draft has a native player with controls and the script beside it, and a render note', async ({ page }) => {
  const scenes = [
    { onScreenText: 'Spun by hand', voiceover: 'Every thread is spun by hand in Patan.', shot: 'Close-up of the loom', seconds: 4 },
    { onScreenText: 'पश्मिनाको न्यानोपन', voiceover: 'नेपालमै बनाइएको', shot: 'Shawl on a shoulder', seconds: 5 },
  ];
  await stub(page, {
    draft: view({
      draft: { ...view().draft, kind: 'video' },
      content: { ...view().content, scenes, ratios: ['9:16'] },
      renders: [render('9:16', 1080, 1920, 0, { type: 'video', url: VID }), render('9:16', 1080, 1920, 0), render('9:16', 1080, 1920, 1)],
      findings: [], blockingCount: 0, canMarkReady: true, cannotMarkReadyReason: null,
      latestRun: run({ id: 'run-v', kind: 'render', state: 'completed', error: 'The video engine is not available, so the images were kept.' }),
    }),
  });
  await page.goto(`/app/b/${B}/studio/drafts/d-1`);
  const video = page.getByLabel('Video, 9:16');
  await expect(video).toHaveAttribute('controls', '');
  await expect(page.getByText('9:16 · 1080 × 1920 px').first()).toBeVisible();
  await expect(page.getByLabel('On screen, scene 1')).toHaveValue('Spun by hand');
  await expect(page.getByLabel('On screen, scene 2')).toHaveValue('पश्मिनाको न्यानोपन');
  await expect(page.getByLabel('Voiceover, scene 1')).toHaveValue('Every thread is spun by hand in Patan.');
  await expect(page.getByLabel('Seconds, scene 2')).toHaveValue('5');
  await expect(page.getByRole('img', { name: 'Scene 2 of 2 at 9:16' })).toBeVisible();
});

test('the editor is usable by keyboard alone: edit a sentence, save, mark ready', async ({ page }) => {
  const w = await stub(page, { draft: view({ findings: [], blockingCount: 0, canMarkReady: true, cannotMarkReadyReason: null }) });
  await page.goto(`/app/b/${B}/studio/drafts/d-1`);
  const save = page.getByRole('button', { name: 'Save changes' });
  await expect(save).toBeDisabled();
  await tabTo(page, page.getByLabel('Sentence 1 in English'));
  await page.keyboard.type(' Made to last.');
  await expect(save).toBeEnabled();
  await tabTo(page, save, 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Version 2, written by you')).toBeVisible();
  expect(w.calls).toContain('PATCH /studio/drafts/d-1');
  await tabTo(page, page.getByRole('button', { name: 'Mark ready' }));
  await page.keyboard.press('Enter');
  await expect(page.getByText('Ready as version 2')).toBeVisible();
});

test('a draft whose week is no longer approved stays readable and says it is stale', async ({ page }) => {
  await stub(page, { draft: view({ planApproved: false, planItem: null }) });
  await page.goto(`/app/b/${B}/studio/drafts/d-1`);
  await expect(page.getByText('This plan item is no longer approved')).toBeVisible();
  await expect(page.getByLabel('Sentence 1 in English')).toBeVisible();
});

test('a language the model left empty is offered for writing', async ({ page }) => {
  await stub(page, { draft: view({ missingLanguages: ['ne'], content: { ...view().content, copies: [view().content.copies[0]] } }) });
  await page.goto(`/app/b/${B}/studio/drafts/d-1`);
  await expect(page.getByText('The model wrote nothing in this language')).toBeVisible();
  await expect(page.getByLabel('Sentence 1 in नेपाली (Nepali)')).toHaveValue('');
});

test('errors show an error state with a way to retry', async ({ page }) => {
  await stub(page, { failOverview: true, failDraft: true });
  await page.goto(`/app/b/${B}/studio`);
  await expect(page.getByRole('alert').filter({ hasText: 'could not be loaded' })).toContainText('The overview broke.');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.goto(`/app/b/${B}/studio/drafts/d-1`);
  await expect(page.getByRole('alert').filter({ hasText: 'The draft could not be loaded' })).toContainText('The draft broke.');
});
