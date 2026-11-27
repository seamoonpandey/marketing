import { expect, test, type Locator, type Page } from '@playwright/test';

// Screens against a stubbed API. Bodies follow server/openapi.json; the server branch is not needed.
const B = 'brand-1';
const NOW = '2026-11-27T06:00:00.000Z';
const brand = { id: B, name: 'Himal Pashmina', slug: 'himal', website: null, country: 'NP', timezone: 'Asia/Kathmandu', currency: 'NPR', defaultLanguage: 'en', languages: ['en', 'ne'], status: 'active', createdAt: NOW };
// A 1x1 PNG, served for every image URL below.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const IMG = 'http://media.test/img';

type Spec = {
  id: string; state?: string; version?: number; hash?: string; channel?: string; day?: string; week?: string; risk?: 'low' | 'medium' | 'high';
  text?: string; kind?: 'post' | 'static' | 'carousel' | 'video'; riskReasons?: string[]; viewed?: boolean; bulkReason?: string | null;
  slides?: string[]; findings?: unknown[]; gone?: boolean; history?: unknown[]; stateReason?: string | null; noteRequired?: boolean;
};
const spec = (s: Spec) => ({
  state: 'waiting', version: 2, hash: `hash-${s.id}-v${s.version ?? 2}`, channel: 'facebook', day: '2026-11-29', week: '2026-11-29', risk: 'low', kind: 'post', riskReasons: [],
  viewed: true, bulkReason: null, slides: [], findings: [], gone: false, history: [], stateReason: null, ...s,
}) as Required<Spec>;

const decision = (o: object = {}) => ({ id: 'dec-1', draftId: 'd-1', version: 2, decision: 'approved', payloadHash: 'h', risk: 'low', reason: null, reviewNote: null, decidedBy: 'Owner', decidedAt: NOW, expiresAt: '2026-12-11T06:00:00.000Z', bulkId: null, ...o });
const paused = (s: Spec) => s.state === 'approved' && w.paused;

function previewOf(s: Required<Spec>) {
  const slides = s.slides.map((headline) => ({ headline }));
  const n = s.kind === 'video' ? 1 : s.kind === 'static' ? 1 : s.slides.length;
  return {
    draftId: s.id, state: s.state, stateReason: s.stateReason, paused: false,
    draft: s.gone ? null : {
      version: s.version, kind: s.kind, status: 'ready', channel: s.channel, day: s.day, weekStart: s.week, pillar: 'offer', campaignId: null,
      content: { copies: [{ language: 'en', sentences: [{ text: s.text, claim: false, factIds: [] }], hashtags: ['pashmina'], cta: 'Order today' }, { language: 'ne', sentences: [{ text: 'हस्तनिर्मित पश्मिना सल, पाटनमा बुनिएको।', claim: false, factIds: [] }], hashtags: [], cta: '' }], slides, scenes: s.kind === 'video' ? [{ onScreenText: 'Woven in Patan', voiceover: '', shot: 'loom', seconds: 5 }] : [], template: 'headline', ratios: ['1:1'] },
      leftOut: [{ language: 'en', text: 'The softest shawl in Nepal', reason: 'no approved fact' }], findings: s.findings, blockingCount: s.findings.length,
      facts: [{ id: 'f-1', section: 'products', subjectName: 'Pashmina shawl', field: 'price', value: 3900, unit: 'NPR', expiresAt: '2027-01-15T00:00:00.000Z' }], missingFactIds: [],
      renders: Array.from({ length: n }, (_, i) => ({ ratio: s.kind === 'video' ? '9:16' : '4:5', width: s.kind === 'video' ? 1080 : 1080, height: s.kind === 'video' ? 1920 : 1350, overflow: i === 1, index: i, type: s.kind === 'video' ? 'video' : 'image', url: `${IMG}/${s.id}-${i}.png` })),
      risk: s.risk, riskReasons: s.riskReasons, payloadHash: s.hash, expiresIfApproved: '2026-12-11T06:00:00.000Z',
      noteRequired: s.noteRequired || s.risk === 'high', canApprove: s.state === 'waiting' && s.findings.length === 0, cannotApproveReason: s.findings.length ? 'A blocking check failed.' : null,
      canReject: s.state === 'waiting', cannotRejectReason: null,
    },
    history: s.history,
  };
}
function itemOf(s: Required<Spec>) {
  const state = paused(s) ? 'paused' : s.state;
  return {
    draftId: s.id, state, stateReason: s.stateReason, latest: null,
    draft: s.gone ? null : {
      version: s.version, kind: s.kind, status: 'ready', channel: s.channel, day: s.day, weekStart: s.week, excerpt: s.text, thumbnailUrl: s.kind === 'post' ? null : `${IMG}/${s.id}-0.png`,
      risk: s.risk, riskReasons: s.riskReasons, payloadHash: s.hash, blockingCount: s.findings.length, viewed: s.viewed, canApprove: s.findings.length === 0, cannotApproveReason: null,
      noteRequired: s.risk === 'high', bulkReason: s.risk === 'high' ? 'High risk items are approved one at a time.' : s.bulkReason,
    },
  };
}

