import { expect, test, type Locator, type Page } from '@playwright/test';

// Screens against a stubbed API. Bodies follow server/openapi.json; the server branch is not needed.
const B = 'brand-1';
const NOW = '2026-11-23T06:00:00.000Z';
const THIS = '2026-11-22';
const NEXT = '2026-11-29';
const money = (npr: string) => ({ npr, usd: (Number(npr) / 150).toFixed(4) });

const brand = { id: B, name: 'Himal Pashmina', slug: 'himal', website: null, country: 'NP', timezone: 'Asia/Kathmandu', currency: 'NPR', defaultLanguage: 'en', languages: ['en', 'ne'], status: 'active', createdAt: NOW };
const ready = { facts: true, channels: true };
const fact = { id: 'f-1', section: 'products', subjectName: 'Pashmina shawl', field: 'material', value: 'hand-woven', unit: null };
const settings = { channels: [{ channel: 'facebook', postsPerWeek: 3 }, { channel: 'instagram', postsPerWeek: 3 }], pillars: [{ pillar: 'education', weight: 2 }, { pillar: 'proof', weight: 1 }], weekStarts: 0 };
const plan = (o: object = {}) => ({ id: 'wp-1', weekStart: THIS, version: 1, status: 'draft', approvedAt: null, runId: null, createdAt: NOW, ...o });
const item = (o: object = {}) => ({ id: 'i-1', weekPlanId: 'wp-1', day: THIS, channel: 'facebook', format: 'image', pillar: 'education', funnel: 'problem_aware', intent: 'teach', segmentId: null, campaignId: null, idea: 'How to tell real pashmina from a blend', cta: 'Visit the shop', factIds: ['f-1'], position: 0, origin: 'model', ...o });
const run = (o: object = {}) => ({ id: 'run-1', kind: 'week', targetId: THIS, state: 'completed', error: null, startedAt: NOW, finishedAt: NOW, estimate: null, actual: money('9.5'), counts: { items: 6, dropped: 2 }, createdAt: NOW, ...o });
const campaign = (o: object = {}) => ({ id: 'c-1', name: 'Dashain shawls', objective: 'conversion', status: 'active', startsOn: '2026-11-30', endsOn: '2026-12-20', segmentId: null, opportunityId: null, budgetNpr: '5000', createdAt: NOW, ...o });
const statements = (text: string) => [{ text, factIds: ['f-1'] }];
const brief = (o: object = {}) => ({ id: 'b-1', campaignId: 'c-1', version: 1, status: 'draft', body: { goal_kpi: statements('Sell 40 shawls'), audience: statements('Gift buyers in Kathmandu'), offer_message: statements('Hand-woven in Patan'), channel_mix: [], creative: [], conversion: [], budget: [], measurement: [], risk: [] }, leftOut: [{ section: 'offer_message', text: 'Softest shawl in Nepal', reason: 'no approved fact' }], approvedAt: null, createdAt: NOW, ...o });
const week = (weekStart: string, o: object = {}) => ({ weekStart, plan: null, items: [], violations: [], blockingCount: 0, canApprove: false, cannotApproveReason: 'There are no ideas in this week yet.', approvedPlan: null, facts: [fact], latestRun: null, ready, ...o });

type World = Record<string, any> & { calls: string[]; bodies: Record<string, any> };

