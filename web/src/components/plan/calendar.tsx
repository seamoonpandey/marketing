'use client';

import { Plus, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Async, MutationError, PageHeader, StateBlock, StatusBadge, Time, useBrandId, WeekNav } from '@/components/app';
import { api, unwrap } from '@/lib/api/client';
import { DraftWeek } from './draft-week';
import { ItemDialog } from './item-dialog';
import { factText, useSettings, useAct, useCampaigns, useOverview, useWeek, type FactRef, type Item, type Week } from './lib';
import { addDays, formatYmd, weekRange, weekStartOf } from '@/lib/time';
import { label } from '@/lib/labels';

export function Calendar() {
  const brandId = useBrandId()!;
  const asked = useSearchParams().get('week');
  const overview = useOverview(brandId);
  const first = useSettings(brandId).data?.weekStarts;
  // The API refuses a week that does not start on the settings' first day, so snap a typed date to it.
  const snap = (iso: string) => (first === undefined ? iso : weekStartOf(iso, first));
  const weekStart = asked ? snap(asked) : overview.data?.weeks[0]?.weekStart;
  const week = useWeek(brandId, weekStart);
  const base = `/app/b/${brandId}/plan`;
  const thisWeek = overview.data?.weeks[0]?.weekStart;
  return (
    <>
      <PageHeader
        title="Calendar"
        description={weekStart ? weekRange(weekStart) : undefined}
        actions={
          weekStart ? (
            <WeekNav
              prev={{ href: `${base}/calendar?week=${addDays(weekStart, -7)}` }}
              next={{ href: `${base}/calendar?week=${addDays(weekStart, 7)}` }}
              today={thisWeek && weekStart !== thisWeek ? { href: `${base}/calendar?week=${thisWeek}` } : null}
            />
          ) : null
        }
      />
      {asked && first !== undefined ? <Board brandId={brandId} q={week} thisWeek={thisWeek} /> : <Async q={overview} what="plan">{() => <Board brandId={brandId} q={week} thisWeek={thisWeek} />}</Async>}
    </>
  );
}

function Board({ brandId, q, thisWeek }: { brandId: string; q: ReturnType<typeof useWeek>; thisWeek?: string }) {
  return <Async q={q} what="week">{(w) => <WeekView brandId={brandId} w={w} thisWeek={thisWeek} />}</Async>;
}

type Editing = { item: Item } | { day: string } | null;