type World = { drafts: Required<Spec>[]; paused: boolean; pausedReason: string | null; calls: string[]; bodies: Record<string, any[]>; conflictOnce: boolean; afterConflict?: Spec };
let w: World;

async function stub(page: Page, drafts: Spec[]) {
  w = { drafts: drafts.map(spec), paused: false, pausedReason: null, calls: [], bodies: {}, conflictOnce: false };
  await page.route('**/img/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(`/api/brands/${B}`, '') || '/';
    const m = req.method();
    const body = req.postDataJSON?.() ?? null;
    w.calls.push(`${m} ${path}`);
    (w.bodies[`${m} ${path}`] ??= []).push(body);
    const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    let x: RegExpMatchArray | null;
    if (path === '/api/brands') return send([brand]);
    if (path === '/') return send(brand);
    if (path === '/approve/queue') {
      const only = url.searchParams.get('state');
      const all = w.drafts.map(itemOf);
      const counts = Object.fromEntries(['waiting', 'approved', 'rejected', 'invalid', 'expired', 'paused'].map((k) => [k, all.filter((i) => i.state === k).length]));
      return send({ summary: { counts, paused: w.paused, pausedReason: w.pausedReason, pausedAt: w.paused ? NOW : null, monthDecisions: 3 }, items: all.filter((i) => !only || i.state === only) });
    }
    if ((x = path.match(/^\/approve\/queue\/([\w-]+)$/))) {
      const s = w.drafts.find((d) => d.id === x![1])!;
      return send({ ...previewOf(s), paused: w.paused, state: paused(s) ? 'paused' : s.state });
    }
    if ((x = path.match(/^\/approve\/queue\/([\w-]+)\/(approve|reject)$/))) {
      const s = w.drafts.find((d) => d.id === x![1])!;
      if (w.conflictOnce) {
        w.conflictOnce = false;
        const v = w.afterConflict!.version!;
        Object.assign(s, w.afterConflict, { hash: `hash-${s.id}-v${v}` });
        return send({ error: { code: 'conflict', message: 'changed since you opened it' } }, 409);
      }
      s.state = x[2] === 'approve' ? 'approved' : 'rejected';
      s.history = [decision({ draftId: s.id, version: s.version, decision: s.state, reason: body.reason ?? null, reviewNote: body.reviewNote ?? null, risk: s.risk })];
      return send(previewOf(s));
    }
    if (path === '/approve/bulk-approve') {
      for (const i of body.items) w.drafts.find((d) => d.id === i.draftId)!.state = 'approved';
      return send({ bulkId: 'bulk-1', decisions: body.items.map((i: any) => decision({ draftId: i.draftId, bulkId: 'bulk-1' })) });
    }
    if (path === '/approve/pause' || path === '/approve/resume') {
      w.paused = path === '/approve/pause';
      w.pausedReason = w.paused ? body.reason : null;
      return send({ maxAgeDays: 14, approvers: [], paused: w.paused, pausedReason: w.pausedReason, pausedAt: w.paused ? NOW : null });
    }
    return send({ error: { code: 'not_stubbed', message: `${m} ${path}` } }, 404);
  });
}

/** Tab until the locator has focus; a control that cannot be reached by keyboard fails here. */
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('not reachable by Tab');
}