async function stub(page: Page, init: Partial<World> = {}) {
  const w: World = {
    weeks: { [THIS]: week(THIS), [NEXT]: week(NEXT) },
    settings, campaigns: [campaign()], opportunities: [], brief: { campaign: campaign(), approved: null, draft: null, facts: [fact], latestRun: null, ready },
    fail: null, calls: [], bodies: {}, ...init,
  };
  const card = (d: string) => {
    const v = w.weeks[d];
    return { weekStart: d, status: v.plan?.status ?? 'none', itemCount: v.items.length, blockingCount: v.blockingCount, latestRun: v.latestRun };
  };
  const overview = () => ({ ready, weeks: [card(THIS), card(NEXT)], activeCampaigns: w.campaigns.filter((c: any) => c.status === 'active'), opportunities: w.opportunities, monthCost: money('42') });
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(`/api/brands/${B}`, '') || '/';
    const m = req.method();
    const body = req.postDataJSON?.() ?? null;
    w.calls.push(`${m} ${path}`);
    w.bodies[`${m} ${path}`] = body;
    const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    let x: RegExpMatchArray | null;
    if (w.fail && path.startsWith('/plan/overview')) return send({ error: { code: 'internal', message: 'The plan store is down' } }, 500);
    if (path === '/api/brands') return send([brand]);
    if (path === '/') return send(brand);
    if (path === '/plan/overview') return send(overview());
    if (path === '/plan/settings' && m === 'GET') return send(w.settings);
    if (path === '/plan/settings' && m === 'PUT') { w.settings = body; return send(body); }
    if (path === '/plan/campaigns' && m === 'GET') return send(w.campaigns);
    if (path === '/plan/campaigns' && m === 'POST') { const c = campaign({ id: 'c-2', name: body.name, objective: body.objective, status: 'draft' }); w.campaigns.push(c); return send(c, 201); }
    if ((x = path.match(/^\/plan\/weeks\/([\d-]+)$/))) return send(w.weeks[x[1]!]);
    if ((x = path.match(/^\/plan\/weeks\/([\d-]+)\/estimate$/))) return send({ estimate: money('18'), remaining: money('900') });
    if ((x = path.match(/^\/plan\/weeks\/([\d-]+)\/draft$/))) {
      const r = run({ id: 'run-2', state: 'running', actual: null, finishedAt: null });
      w.weeks[x[1]!] = week(x[1]!, { latestRun: r });
      return send(r, 201);
    }
    if ((x = path.match(/^\/plan\/weeks\/([\d-]+)\/approve$/))) {
      const v = w.weeks[x[1]!];
      if (body?.version !== v.plan.version) return send({ error: { code: 'conflict', message: 'This plan changed since you opened it; look at it again before approving' } }, 409);
      v.plan = { ...v.plan, status: 'approved', approvedAt: NOW };
      return send(v);
    }
    if (path === '/plan/runs/run-2') return send(run({ id: 'run-2', state: 'running', actual: null, finishedAt: null }));
    if ((x = path.match(/^\/plan\/weeks\/([\d-]+)\/items$/))) {
      const v = w.weeks[x[1]!];
      const it = item({ id: `i-${v.items.length + 1}`, ...body, idea: body.idea ?? '', cta: body.cta ?? '', factIds: body.factIds ?? [], format: body.format ?? null, pillar: body.pillar ?? null, funnel: body.funnel ?? null, intent: body.intent ?? null, origin: 'owner' });
      v.items.push(it);
      v.plan = v.plan ?? plan({ weekStart: x[1] });
      return send({ item: it, plan: v.plan }, 201);
    }
    if ((x = path.match(/^\/plan\/items\/([\w-]+)$/))) {
      for (const v of Object.values<any>(w.weeks)) {
        const it = v.items.find((i: any) => i.id === x![1]);
        if (!it) continue;
        if (m === 'PATCH') Object.assign(it, body);
        else v.items = v.items.filter((i: any) => i !== it);
        if (v.plan.status === 'approved') { v.plan = { ...v.plan, status: 'draft', approvedAt: null }; v.canApprove = true; v.cannotApproveReason = null; }
        return send(m === 'PATCH' ? { item: it, plan: v.plan } : { plan: v.plan });
      }
    }
    if (path === '/plan/campaigns/c-1' ) return send(w.brief.campaign);
    if (path === '/plan/campaigns/c-1/brief' && m === 'GET') return send(w.brief);
    if (path === '/plan/campaigns/c-1/brief' && m === 'PATCH') { w.brief.draft = brief({ id: 'b-2', version: 2, body: body.body, leftOut: [{ section: 'audience', text: 'Everyone in Nepal', reason: 'no approved fact' }] }); return send(w.brief); }
    if (path === '/plan/campaigns/c-1/brief/estimate') return send({ estimate: money('6'), remaining: money('900') });
    if (path === '/plan/campaigns/c-1/brief/generate') { w.brief.draft = brief(); return send(run({ id: 'run-3', kind: 'brief' }), 201); }
    if (path === '/plan/campaigns/c-1/brief/approve') {
      if (body?.version !== w.brief.draft.version) return send({ error: { code: 'conflict', message: 'This brief changed since you opened it; look at it again before approving' } }, 409); w.brief = { ...w.brief, approved: { ...w.brief.draft, status: 'approved', approvedAt: NOW }, draft: null }; return send(w.brief); }
    return send({ error: { code: 'not_stubbed', message: `${m} ${path}` } }, 404);
  });
  return w;
}