function WeekView({ brandId, w, thisWeek }: { brandId: string; w: Week; thisWeek?: string }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [withdrawn, setWithdrawn] = useState(false);
  const campaigns = useCampaigns(brandId);
  const approve = useAct(brandId, (version: number) => unwrap(api.POST('/api/brands/{brandId}/plan/weeks/{weekStart}/approve', { params: { path: { brandId, weekStart: w.weekStart } }, body: { version } })));
  const days = Array.from({ length: 7 }, (_, i) => addDays(w.weekStart, i));
  const blocked = new Set(w.violations.filter((v) => v.blocking).flatMap((v) => v.itemIds));
  const flagged = new Set(w.violations.filter((v) => !v.blocking).flatMap((v) => v.itemIds));
  const status = w.plan?.status ?? 'none';
  const approved = status === 'approved';
  const byId = new Map(w.items.map((i) => [i.id, i]));
  const blocking = w.violations.filter((v) => v.blocking);
  const advisory = w.violations.filter((v) => !v.blocking);
  const reason = w.cannotApproveReason ?? (w.items.length === 0 ? 'There are no ideas in this week yet.' : 'Something still blocks approval.');
  const campaignName = (id: string | null) => campaigns.data?.find((c) => c.id === id)?.name;

  return (
    <div className="grid gap-6">
      <section aria-label="Approval" className="panel flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={status === 'none' ? 'not_drafted' : status} />
          <span className="num text-sm text-muted">{w.items.length} idea{w.items.length === 1 ? '' : 's'}</span>
        </div>
        {approved ? (
          <p className="text-sm text-muted">Approved{w.plan?.approvedAt ? <> on <Time iso={w.plan.approvedAt} year /></> : null}. Changing an idea sets the week back to draft.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p id="approve-reason" className={`max-w-[48ch] text-sm ${w.canApprove ? 'text-muted' : 'font-medium'}`}>
              {w.canApprove ? 'Nothing blocks approval.' : reason}
            </p>
            <button type="button" className="btn btn-primary" disabled={!w.canApprove || approve.isPending} aria-describedby="approve-reason" onClick={() => approve.mutate(w.plan!.version)}>
              {approve.isPending ? 'Approving…' : 'Approve week'}
            </button>
          </div>
        )}
      </section>
      <MutationError error={approve.error} />
      {w.plan?.status === 'draft' && w.approvedPlan ? (
        <StateBlock state="stale" size="inline" title="An approved version is still in force">It stays in force until you approve this draft. Editing here changes the draft only.</StateBlock>
      ) : null}
      {withdrawn && status === 'draft' ? (
        <StateBlock state="stale" size="inline" title="Approval withdrawn">You changed an approved week, so it is a draft again. Approve it again when it is ready.</StateBlock>
      ) : null}

      {w.violations.length > 0 ? (
        <section aria-labelledby="viol-h" className="grid gap-3">
          <h2 id="viol-h" className="text-xl font-semibold">Balance check</h2>
          {blocking.length > 0 ? <ViolationList title="Blocks approval" list={blocking} byId={byId} danger /> : null}
          {advisory.length > 0 ? <ViolationList title="Worth a look, does not block" list={advisory} byId={byId} /> : null}
        </section>
      ) : null}

      <DraftWeek brandId={brandId} weekStart={w.weekStart} name={w.weekStart === thisWeek ? 'this week' : `the week of ${formatYmd(w.weekStart)}`} ready={w.ready} latestRun={w.latestRun} hasItems={w.items.length > 0} />

      {w.items.length === 0 && (!w.ready.facts || !w.ready.channels) ? null : (
        <section aria-label="Days" className="@container">
          <ol className="grid gap-3 @6xl:grid-cols-7 @6xl:gap-2">
            {days.map((day) => {
              const items = w.items.filter((i) => i.day === day).sort((a, b) => a.position - b.position);
              const name = formatYmd(day, { weekday: 'long' });
              return (
                <li key={day} aria-label={`${name} ${formatYmd(day)}`} className="grid content-start gap-2 rounded-lg border border-line bg-[color-mix(in_oklab,var(--theme-ink)_3%,transparent)] p-2.5 @xl:grid-cols-[6.5rem_1fr] @xl:gap-3 @6xl:grid-cols-1 @6xl:gap-2">
                  <div className="flex items-baseline justify-between gap-2 @xl:grid @xl:content-start @6xl:flex">
                    <h3 className="font-semibold">{name}</h3>
                    <span className="num text-sm text-muted">{formatYmd(day)}</span>
                  </div>
                  <div className="grid content-start gap-2">
                    {items.length > 0 ? (
                      <ul className="grid gap-2 @3xl:grid-cols-2 @6xl:grid-cols-1">
                        {items.map((i) => (
                          <li key={i.id}>
                            <ItemCard item={i} day={name} blocks={blocked.has(i.id)} flagged={flagged.has(i.id)} campaign={campaignName(i.campaignId)} facts={w.facts} onEdit={() => setEditing({ item: i })} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="py-1 text-sm text-muted">Nothing planned</p>
                    )}
                    <button type="button" className="btn btn-quiet justify-self-start" onClick={() => setEditing({ day })}>
                      <Plus className="size-4" aria-hidden />Add<span className="sr-only"> an idea on {name}</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {editing ? (
        <ItemDialog
          brandId={brandId}
          week={w}
          days={days}
          campaigns={campaigns.data ?? []}
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={(planStatus) => { if (approved && planStatus === 'draft') setWithdrawn(true); }}
        />
      ) : null}
    </div>
  );
}

function ViolationList({ title, list, byId, danger }: { title: string; list: Week['violations']; byId: Map<string, Item>; danger?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${danger ? 'border-[color-mix(in_oklab,var(--theme-danger)_45%,transparent)] bg-[color-mix(in_oklab,var(--theme-danger)_6%,transparent)]' : 'border-line bg-panel'}`}>
      <h3 className={`mb-2 flex items-center gap-2 text-sm font-semibold ${danger ? 'text-danger' : ''}`}>
        {danger ? <TriangleAlert className="size-4" aria-hidden /> : null}{title} ({list.length})
      </h3>
      <ul className="grid gap-2">
        {list.map((v, n) => (
          <li key={`${v.rule}-${n}`} className="grid gap-0.5">
            <p className="break-words">{v.message}</p>
            {v.itemIds.length > 0 ? (
              <p className="text-sm break-words text-muted">
                {v.itemIds.map((id) => byId.get(id)).filter((i): i is Item => !!i).map((i) => `${label(i.channel)} on ${formatYmd(i.day, { weekday: 'long' })}`).join('; ')}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemCard({ item, day, blocks, flagged, campaign, facts, onEdit }: { item: Item; day: string; blocks: boolean; flagged: boolean; campaign?: string; facts: FactRef[]; onEdit: () => void }) {
  return (
    <article
      aria-label={`${label(item.channel)}, ${day}`}
      data-blocking={blocks || undefined}
      className={`grid gap-2 rounded-md border bg-panel p-3 ${blocks ? 'border-danger' : 'border-line'}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-semibold">{label(item.channel)}</span>
        <span className="text-xs text-muted">{label(item.format, 'No format')}</span>
      </div>
      {item.idea ? <p className="break-words">{item.idea}</p> : <p className="text-muted italic">No idea written yet</p>}
      {item.cta ? <p className="text-sm break-words"><span className="text-muted">Call to action: </span>{item.cta}</p> : null}
      <p className="text-xs break-words text-muted">
        {[item.pillar ? label(item.pillar) : null, item.funnel ? label(item.funnel) : null, campaign].filter(Boolean).join(' · ') || 'No pillar or funnel stage'}
      </p>
      {item.factIds.length ? (
        <p className="text-xs break-words text-muted">Cites: {item.factIds.map((id) => { const f = facts.find((x) => x.id === id); return f ? factText(f) : 'a fact that is no longer approved'; }).join('; ')}</p>
      ) : null}
      {blocks ? <p className="flex items-center gap-1.5 text-xs font-semibold text-danger"><TriangleAlert className="size-3.5" aria-hidden />Blocks approval</p> : flagged ? <p className="text-xs font-medium text-muted">Flagged in the balance check</p> : null}
      <button type="button" className="btn btn-secondary justify-self-start" onClick={onEdit}>
        Edit<span className="sr-only"> the {label(item.channel)} idea on {day}</span>
      </button>
    </article>
  );
}