const ONE_EACH: Spec[] = [
  { id: 'd-waiting', state: 'waiting', text: 'Waiting shawl post' },
  { id: 'd-approved', state: 'approved', text: 'Approved shawl post', day: '2026-11-30' },
  { id: 'd-rejected', state: 'rejected', text: 'Rejected shawl post', day: '2026-11-30' },
  { id: 'd-invalid', state: 'invalid', text: 'Invalid shawl post', stateReason: 'Edited after approval.', day: '2026-12-01' },
  { id: 'd-expired', state: 'expired', text: 'Expired shawl post', stateReason: 'Approval ran out on 20 Nov 2026.', day: '2026-12-01' },
  { id: 'd-paused', state: 'paused', text: 'दशैं विशेष छुट — सुपर पश्मिना सल रु ३,९०० मा, पाटनमा हातले बुनिएको', day: '2026-12-02' },
];

test('the queue shows one item in each state, by day, with counts and a filter', async ({ page }) => {
  await stub(page, ONE_EACH);
  await page.goto(`/app/b/${B}/approve`);
  for (const s of ['waiting', 'approved', 'rejected', 'invalid', 'expired', 'paused']) await expect(page.locator(`[data-approve-state="${s}"]`)).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 2, name: /Sun, 29 Nov 2026|Sun 29 Nov 2026/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /दशैं विशेष छुट — सुपर पश्मिना सल रु ३,९०० मा, पाटनमा हातले बुनिएको/ })).toBeVisible();
  await expect(page.getByText('Edited after approval.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Waiting for you/ })).toContainText('1');
  await page.getByRole('button', { name: /^Rejected/ }).click();
  await expect(page.locator('[data-approve-state]')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Rejected shawl post' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Waiting shawl post' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Expired/ }).click();
  await page.getByRole('button', { name: 'All' }).click();
  await expect(page.getByRole('link', { name: 'Waiting shawl post' })).toBeVisible();
});

test('an empty queue says what to expect', async ({ page }) => {
  await stub(page, []);
  await page.goto(`/app/b/${B}/approve`);
  await expect(page.locator('[data-state="empty"]')).toContainText('Nothing to approve yet');
});

test('approving a low-risk item sends the hash it showed', async ({ page }) => {
  await stub(page, [{ id: 'd-1', text: 'Hand-woven pashmina, Rs 3,900.', kind: 'static', risk: 'low' }]);
  await page.goto(`/app/b/${B}/approve/d-1`);
  await expect(page.getByRole('heading', { level: 1, name: 'Approve version 2' })).toBeVisible();
  const as = page.getByRole('region', { name: 'Exactly as it will appear' });
  await expect(as).toContainText('Hand-woven pashmina, Rs 3,900.');
  await expect(as).toContainText('Order today');
  await expect(as.getByText('हस्तनिर्मित पश्मिना सल, पाटनमा बुनिएको।')).toBeVisible();
  await expect(as.getByRole('img', { name: /^Image, size 4:5/ })).toHaveAttribute('width', '1080');
  await expect(page.getByText('Pashmina shawl: price = 3900 NPR')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Left out' })).toContainText('The softest shawl in Nepal');
  await expect(page.getByRole('complementary', { name: 'Decision' })).toContainText('If anyone edits this draft afterwards, your approval is undone');
  await page.getByRole('button', { name: 'Approve version 2' }).click();
  await expect(page.getByRole('heading', { name: 'You approved this version' })).toBeVisible();
  expect(w.bodies['POST /approve/queue/d-1/approve']).toEqual([{ payloadHash: 'hash-d-1-v2' }]);
  await expect(page.getByRole('list').filter({ hasText: 'by Owner' })).toBeVisible();
});

test('a carousel shows every slide in order at its true shape, each with alternative text', async ({ page }) => {
  await stub(page, [{ id: 'd-1', text: 'Three shawls.', kind: 'carousel', slides: ['One', 'Two', 'Three'] }]);
  await page.goto(`/app/b/${B}/approve/d-1`);
  const imgs = page.getByRole('region', { name: 'Size 4:5' }).getByRole('img');
  await expect(imgs).toHaveCount(3);
  await expect(imgs.nth(0)).toHaveAttribute('alt', 'Slide 1 of 3, size 4:5. Text: One');
  await expect(imgs.nth(2)).toHaveAttribute('alt', 'Slide 3 of 3, size 4:5. Text: Three');
  for (let i = 0; i < 3; i++) { await expect(imgs.nth(i)).toHaveAttribute('width', '1080'); await expect(imgs.nth(i)).toHaveAttribute('height', '1350'); }
  await expect(page.getByText('The text may not fit at this size.')).toBeVisible(); // slide 2 overflows
});

test('a video preview is a video with its own text alternative', async ({ page }) => {
  await stub(page, [{ id: 'd-1', text: 'Watch it woven.', kind: 'video' }]);
  await page.goto(`/app/b/${B}/approve/d-1`);
  await expect(page.locator('video')).toHaveAttribute('aria-label', 'Video, size 9:16. Text: Woven in Patan');
});

test('a high-risk item cannot be approved until the review note is long enough', async ({ page }) => {
  await stub(page, [{ id: 'd-1', text: 'A guaranteed cure.', risk: 'high', riskReasons: ['The copy says "guaranteed".'] }]);
  await page.goto(`/app/b/${B}/approve/d-1`);
  await expect(page.getByRole('list', { name: 'Why this risk' })).toContainText('The copy says "guaranteed".');
  const approve = page.getByRole('button', { name: 'Approve version 2' });
  const note = page.getByLabel(/Review note/);
  await expect(approve).toBeDisabled();
  await expect(page.getByText('20 more characters needed.')).toBeVisible();
  await note.fill('Checked claim');
  await expect(page.getByText('7 more characters needed.')).toBeVisible();
  await expect(approve).toBeDisabled();
  await note.fill('Checked the claim with the lab.');
  await expect(page.getByText('Note is long enough.')).toBeVisible();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByRole('heading', { name: 'You approved this version' })).toBeVisible();
  expect(w.bodies['POST /approve/queue/d-1/approve']).toEqual([{ payloadHash: 'hash-d-1-v2', reviewNote: 'Checked the claim with the lab.' }]);
});

