// One collector per module. Each reads only through that module's index.ts, never recomputes a module's
// rules, and answers the items it owns plus one status line for the module strip.
import type { Tx } from '../../db/tenant.ts';
import { listCompetitors } from '../brands/index.ts';
import { listFacts, listImports, approvedFacts, readiness } from '../knowledge/index.ts';
import { addDays, currentBrief, getSettings as planSettings, latestRun as planLatestRun, listCampaigns, overview as planOverview } from '../plan/index.ts';
import { listObservations, listOpportunities, listRuns } from '../research/index.ts';
import { studioOverview } from '../studio/index.ts';
import { queue } from '../approve/index.ts';
import { summary as publishSummary } from '../publish/index.ts';
import type { Item } from './rank.ts';
import type { Readers } from './index.ts';

export type Ctx = { brandId: string; now: Date; timezone: string; today: string; readers: Readers };
export type Collected = { items: Item[]; status: string; extra?: Record<string, unknown> };
type Mod = Item['module'];

const DAY = 86_400_000;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const app = (c: Ctx, path: string) => `/app/b/${c.brandId}${path}`;
const first = (isos: (string | null)[]) => isos.filter((s): s is string => !!s).sort()[0] ?? null;

/** The instant a calendar day starts in a timezone (an invalid timezone reads as UTC). */
export function startOfDay(day: string, timezone: string): string {
  const utc = Date.parse(`${day}T00:00:00Z`);
  const offset = (t: number) => {
    try {
      const p = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
          .formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]),
      );
      return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(t / 1000) * 1000;
    } catch {
      return 0;
    }
  };
  return new Date(utc - offset(utc - offset(utc))).toISOString();
}

const make = (kind: string, module: Mod, urgency: Item['urgency'], title: string, detail: string, href: string, o: { count?: number | null; due?: string | null } = {}): Item => ({
  kind, module, urgency, title, detail, href, count: o.count ?? null, due: o.due ?? null,
});
const confirm = (module: Mod, n: number, href: string): Item =>
  make('run_confirm', module, 'today', n === 1 ? 'A run is waiting for your cost confirmation' : `${n} runs are waiting for your cost confirmation`,
    'Nothing is spent until you accept the estimate.', href, { count: n === 1 ? null : n });

export async function publish(tx: Tx, c: Ctx): Promise<Collected> {
  const facts = await approvedFacts(tx, c.brandId);
  const s = await publishSummary(tx, c.brandId, c.readers.publish, facts, c.now);
  const items: Item[] = [];
  const href = (jobs: { id: string }[]) => (jobs.length === 1 ? app(c, `/publish/jobs/${jobs[0]!.id}`) : app(c, '/publish'));
  const n = s.manualNow.length;
  if (n) items.push(make('publish_manual', 'publish', 'now', n === 1 ? 'A post is ready to publish by hand' : `${n} posts are ready to publish by hand`,
    'Post it on the platform, then confirm it with its link.', href(s.manualNow), { count: n === 1 ? null : n, due: first(s.manualNow.map((j) => j.dueAt)) }));
  const unknown = s.attention.filter((j) => j.state === 'unknown');
  const stuck = s.attention.filter((j) => j.state !== 'unknown');
  if (unknown.length) items.push(make('publish_unknown', 'publish', 'now', unknown.length === 1 ? 'A post may or may not have gone out' : `${unknown.length} posts may or may not have gone out`,
    'The send did not finish, so nothing is sent again until you say whether it was posted.', href(unknown), { count: unknown.length === 1 ? null : unknown.length, due: first(unknown.map((j) => j.dueAt)) }));
  if (stuck.length) items.push(make('publish_stuck', 'publish', 'now', stuck.length === 1 ? 'A post is blocked or failed' : `${stuck.length} posts are blocked or failed`,
    'It was not published; retry it, post it by hand or cancel it.', href(stuck), { count: stuck.length === 1 ? null : stuck.length, due: first(stuck.map((j) => j.dueAt)) }));
  const upcoming = s.upcoming.map((j) => ({ title: j.excerpt || `A ${j.channel?.platform ?? ''} post`.replace('  ', ' '), at: j.dueAt, href: app(c, `/publish/jobs/${j.id}`) }));
  const status = !s.hasChannels ? 'No channel connected' : s.upcoming.length ? `${plural(s.upcoming.length, 'post', 'posts')} scheduled in the next 7 days` : 'Nothing scheduled in the next 7 days';
  return { items, status, extra: { upcoming } };
}