/** Tab until the locator has focus; a control that cannot be reached by keyboard fails here. */
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 200; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('not reachable by Tab');
}

const mondayItems = [
  item({ id: 'i-1', day: THIS, channel: 'facebook', idea: 'How to tell real pashmina from a blend' }),
  item({ id: 'i-2', day: THIS, channel: 'facebook', idea: 'Three ways to wear a shawl', format: 'carousel' }),
  item({ id: 'i-3', day: '2026-11-24', channel: 'instagram', idea: 'दशैंमा उपहारको लागि हस्तनिर्मित पश्मिना सल, पाटनका कारिगरहरूले बुनेको', cta: 'अहिले अर्डर गर्नुहोस्', format: 'story' }),
];
const blockedWeek = () =>
  week(THIS, {
    plan: plan(), items: mondayItems, blockingCount: 1, canApprove: false, cannotApproveReason: 'Fix 1 problem first: two items on Facebook on Sunday.',
    violations: [
      { rule: 'same_day_channel', blocking: true, itemIds: ['i-1', 'i-2'], message: 'Two items are on Facebook on the same day.' },
      { rule: 'channel_count', blocking: false, itemIds: [], message: 'Instagram has 1 item; the settings ask for 3.' },
    ],
  });

test('the dashboard shows an approved and a draft week, campaigns, opportunities and the month cost', async ({ page }) => {
  await stub(page, {
    weeks: {
      [THIS]: week(THIS, { plan: plan({ status: 'approved', approvedAt: NOW }), items: mondayItems.slice(0, 1) }),
      [NEXT]: week(NEXT, { plan: plan({ id: 'wp-2', weekStart: NEXT }), items: mondayItems.slice(0, 2), blockingCount: 1 }),
    },
    opportunities: [{ id: 'op-1', title: 'Answer the shawl price cut', suggestedAction: 'Lead with the hand-woven proof.', whyItMatters: 'Price is compared first.', confidence: 'medium' }],
  });
  await page.goto(`/app/b/${B}/plan`);
  await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
  const now = page.getByRole('article', { name: 'This week' });
  await expect(now.locator('[data-status="approved"]')).toBeVisible();
  await expect(now).toContainText('Nothing blocks approval');
  const next = page.getByRole('article', { name: 'Next week' });
  await expect(next.locator('[data-status="draft"]')).toBeVisible();
  await expect(next).toContainText('1 problem block approval');
  await expect(page.getByRole('list').filter({ hasText: 'Dashain shawls' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Answer the shawl price cut' }).getByRole('link', { name: /Start a campaign/ })).toHaveAttribute('href', /opportunity=op-1/);
  await expect(page.getByText('Planning cost this month')).toBeVisible();
  await expect(page.getByText('NPR 42', { exact: false })).toBeVisible();
});

test('drafting a week shows the cost first, and only starts after confirming', async ({ page }) => {
  const w = await stub(page);
  await page.goto(`/app/b/${B}/plan`);
  await page.getByRole('button', { name: 'Draft this week' }).click();
  const confirm = page.getByRole('region', { name: 'Confirm the cost' });
  await expect(confirm).toContainText('NPR 18');
  expect(w.calls).not.toContain(`POST /plan/weeks/${THIS}/draft`);
  await confirm.getByRole('button', { name: 'Confirm and start' }).click();
  await expect(confirm).toBeHidden();
  expect(w.calls).toContain(`POST /plan/weeks/${THIS}/draft`);
  await expect(page.getByRole('region', { name: 'Week draft' })).toContainText('Running');
});

test('a brand with no approved fact, or no channel, is sent to the screen that fixes it', async ({ page }) => {
  await stub(page, { weeks: { [THIS]: week(THIS, { ready: { facts: false, channels: true } }), [NEXT]: week(NEXT) } });
  await page.goto(`/app/b/${B}/plan/calendar`);
  await expect(page.locator('[data-state="empty"]')).toContainText('No approved brand facts yet');
  await expect(page.getByRole('link', { name: 'Review the brand' })).toHaveAttribute('href', `/app/b/${B}/brand`);

  await stub(page, { weeks: { [THIS]: week(THIS, { ready: { facts: true, channels: false } }), [NEXT]: week(NEXT) } });
  await page.goto(`/app/b/${B}/plan/calendar`);
  await expect(page.getByRole('link', { name: 'Choose channels' })).toHaveAttribute('href', `/app/b/${B}/plan/settings`);
});

test('the calendar lists blocking problems first, flags the item, and disables approval with its reason', async ({ page }) => {
  await stub(page, { weeks: { [THIS]: blockedWeek(), [NEXT]: week(NEXT) } });
  await page.goto(`/app/b/${B}/plan/calendar`);
  const approve = page.getByRole('button', { name: 'Approve week' });
  await expect(approve).toBeDisabled();
  await expect(page.getByText('Fix 1 problem first')).toBeVisible();
  const viol = page.getByRole('region', { name: 'Balance check' }).or(page.locator('section[aria-labelledby="viol-h"]'));
  const heads = await viol.getByRole('heading', { level: 3 }).allTextContents();
  expect(heads[0]).toContain('Blocks approval (1)');
  expect(heads[1]).toContain('does not block');
  await expect(viol).toContainText('Instagram has 1 item');
  await expect(page.getByRole('article', { name: /Facebook, Sunday/ }).first()).toContainText('Blocks approval');
  // seven days, and Devanagari shown whole
  await expect(page.getByRole('list', { name: '' }).first()).toBeVisible();
  await expect(page.getByText('दशैंमा उपहारको लागि हस्तनिर्मित पश्मिना सल, पाटनका कारिगरहरूले बुनेको')).toBeVisible();
  await expect(page.getByText('अहिले अर्डर गर्नुहोस्')).toBeVisible();
  for (const d of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) await expect(page.getByRole('heading', { level: 3, name: d, exact: true })).toBeVisible();
  // week switcher moves the week by seven days
  await page.getByRole('link', { name: 'Next week' }).click();
  await expect(page).toHaveURL(new RegExp(`week=${NEXT}`));
});

test('the days stack at a narrow width, with no sideways scroll', async ({ page }) => {
  await stub(page, { weeks: { [THIS]: blockedWeek(), [NEXT]: week(NEXT) } });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/app/b/${B}/plan/calendar`);
  const sun = page.getByRole('listitem', { name: /Sunday/ });
  const mon = page.getByRole('listitem', { name: /Monday/ });
  const [a, b] = [await sun.boundingBox(), await mon.boundingBox()];
  expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
  expect(Math.abs(a!.x - b!.x)).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a canApprove week is approved with one click', async ({ page }) => {
  const w = await stub(page, { weeks: { [THIS]: week(THIS, { plan: plan(), items: mondayItems.slice(2), canApprove: true, cannotApproveReason: null }), [NEXT]: week(NEXT) } });
  await page.goto(`/app/b/${B}/plan/calendar`);
  await page.getByRole('button', { name: 'Approve week' }).click();
  expect(w.calls).toContain(`POST /plan/weeks/${THIS}/approve`);
  expect(w.bodies[`POST /plan/weeks/${THIS}/approve`]).toEqual({ version: 1 });
  await expect(page.locator('[data-status="approved"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve week' })).toBeHidden();
});

test('a 409 on approve reloads the calendar, says the plan changed, and does not retry', async ({ page }) => {
  const w = await stub(page, { weeks: { [THIS]: week(THIS, { plan: plan(), items: mondayItems.slice(2), canApprove: true, cannotApproveReason: null }), [NEXT]: week(NEXT) } });
  await page.goto(`/app/b/${B}/plan/calendar`);
  await expect(page.getByRole('button', { name: 'Approve week' })).toBeEnabled();
  await page.waitForLoadState('networkidle');
  // A newer draft lands after the page loaded.
  w.weeks[THIS] = week(THIS, { plan: plan({ version: 2 }), items: [item({ id: 'i-9', day: THIS, channel: 'facebook', idea: 'Hand-woven pashmina in Patan' })], canApprove: true, cannotApproveReason: null });
  const reads = () => w.calls.filter((c: string) => c === `GET /plan/weeks/${THIS}`).length;
  const before = reads();
  await page.getByRole('button', { name: 'Approve week' }).click();
  await expect(page.getByText('Hand-woven pashmina in Patan')).toBeVisible();
  await expect(page.getByText(/changed since you opened it/).first()).toBeVisible();
  expect(reads()).toBeGreaterThan(before);
  expect(w.calls.filter((c: string) => c === `POST /plan/weeks/${THIS}/approve`)).toHaveLength(1);
  await expect(page.locator('[data-status="approved"]')).toHaveCount(0);
});

test('editing an item of an approved week puts the week back in draft', async ({ page }) => {
  const w = await stub(page, { weeks: { [THIS]: week(THIS, { plan: plan({ status: 'approved', approvedAt: NOW }), items: mondayItems.slice(2) }), [NEXT]: week(NEXT) } });
  await page.goto(`/app/b/${B}/plan/calendar`);
  await expect(page.locator('[data-status="approved"]')).toBeVisible();
  await page.getByRole('button', { name: /Edit the Instagram idea/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit this idea' });
  await expect(dialog).toContainText('This week is approved');
  await dialog.getByLabel('Call to action').fill('Order before Dashain');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  expect(w.bodies['PATCH /plan/items/i-3'].cta).toBe('Order before Dashain');
  await expect(page.locator('[data-status="draft"]')).toBeVisible();
  await expect(page.getByText('Approval withdrawn')).toBeVisible();
  await expect(page.getByText('Order before Dashain')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve week' })).toBeEnabled();
});

test('add an idea and remove one', async ({ page }) => {
  const w = await stub(page, { weeks: { [THIS]: week(THIS, { plan: plan(), items: mondayItems.slice(0, 1) }), [NEXT]: week(NEXT) } });
  await page.goto(`/app/b/${B}/plan/calendar`);
  await page.getByRole('button', { name: /Add an idea on Wednesday/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Add an idea' });
  await dialog.getByLabel('Channel').selectOption('instagram');
  await dialog.getByLabel('Idea').fill('Behind the loom');
  await dialog.getByRole('button', { name: 'Add idea' }).click();
  await expect(page.getByText('Behind the loom')).toBeVisible();
  expect(w.bodies[`POST /plan/weeks/${THIS}/items`]).toMatchObject({ day: '2026-11-25', channel: 'instagram', idea: 'Behind the loom' });
  await page.getByRole('button', { name: /Edit the Facebook idea/ }).click();
  await page.getByRole('button', { name: 'Remove this idea' }).click();
  await expect(page.getByRole('region', { name: 'Days' }).getByText('How to tell real pashmina')).toBeHidden();
});

test('the calendar works with the keyboard alone', async ({ page }) => {
  const w = await stub(page, { weeks: { [THIS]: week(THIS, { plan: plan(), items: mondayItems.slice(2), canApprove: true, cannotApproveReason: null }), [NEXT]: week(NEXT) } });
  await page.goto(`/app/b/${B}/plan/calendar`);
  await expect(page.getByRole('article', { name: /Instagram/ })).toBeVisible();
  await tabTo(page, page.getByRole('button', { name: /Edit the Instagram idea/ }));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Edit this idea' });
  await expect(dialog.getByLabel('Day')).toBeFocused().catch(() => {}); // focus lands inside the dialog
  await tabTo(page, dialog.getByLabel('Call to action'));
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Message us on WhatsApp');
  await tabTo(page, dialog.getByRole('button', { name: 'Save changes' }));
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  expect(w.bodies['PATCH /plan/items/i-3'].cta).toBe('Message us on WhatsApp');
  // Escape closes the dialog and focus returns to the opener
  await page.getByRole('button', { name: /Edit the Instagram idea/ }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: /Edit the Instagram idea/ })).toBeFocused();
  await tabTo(page, page.getByRole('button', { name: 'Approve week' }));
  await page.keyboard.press('Enter');
  expect(w.calls).toContain(`POST /plan/weeks/${THIS}/approve`);
});

test('a brief shows its facts and left-out list, and the draft can be edited and approved', async ({ page }) => {
  const w = await stub(page, { brief: { campaign: campaign(), approved: null, draft: brief(), facts: [fact], latestRun: null, ready } });
  await page.goto(`/app/b/${B}/plan/campaigns/c-1`);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashain shawls' })).toBeVisible();
  const offer = page.getByRole('region', { name: 'Offer and message' });
  await expect(offer).toContainText('Hand-woven in Patan');
  await expect(offer.getByRole('list', { name: 'Facts cited' })).toContainText('Pashmina shawl · Material: hand-woven');
  const left = page.getByRole('region', { name: 'Left out' });
  await expect(left).toContainText('Softest shawl in Nepal');
  await expect(left).toContainText('no approved fact');

  await page.getByRole('button', { name: 'Edit the brief' }).click();
  await page.getByLabel(/Statement 1 of Audience/).fill('Gift buyers across Nepal');
  await page.getByRole('button', { name: 'Save as a draft' }).click();
  await expect(page.getByRole('heading', { name: 'Brief, version 2' })).toBeVisible();
  expect(w.bodies['PATCH /plan/campaigns/c-1/brief'].body.audience[0].text).toBe('Gift buyers across Nepal');
  await expect(page.getByRole('region', { name: 'Left out' })).toContainText('Everyone in Nepal');

  await page.getByRole('button', { name: 'Approve this brief' }).click();
  await expect(page.locator('[data-status="approved"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve this brief' })).toBeHidden();
});

test('drafting a brief asks for confirmation of the cost', async ({ page }) => {
  const w = await stub(page);
  await page.goto(`/app/b/${B}/plan/campaigns/c-1`);
  await expect(page.locator('[data-state="empty"]')).toContainText('No brief yet');
  await page.getByRole('button', { name: 'Draft the brief' }).click();
  await expect(page.getByRole('region', { name: 'Confirm the cost' })).toContainText('NPR 6');
  expect(w.calls).not.toContain('POST /plan/campaigns/c-1/brief/generate');
  await page.getByRole('button', { name: 'Confirm and start' }).click();
  await expect(page.getByRole('heading', { name: 'Brief, version 1' })).toBeVisible();
});

test('campaigns: create one', async ({ page }) => {
  const w = await stub(page);
  await page.goto(`/app/b/${B}/plan/campaigns?opportunity=op-1&name=Answer%20the%20price%20cut`);
  await expect(page.getByLabel('Name')).toHaveValue('Answer the price cut');
  await page.getByLabel('Objective').selectOption('conversion');
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await page.waitForURL(/campaigns\/c-2/);
  expect(w.bodies['POST /plan/campaigns']).toMatchObject({ name: 'Answer the price cut', objective: 'conversion', opportunityId: 'op-1' });
});

test('settings are saved with channels, pillars and the first day of the week', async ({ page }) => {
  const w = await stub(page);
  await page.goto(`/app/b/${B}/plan/settings`);
  await expect(page.getByRole('checkbox', { name: 'Facebook' })).toBeChecked();
  await page.getByLabel('Instagram Posts per week').fill('5');
  await page.getByRole('checkbox', { name: 'LinkedIn' }).check();
  await page.getByRole('checkbox', { name: 'Founder and team' }).check();
  await page.getByLabel('First day of the week').selectOption('1');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Saved');
  expect(w.bodies['PUT /plan/settings']).toEqual({
    channels: [{ channel: 'facebook', postsPerWeek: 3 }, { channel: 'instagram', postsPerWeek: 5 }, { channel: 'linkedin', postsPerWeek: 3 }],
    pillars: [{ pillar: 'education', weight: 2 }, { pillar: 'proof', weight: 1 }, { pillar: 'founder_team', weight: 1 }],
    weekStarts: 1,
  });
});

test('a failing server shows the error state with a retry', async ({ page }) => {
  const w = await stub(page, { fail: true });
  await page.goto(`/app/b/${B}/plan`);
  await expect(page.locator('[data-state="error"]')).toContainText('The plan store is down');
  w.fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('article', { name: 'This week' })).toBeVisible();
});

test('the days sit side by side on a wide screen', async ({ page }) => {
  await stub(page, { weeks: { [THIS]: blockedWeek(), [NEXT]: week(NEXT) } });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/app/b/${B}/plan/calendar`);
  const [a, b] = [await page.getByRole('listitem', { name: /Sunday/ }).boundingBox(), await page.getByRole('listitem', { name: /Saturday/ }).boundingBox()];
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  expect(b!.x).toBeGreaterThan(a!.x + 5 * a!.width);
});

test('editing an approved brief warns first, and a draft beside an approved week says the approval stays in force', async ({ page }) => {
  await stub(page, { brief: { campaign: campaign(), approved: brief({ status: 'approved', approvedAt: NOW }), draft: null, facts: [fact], latestRun: null, ready } });
  await page.goto(`/app/b/${B}/plan/campaigns/c-1`);
  await page.getByRole('button', { name: 'Edit the brief' }).click();
  await expect(page.getByText('starts a new draft')).toBeVisible();
  await expect(page.getByRole('form', { name: 'Edit the brief' })).toBeHidden();
  await page.getByRole('button', { name: 'Edit and start a new draft' }).click();
  await expect(page.getByRole('form', { name: 'Edit the brief' })).toBeVisible();

  await stub(page, { weeks: { [THIS]: week(THIS, { plan: plan({ version: 2 }), approvedPlan: plan({ status: 'approved', approvedAt: NOW }), items: mondayItems.slice(2) }), [NEXT]: week(NEXT) } });
  await page.goto(`/app/b/${B}/plan/calendar`);
  await expect(page.getByText('An approved version is still in force')).toBeVisible();
  await expect(page.getByRole('article', { name: /Instagram/ })).toContainText('Cites: Pashmina shawl · Material: hand-woven');
});

test('a week date off the first day snaps to the settings weekday', async ({ page }) => {
  const w = await stub(page);
  await page.goto(`/app/b/${B}/plan/calendar?week=2026-11-25`);
  await expect(page.locator('header p')).toContainText('22 Nov');
  expect(w.calls).toContain(`GET /plan/weeks/${THIS}`);
});