test('rejecting needs a reason', async ({ page }) => {
  await stub(page, [{ id: 'd-1', text: 'A post.' }]);
  await page.goto(`/app/b/${B}/approve/d-1`);
  await expect(page.getByLabel('Why are you rejecting it?')).toHaveCount(0); // not one click away from approve
  await page.getByRole('button', { name: 'Reject this version…' }).click();
  const send = page.getByRole('button', { name: 'Send rejection' });
  await expect(send).toBeDisabled();
  await page.getByLabel(/Why are you rejecting it/).fill('Wrong price');
  await send.click();
  await expect(page.getByRole('heading', { name: 'You rejected this version' })).toBeVisible();
  expect(w.bodies['POST /approve/queue/d-1/reject']).toEqual([{ payloadHash: 'hash-d-1-v2', reason: 'Wrong price' }]);
  await expect(page.getByText('Reason: Wrong price')).toBeVisible();
});

test('a draft that changed is reloaded, said so, and not retried', async ({ page }) => {
  await stub(page, [{ id: 'd-1', text: 'The first wording.' }]);
  await page.goto(`/app/b/${B}/approve/d-1`);
  await expect(page.getByText('The first wording.')).toBeVisible();
  w.conflictOnce = true;
  w.afterConflict = { id: 'd-1', version: 3, text: 'The second wording.' };
  await page.getByRole('button', { name: 'Approve version 2' }).click();
  const notice = page.getByRole('alert').filter({ hasText: 'This draft changed since you opened it.' });
  await expect(notice).toContainText('Nothing was approved or rejected');
  await expect(page.getByText('The second wording.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Approve version 3' })).toBeVisible();
  expect(w.bodies['POST /approve/queue/d-1/approve']).toEqual([{ payloadHash: 'hash-d-1-v2' }]); // one try, with the old hash
  await page.getByRole('button', { name: 'Approve version 3' }).click();
  await expect(page.getByRole('heading', { name: 'You approved this version' })).toBeVisible();
  expect(w.bodies['POST /approve/queue/d-1/approve']?.[1]).toEqual({ payloadHash: 'hash-d-1-v3' });
});

test('a draft Studio no longer has shows its history instead of failing', async ({ page }) => {
  await stub(page, [{ id: 'd-1', text: 'Gone', gone: true, state: 'invalid', history: [decision({ draftId: 'd-1' })] }]);
  await page.goto(`/app/b/${B}/approve/d-1`);
  await expect(page.locator('[data-state="stale"]')).toContainText('Studio no longer has this draft');
  await expect(page.getByText('Approved version 2 by Owner')).toBeVisible();
});

