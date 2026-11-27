'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BellRing, CircleAlert, CircleCheck, CircleHelp, OctagonAlert, PauseCircle } from 'lucide-react';
import Link from 'next/link';
import { MoneyText, PageHeader, StateBlock, useBrandId } from '@/components/app';
import { api, ApiError, unwrap, type Schemas } from '@/lib/api/client';
import { NAV } from '@/nav';

type Home = Schemas['Home'];
type Item = Schemas['HomeItem'];
type Urgency = Item['urgency'];

const MODULE_NAME: Record<Schemas['HomeModule'], string> = { publish: 'Publish', approve: 'Approve', studio: 'Studio', plan: 'Plan', research: 'Research', brand: 'Brand' };
const NAV_ID: Record<Schemas['HomeModule'], string> = { publish: 'publish', approve: 'approve', studio: 'studio', plan: 'plan', research: 'research', brand: 'brand' };

/** What the one button says, by kind. Unknown kinds fall back to Open. */
const ACTION: Record<string, string> = {
  publish_manual: 'Post and confirm', publish_unknown: 'Say whether it posted', publish_stuck: 'Fix the posts',
  approvals_due: 'Review and approve', approvals_waiting: 'Review and approve', approvals_lapsed: 'Approve again', drafts_blocked: 'Fix the draft',
  drafts_missing: 'Write the drafts', plan_week_missing: 'Plan the week', brief_waiting: 'Review the brief', run_confirm: 'Confirm the cost',
  observations_new: 'See what changed', opportunities_new: 'Decide', facts_conflicts: 'Resolve', facts_review: 'Review the facts',
  readiness_gates: 'Fix it', readiness_missing: 'See what is missing', setup_import: 'Add sources', setup_channels: 'Choose channels', setup_competitor: 'Add a competitor',
};

const GROUPS: { urgency: Urgency; heading: string }[] = [
  { urgency: 'now', heading: 'Needs you now' },
  { urgency: 'today', heading: 'Today' },
  { urgency: 'soon', heading: 'Coming up' },
  { urgency: 'later', heading: 'When you have time' },
];

export function useHome(brandId: string) {
  return useQuery({
    queryKey: ['home', brandId],
    queryFn: () => unwrap(api.GET('/api/brands/{brandId}/home', { params: { path: { brandId } } })),
  });
}

/** "Fri 28 Nov, 15:30"; a day with no time of its own (midnight in the zone) shows the date only. */
export function when(iso: string, timezone: string): string {
  const o = (x: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, ...x }).format(new Date(iso));
  const date = o({ weekday: 'short', day: 'numeric', month: 'short' });
  const time = o({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return time === '00:00' ? date : `${date}, ${time}`;
}

export function Home() {
  const brandId = useBrandId()!;
  const q = useHome(brandId);
  return (
    <>
      <PageHeader title="Today" description="What needs your attention across Prachaar, most urgent first." />
      {q.isPending ? <StateBlock state="loading" title="Loading today’s work" rows={4} /> : null}
      {q.isError ? (
        <StateBlock
          state={q.error instanceof ApiError && q.error.status === 429 ? 'rate_limited' : 'error'}
          title="Today’s work could not be loaded"
          action={<button type="button" className="btn btn-secondary" onClick={() => q.refetch()}>Try again</button>}
        >
          {q.error.message}
        </StateBlock>
      ) : null}
      {q.data ? <Loaded h={q.data} /> : null}
    </>
  );
}

function Loaded({ h }: { h: Home }) {
  const tz = h.brand.timezone;
  return (
    <div className="grid gap-8">
      {h.paused ? <PausedBanner h={h} /> : null}
      {h.partial.length ? (
        <StateBlock state="partial" size="inline" title={`${h.partial.map((m) => MODULE_NAME[m]).join(', ')} did not answer`}>
          Their items are left out below, so this list may be missing some work. Reload to try again.
        </StateBlock>
      ) : null}

      <section aria-labelledby="queue-h" className="grid gap-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 id="queue-h" className="text-xl font-semibold">The queue</h2>
          <p className="text-sm text-muted">Times are in {tz}.</p>
        </div>
        {h.items.length === 0 ? <Nothing h={h} /> : GROUPS.map((g) => <Group key={g.urgency} g={g} items={h.items.filter((i) => i.urgency === g.urgency)} h={h} />)}
      </section>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Modules h={h} />
        <Costs h={h} />
      </div>
    </div>
  );
}

function PausedBanner({ h }: { h: Home }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-x-4 gap-y-3 rounded-lg border border-danger sm:flex-row bg-[color-mix(in_oklab,var(--theme-danger)_9%,transparent)] p-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
      <PauseCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
      <div className="grid min-w-0 gap-0.5">
        <p className="font-semibold">Approvals are paused for {h.brand.name}</p>
        <p className="text-sm break-words">{h.paused!.reason ?? 'No reason was given.'}</p>
        <p className="text-sm text-muted">Nothing is approved or published while the pause lasts.</p>
      </div>
      </div>
      <Link href={`/app/b/${h.brand.id}/approve`} className="btn btn-secondary">Open Approve</Link>
    </div>
  );
}

function Group({ g, items, h }: { g: { urgency: Urgency; heading: string }; items: Item[]; h: Home }) {
  if (!items.length) return null;
  const quiet = g.urgency === 'later';
  return (
    <div className="grid gap-3">
      <h3 className={quiet ? 'text-sm font-semibold text-muted' : g.urgency === 'now' ? 'text-lg font-semibold text-danger' : 'text-base font-semibold'}>{g.heading}</h3>
      <ol className={quiet ? 'divide-y divide-line border-y border-line' : 'grid gap-3'}>
        {items.map((i) => <Row key={`${i.kind}-${i.module}`} i={i} h={h} />)}
      </ol>
    </div>
  );
}