export async function approve(tx: Tx, c: Ctx): Promise<Collected> {
  const q = await queue(tx, c.brandId, await approvedFacts(tx, c.brandId), c.readers.studio);
  const items: Item[] = [];
  const blocked = q.items.filter((i) => i.draft && i.draft.blockingCount > 0 && i.state !== 'rejected');
  const live = q.items.filter((i) => !blocked.includes(i));
  const waiting = live.filter((i) => i.state === 'waiting' && i.draft);
  const tomorrow = addDays(c.today, 1);
  const soonest = waiting.filter((i) => i.draft!.day <= tomorrow);
  const later = waiting.filter((i) => i.draft!.day > tomorrow);
  const dayDue = (xs: typeof waiting) => xs.map((i) => startOfDay(i.draft!.day, c.timezone)).sort()[0] ?? null;
  const go = (xs: { draftId: string }[]) => (xs.length === 1 ? app(c, `/approve/${xs[0]!.draftId}`) : app(c, '/approve'));
  const waits = (n: number) => `${plural(n, 'draft is', 'drafts are')} waiting for your approval`;
  if (soonest.length) items.push(make('approvals_due', 'approve', 'today', waits(soonest.length), 'They are planned for today or tomorrow and nothing goes out without your approval.', go(soonest), { count: soonest.length === 1 ? null : soonest.length, due: dayDue(soonest) }));
  if (later.length) items.push(make('approvals_waiting', 'approve', 'soon', waits(later.length), 'They are ready; approving them keeps the week on schedule.', go(later), { count: later.length === 1 ? null : later.length, due: dayDue(later) }));
  const lapsed = live.filter((i) => i.state === 'expired' || i.state === 'invalid');
  if (lapsed.length) items.push(make('approvals_lapsed', 'approve', 'soon', lapsed.length === 1 ? 'An approval has lapsed' : `${lapsed.length} approvals have lapsed`,
    'An approval expired or no longer holds, so the draft will not go out until it is approved again.', go(lapsed), { count: lapsed.length === 1 ? null : lapsed.length }));
  if (blocked.length) items.push(make('drafts_blocked', 'studio', 'soon', blocked.length === 1 ? 'A draft has a blocking finding' : `${blocked.length} drafts have a blocking finding`,
    'A check found something that must be fixed before it can be approved.', blocked.length === 1 ? app(c, `/studio/drafts/${blocked[0]!.draftId}`) : app(c, '/studio'), { count: blocked.length === 1 ? null : blocked.length }));
  return {
    items, status: waiting.length ? `${plural(waiting.length, 'draft', 'drafts')} waiting for approval` : 'Nothing waiting for approval',
    extra: { paused: q.summary.paused ? { reason: q.summary.pausedReason, at: q.summary.pausedAt } : null },
  };
}

export async function studio(tx: Tx, c: Ctx): Promise<Collected> {
  const o = await studioOverview(tx, c.brandId, undefined, await approvedFacts(tx, c.brandId));
  const items: Item[] = [];
  const missing = o.items.filter((i) => !i.draft);
  if (missing.length) items.push(make('drafts_missing', 'studio', 'soon', missing.length === 1 ? 'An item of this week has no draft yet' : `${missing.length} items of this week have no draft yet`,
    'The plan is approved; Studio writes the posts.', app(c, '/studio'), { count: missing.length === 1 ? null : missing.length, due: first(missing.map((i) => startOfDay(i.item.day, c.timezone))) }));
  if (o.latestRun?.state === 'awaiting_approval') items.push(confirm('studio', 1, app(c, '/studio')));
  const status = !o.planApproved ? 'No approved plan this week' : `${o.items.length - missing.length} of ${plural(o.items.length, 'item', 'items')} drafted this week`;
  return { items, status };
}