test('bulk selection explains why an item cannot join, then approves two valid items', async ({ page }) => {
  await stub(page, [
    { id: 'a', text: 'Alpha post', channel: 'facebook' },
    { id: 'b', text: 'Beta post', channel: 'facebook' },
    { id: 'c', text: 'Gamma post', channel: 'instagram' },
    { id: 'h', text: 'Hazard post', channel: 'facebook', risk: 'high' },
    { id: 'n', text: 'Unopened post', channel: 'facebook', viewed: false, bulkReason: 'Open it in the preview first.' },
  ]);
  await page.goto(`/app/b/${B}/approve`);
  const box = (name: string) => page.getByRole('checkbox', { name: new RegExp(name) });
  await expect(page.getByText('High risk items are approved one at a time.')).toBeVisible(); // before anything is selected
  await expect(page.getByText('Open it in the preview first.')).toBeVisible();
  await box('Alpha').check();
  await expect(page.getByText(/A bulk approval covers one channel\. Your selection is facebook, this is instagram\./)).toBeVisible();
  await box('Gamma').click({ force: true });
  await expect(box('Gamma')).not.toBeChecked();
  await box('Beta').check();
  const bar = page.getByRole('region', { name: 'Bulk approval' });
  await expect(bar).toContainText('2 selected');
  await bar.getByRole('button', { name: 'Approve 2 selected' }).click();
  await expect(page.getByRole('region', { name: 'Bulk approval' })).toHaveCount(0);
  expect(w.bodies['POST /approve/bulk-approve']).toEqual([{ items: [{ draftId: 'a', payloadHash: 'hash-a-v2' }, { draftId: 'b', payloadHash: 'hash-b-v2' }] }]);
  await expect(page.locator('[data-approve-state="approved"]')).toHaveCount(2);
});

test('pausing needs a reason, and approved items then show as paused; resuming reverses it', async ({ page }) => {
  await stub(page, [{ id: 'a', text: 'Approved one', state: 'approved' }, { id: 'b', text: 'Waiting one' }]);
  await page.goto(`/app/b/${B}/approve`);
  await expect(page.locator('[data-approve-state="approved"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Pause approvals…' }).click();
  const go = page.getByRole('button', { name: 'Pause approvals', exact: true });
  await expect(go).toBeDisabled();
  await page.getByLabel('Reason').fill('Wrong price in the offer');
  await go.click();
  await expect(page.getByRole('heading', { name: 'Approvals are paused' })).toBeVisible();
  await expect(page.getByText(/Wrong price in the offer/)).toBeVisible();
  await expect(page.locator('[data-approve-state="paused"]')).toHaveCount(1);
  await expect(page.locator('[data-approve-state="approved"]')).toHaveCount(0);
  expect(w.bodies['POST /approve/pause']).toEqual([{ reason: 'Wrong price in the offer' }]);
  await page.getByRole('button', { name: 'Resume approvals…' }).click();
  await page.getByLabel('Reason').fill('Price fixed');
  await page.getByRole('button', { name: 'Resume approvals', exact: true }).click();
  await expect(page.locator('[data-approve-state="approved"]')).toHaveCount(1);
});

test('the queue works by keyboard alone: select an item, open another', async ({ page }) => {
  await stub(page, [{ id: 'a', text: 'Alpha post' }, { id: 'b', text: 'Beta post' }]);
  await page.goto(`/app/b/${B}/approve`);
  await expect(page.getByRole('link', { name: 'Alpha post' })).toBeVisible();
  await tabTo(page, page.getByRole('button', { name: /^Waiting for you/ }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('checkbox', { name: /Alpha/ }));
  await page.keyboard.press('Space');
  await expect(page.getByRole('region', { name: 'Bulk approval' })).toContainText('1 selected');
  await tabTo(page, page.getByRole('link', { name: 'Beta post' }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/approve/b$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Approve version 2' })).toBeVisible();
  await tabTo(page, page.getByRole('button', { name: 'Approve version 2' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'You approved this version' })).toBeVisible();
});

test('shows the error state when the API fails', async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === `/api/brands/${B}` || p === '/api/brands') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(p === '/api/brands' ? [brand] : brand) });
    return route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' });
  });
  await page.goto(`/app/b/${B}/approve`);
  const state = page.locator('[data-state="error"]');
  await expect(state).toBeVisible({ timeout: 15_000 });
  await expect(state).toContainText('could not be loaded');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});