function Row({ i, h }: { i: Item; h: Home }) {
  const tz = h.brand.timezone;
  const overdue = i.due !== null && Date.parse(i.due) < Date.parse(h.now) && (i.urgency === 'now' || i.urgency === 'today');
  const action = ACTION[i.kind] ?? 'Open';
  const due = i.due ? (
    <p className={`text-sm num ${overdue ? 'font-semibold text-danger' : 'text-muted'}`}>
      {overdue ? 'Overdue: was due ' : 'Due '}{when(i.due, tz)} <span className="text-muted">({tz})</span>
    </p>
  ) : null;
  const button = (cls: string) => (
    <Link href={i.href} className={`btn ${cls} shrink-0 ${i.urgency === 'later' ? '' : 'max-sm:w-full'}`}>
      {action}<span className="sr-only">: {i.title}</span><ArrowRight className="size-4" aria-hidden />
    </Link>
  );
  const text = (titleCls: string) => (
    <div className="grid min-w-0 flex-1 gap-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`${titleCls} break-words`}>{i.title}</span>
        <span className="rounded-full bg-[color-mix(in_oklab,var(--theme-ink)_7%,transparent)] px-2 py-0.5 text-xs font-medium text-muted">{MODULE_NAME[i.module]}</span>
      </p>
      <p className={`break-words ${i.urgency === 'later' ? 'text-sm text-muted' : 'text-muted'}`}>{i.detail}</p>
      {due}
    </div>
  );
  if (i.urgency === 'now')
    return (
      <li>
        <article data-urgency="now" className="flex flex-wrap items-start gap-x-4 gap-y-4 rounded-lg border-2 border-danger bg-[color-mix(in_oklab,var(--theme-danger)_8%,var(--color-panel))] p-5 sm:flex-nowrap">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-danger text-bg" aria-hidden><OctagonAlert className="size-5" /></span>
          {text('text-lg font-semibold')}
          {button('btn-primary')}
        </article>
      </li>
    );
  if (i.urgency === 'later')
    return (
      <li>
        <article data-urgency="later" className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 sm:flex-nowrap">
          {text('font-medium')}
          {button('btn-quiet')}
        </article>
      </li>
    );
  return (
    <li>
      <article data-urgency={i.urgency} className="panel flex flex-wrap items-start gap-x-4 gap-y-3 p-4 sm:flex-nowrap">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[color-mix(in_oklab,var(--theme-highlight)_30%,transparent)]" aria-hidden>
          {i.urgency === 'today' ? <BellRing className="size-4" /> : <CircleAlert className="size-4" />}
        </span>
        {text('font-semibold')}
        {button(i.urgency === 'today' ? 'btn-primary' : 'btn-secondary')}
      </article>
    </li>
  );
}

function Nothing({ h }: { h: Home }) {
  return (
    <div className="grid gap-5">
      <StateBlock state="empty" title="Nothing needs your attention" action={null}>
        Every module is up to date. The queue fills up again when something needs a decision.
      </StateBlock>
      <div className="grid gap-2">
        <h3 className="text-base font-semibold">Scheduled next</h3>
        {h.upcoming.length === 0 ? (
          <p className="text-sm text-muted">No posts are scheduled. <Link className="underline" href={`/app/b/${h.brand.id}/publish`}>Open Publish</Link> to schedule an approved draft.</p>
        ) : (
          <ul className="panel divide-y divide-line">
            {h.upcoming.map((u) => (
              <li key={u.href}>
                <Link href={u.href} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-[color-mix(in_oklab,var(--theme-ink)_4%,transparent)]">
                  <span className="min-w-0 break-words font-medium">{u.title}</span>
                  <span className="num text-sm text-muted">{when(u.at, h.brand.timezone)} ({h.brand.timezone})</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Modules({ h }: { h: Home }) {
  return (
    <section aria-labelledby="mods-h" className="grid gap-3">
      <h2 id="mods-h" className="text-xl font-semibold">The six modules</h2>
      <ul className="grid gap-2 grid-cols-2 xl:grid-cols-3">
        {h.modules.map((m) => {
          const Icon = NAV.find((n) => n.id === NAV_ID[m.module])!.icon;
          return (
            <li key={m.module}>
              <Link href={m.href} className="panel grid h-full gap-1 p-3 hover:border-line-strong">
                <span className="flex items-center gap-2 font-semibold"><Icon className="size-4 text-brand" strokeWidth={1.75} aria-hidden />{MODULE_NAME[m.module]}</span>
                {m.status === null ? (
                  <span className="flex items-center gap-1.5 text-sm text-muted"><CircleHelp className="size-3.5" aria-hidden />Did not answer</span>
                ) : (
                  <span className="flex items-start gap-1.5 text-sm text-muted"><CircleCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />{m.status}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Costs({ h }: { h: Home }) {
  const c = h.costs;
  return (
    <section aria-labelledby="cost-h" className="grid gap-3">
      <h2 id="cost-h" className="text-xl font-semibold">AI cost this month</h2>
      {c === null ? (
        <StateBlock state="partial" size="inline" title="The cost could not be read" />
      ) : (
        <div className="panel grid gap-3 p-4">
          <dl className="grid gap-2">
            {c.byModule.map((m) => (
              <div key={m.module} className="flex items-baseline justify-between gap-4">
                <dt className="text-muted">{MODULE_NAME[m.module]}</dt>
                <dd><MoneyText value={m.cost} /></dd>
              </div>
            ))}
          </dl>
          <p className="flex items-baseline justify-between gap-4 border-t border-line pt-3 font-semibold">
            <span>Total</span>
            <MoneyText value={c.total} />
          </p>
        </div>
      )}
    </section>
  );
}