export async function plan(tx: Tx, c: Ctx): Promise<Collected> {
  const o = await planOverview(tx, c.brandId, await approvedFacts(tx, c.brandId));
  const items: Item[] = [];
  const ready = o.ready.facts && o.ready.channels;
  if (o.ready.facts && !o.ready.channels)
    items.push(make('setup_channels', 'plan', 'later', 'Choose the channels you post on', 'Plan needs at least one channel and a posts-per-week target before it can draft a week.', app(c, '/plan/settings')));
  const open = ready ? o.weeks.filter((w) => w.status !== 'approved') : [];
  if (open.length) {
    const [thisWeek] = o.weeks;
    const both = open.length === 2;
    items.push(make('plan_week_missing', 'plan', 'soon', both ? 'This week and next week have no approved plan' : open[0] === thisWeek ? 'This week has no approved plan' : 'Next week has no approved plan',
      'Studio writes posts only for approved plan items.', app(c, `/plan/calendar?week=${open[0]!.weekStart}`), { due: startOfDay(open[0]!.weekStart, c.timezone) }));
  }
  const runs = o.weeks.filter((w) => w.latestRun?.state === 'awaiting_approval').length;
  const waiting: string[] = [];
  let briefRuns = 0;
  for (const camp of await listCampaigns(tx, c.brandId)) {
    if (camp.status !== 'draft' && camp.status !== 'active') continue;
    if ((await currentBrief(tx, c.brandId, camp.id)).draft) waiting.push(camp.id);
    if ((await planLatestRun(tx, c.brandId, 'brief', camp.id))?.state === 'awaiting_approval') briefRuns++;
  }
  if (runs + briefRuns) items.push(confirm('plan', runs + briefRuns, app(c, '/plan')));
  if (waiting.length) items.push(make('brief_waiting', 'plan', 'soon', waiting.length === 1 ? 'A campaign brief is waiting for your approval' : `${waiting.length} campaign briefs are waiting for your approval`,
    'The brief fixes what a campaign says; plans cite it once it is approved.', waiting.length === 1 ? app(c, `/plan/campaigns/${waiting[0]}`) : app(c, '/plan/campaigns'), { count: waiting.length === 1 ? null : waiting.length }));
  const status = o.weeks.map((w, i) => `${i ? 'Next' : 'This'} week: ${w.status === 'none' ? 'no plan' : w.status}`).join(', ');
  return { items, status };
}

export async function research(tx: Tx, c: Ctx): Promise<Collected> {
  const items: Item[] = [];
  const runs = (await listRuns(tx, c.brandId)).filter((r) => r.state === 'awaiting_approval').length;
  if (runs) items.push(confirm('research', runs, app(c, '/research')));
  const seen = await listObservations(tx, c.brandId, { since: new Date(c.now.getTime() - 7 * DAY).toISOString() });
  if (seen.length) items.push(make('observations_new', 'research', 'later', seen.length === 1 ? 'A competitor change was seen this week' : `${seen.length} competitor changes were seen this week`,
    'Read what changed and whether it needs an answer.', app(c, '/research'), { count: seen.length === 1 ? null : seen.length }));
  const opps = await listOpportunities(tx, c.brandId, 'new');
  if (opps.length) items.push(make('opportunities_new', 'research', 'later', opps.length === 1 ? 'An opportunity is waiting for a decision' : `${opps.length} opportunities are waiting for a decision`,
    'Accept the ones worth a campaign and dismiss the rest.', app(c, '/research/opportunities'), { count: opps.length === 1 ? null : opps.length }));
  const channels = (await planSettings(tx, c.brandId)).channels.length > 0;
  const hasFacts = (await approvedFacts(tx, c.brandId)).length > 0;
  const competitors = await listCompetitors(tx, c.brandId);
  if (hasFacts && channels && !competitors.length)
    items.push(make('setup_competitor', 'research', 'later', 'Add a competitor to watch', 'Research needs at least one competitor before it can watch for changes.', app(c, '/research')));
  return { items, status: opps.length ? `${plural(opps.length, 'opportunity', 'opportunities')} to decide` : competitors.length ? `${plural(competitors.length, 'competitor', 'competitors')} watched` : 'No competitor yet' };
}

export async function brand(tx: Tx, c: Ctx): Promise<Collected> {
  const items: Item[] = [];
  const approvedCount = (await approvedFacts(tx, c.brandId)).length;
  const imports = await listImports(tx, c.brandId);
  const run = imports.filter((r) => r.state === 'awaiting_approval').length;
  if (run) items.push(confirm('brand', run, app(c, '/brand/sources')));
  const pending = [...(await listFacts(tx, c.brandId, { status: 'unverified', limit: 1000 })).items, ...(await listFacts(tx, c.brandId, { status: 'inferred', limit: 1000 })).items];
  const conflicts = (await listFacts(tx, c.brandId, { status: 'conflicting', limit: 1000 })).items;
  if (!approvedCount && !pending.length && !conflicts.length) {
    // A new brand: the first step is its sources, unless an import is already on its way.
    const busy = imports.some((r) => ['running', 'awaiting_approval', 'completed'].includes(r.state));
    if (!busy)
      items.push(make('setup_import', 'brand', 'today', 'Add your brand\'s sources and import',
        imports.length ? 'The last import did not finish; add or fix the sources and import again.' : 'Prachaar writes only from facts you approve; the import reads your site and files and proposes them.', app(c, '/brand/sources')));
  }
  if (conflicts.length) items.push(make('facts_conflicts', 'brand', 'soon', conflicts.length === 1 ? 'A fact has two answers' : `${conflicts.length} facts have two answers`,
    'Sources disagree; pick the one that is true.', app(c, '/brand/review?status=conflicting'), { count: conflicts.length === 1 ? null : conflicts.length }));
  if (pending.length) items.push(make('facts_review', 'brand', approvedCount ? 'soon' : 'today', approvedCount ? (pending.length === 1 ? 'A fact is waiting for review' : `${pending.length} facts are waiting for review`) : 'Review the facts we found',
    approvedCount ? 'Only approved facts reach a draft.' : 'Approve the true ones; nothing can be planned or written until at least one fact is approved.', app(c, '/brand/review'), { count: pending.length === 1 ? null : pending.length }));
  if (approvedCount) {
    const r = await readiness(tx, c.brandId);
    const missing = r.dimensions.flatMap((d) => d.criteria.filter((x) => !x.pass));
    if (r.gates.length) items.push(make('readiness_gates', 'brand', 'later', r.gates.length === 1 ? 'A readiness gate is blocking the brand' : `${r.gates.length} readiness gates are blocking the brand`,
      r.gates[0]!.label, r.gates[0]!.fixPath, { count: r.gates.length === 1 ? null : r.gates.length }));
    if (missing.length) items.push(make('readiness_missing', 'brand', 'later', missing.length === 1 ? 'A readiness criterion is missing' : `${missing.length} readiness criteria are missing`,
      `Readiness is ${r.score} of 100; next: ${missing[0]!.label.toLowerCase()}.`, missing[0]!.fixPath, { count: missing.length === 1 ? null : missing.length }));
    return { items, status: `Readiness ${r.score} of 100` };
  }
  return { items, status: pending.length ? `${plural(pending.length, 'fact', 'facts')} to review` : 'No facts yet' };
}
