'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CircleAlert, FileText, ImageOff, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Async, CostConfirm, MoneyText, MutationError, PageHeader, RunProgress, StateBlock, StatusBadge, useBrandId } from '@/components/app';
import { api, unwrap, type Money } from '@/lib/api/client';
import { cancelRun, fetchRun, retryRun, runKey, useAct, useOverview, type Overview, type OverviewItem } from './lib';
import { addDays, formatYmd, weekRange } from '@/lib/time';
import { label } from '@/lib/labels';

export function Dashboard() {
  const brandId = useBrandId()!;
  const router = useRouter();
  const week = useSearchParams().get('week') ?? undefined;
  const overview = useOverview(brandId, week);
  const go = (w?: string) => router.push(`/app/b/${brandId}/studio${w ? `?week=${w}` : ''}`);
  return (
    <>
      <PageHeader title="Studio" description="Each approved plan item becomes a draft: the copy, and the picture or video where the format needs one." />
      <Async q={overview} what="studio week">{(o) => <Week brandId={brandId} o={o} onWeek={go} />}</Async>
    </>
  );
}

function Week({ brandId, o, onWeek }: { brandId: string; o: Overview; onWeek: (w?: string) => void }) {
  const client = useQueryClient();
  const [confirm, setConfirm] = useState<{ ids: string[]; estimate: Money; remaining: Money; count: number } | null>(null);
  const [runId, setRunId] = useState<string | null>(o.latestRun?.state === 'running' ? o.latestRun.id : null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const estimate = useAct(brandId, (ids: string[]) =>
    unwrap(api.POST('/api/brands/{brandId}/studio/drafts/estimate', { params: { path: { brandId } }, body: { planItemIds: ids } })).then((e) => setConfirm({ ids, ...e })),
  );
  const start = useAct(brandId, (ids: string[]) =>
    unwrap(api.POST('/api/brands/{brandId}/studio/drafts', { params: { path: { brandId } }, body: { planItemIds: ids } })).then((r) => {
      setConfirm(null);
      setRunId(r.id);
    }),
  );
  useEffect(() => { if (confirm) confirmRef.current?.querySelector('h2')?.scrollIntoView({ block: 'nearest' }); }, [confirm]);

  const undrafted = o.items.filter((i) => !i.draft);
  const days = [...new Set(o.items.map((i) => i.item.day))];
  const prev = addDays(o.weekStart, -7);
  const next = addDays(o.weekStart, 7);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-y border-line py-3">
        <nav aria-label="Week" className="flex items-center gap-1.5">
          <button type="button" className="btn btn-quiet px-2" onClick={() => onWeek(prev)} aria-label="Previous week"><ChevronLeft className="size-4" aria-hidden /></button>
          <p className="min-w-44 text-center font-semibold" aria-live="polite"><span className="sr-only">Week of </span>{weekRange(o.weekStart)}</p>
          <button type="button" className="btn btn-quiet px-2" onClick={() => onWeek(next)} aria-label="Next week"><ChevronRight className="size-4" aria-hidden /></button>
          <button type="button" className="btn btn-secondary ml-1" onClick={() => onWeek()}>This week</button>
        </nav>
        <p className="text-sm text-muted">Studio copy this month: <strong className="font-semibold text-ink"><MoneyText value={o.monthCost} /></strong></p>
      </div>

      {!o.planApproved ? (
        <StateBlock
          state="empty"
          title="This week has no approved plan"
          action={<Link className="btn btn-primary" href={`/app/b/${brandId}/plan?week=${o.weekStart}`}>Open the Plan calendar</Link>}
        >
          Studio drafts only what a plan has approved. Approve this week in Plan, then come back and draft its items.
        </StateBlock>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">{o.items.length} planned {o.items.length === 1 ? 'post' : 'posts'}<span className="ml-2 text-base font-normal text-muted">{undrafted.length === 0 ? 'all drafted' : `${undrafted.length} to draft`}</span></h2>
            <button
              type="button"
              className="btn btn-primary"
              disabled={undrafted.length === 0 || !o.ready.facts || estimate.isPending || !!confirm}
              onClick={() => estimate.mutate(undrafted.map((i) => i.item.id))}
            >
              <Sparkles className="size-4" aria-hidden />Draft all{undrafted.length ? ` (${undrafted.length})` : ''}
            </button>
          </div>
          {!o.ready.facts ? (
            <StateBlock state="partial" size="inline" title="Drafting needs an approved fact" action={<Link className="btn btn-secondary" href={`/app/b/${brandId}/brand/review`}>Review facts</Link>}>
              Every claim in a draft must point at a fact you approved. Approve at least one in Brand first.
            </StateBlock>
          ) : null}
          <MutationError error={estimate.error ?? start.error} />

          {confirm ? (
            <div ref={confirmRef}>
              <CostConfirm estimate={confirm.estimate} remaining={confirm.remaining} pending={start.isPending} onConfirm={() => start.mutate(confirm.ids)} onCancel={() => setConfirm(null)}>
                Writing the copy for {confirm.count} {confirm.count === 1 ? 'item' : 'items'}. Images and video are rendered here at no cost.
              </CostConfirm>
            </div>
          ) : null}

          {runId ? (
            <GenerateRun
              brandId={brandId}
              runId={runId}
              onSettled={() => client.invalidateQueries({ queryKey: ['studio', brandId, 'overview'] })}
            />
          ) : null}

          {o.items.length === 0 ? (
            <StateBlock state="empty" title="The approved plan has no items">Add items to this week in Plan, then draft them here.</StateBlock>
          ) : (
            days.map((day) => (
              <section key={day} aria-labelledby={`day-${day}`} className="grid gap-3">
                <h3 id={`day-${day}`} className="text-sm font-semibold tracking-wide text-muted uppercase">{formatYmd(day, { weekday: 'long', day: 'numeric', month: 'short' })}</h3>
                <ul className="grid gap-3 lg:grid-cols-2">
                  {o.items.filter((i) => i.item.day === day).map((i) => (
                    <li key={i.item.id}>
                      <ItemCard brandId={brandId} i={i} canDraft={o.ready.facts && !estimate.isPending && !confirm} onDraft={() => estimate.mutate([i.item.id])} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}

function GenerateRun({ brandId, runId, onSettled }: { brandId: string; runId: string; onSettled: () => void }) {
  const key = runKey(brandId, runId);
  const run = useQuery({ queryKey: key, queryFn: () => fetchRun(brandId, runId) });
  const state = run.data?.state;
  useEffect(() => { if (state && state !== 'running' && state !== 'awaiting_approval') onSettled(); }, [state, onSettled]);
  const c = run.data?.counts;
  return (
    <div className="grid gap-2">
      <RunProgress queryKey={key} fetchRun={() => fetchRun(brandId, runId)} onCancel={() => cancelRun(brandId, runId)} onRetry={() => retryRun(brandId, runId)} label="Writing drafts" />
      {state === 'completed' && c ? (
        <p className="text-sm" role="status">
          {c.drafted ?? 0} drafted{c.failed ? `, ${c.failed} failed` : ''}.
          {run.data?.actual ? <> Cost <MoneyText value={run.data.actual} />.</> : null}
        </p>
      ) : null}
      {(c?.failures ?? []).map((f) => <p key={f.planItemId} className="text-sm text-danger break-words">Could not draft one item: {f.message}</p>)}
      {(c?.missingLanguages ?? []).map((m) => <p key={m.planItemId} className="text-sm text-muted">One draft has no copy yet in {m.languages.join(', ')}. Open it and write that language.</p>)}
    </div>
  );
}

function ItemCard({ brandId, i, canDraft, onDraft }: { brandId: string; i: OverviewItem; canDraft: boolean; onDraft: () => void }) {
  const { item, draft } = i;
  const title = `${label(item.channel)} ${label(item.kind).toLowerCase()}`;
  return (
    <article aria-label={title} className="panel grid h-full grid-cols-[auto_1fr] gap-4 p-4">
      <Thumb url={draft?.thumbnailUrl ?? null} drafted={!!draft} textOnly={item.kind === 'post'} alt={`First image of the ${title}`} />
      <div className="grid min-w-0 content-between gap-3">
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-semibold">{title}</p>
            {draft ? <StatusBadge status={draft.status === 'ready' ? 'completed' : 'draft'} label={draft.status === 'ready' ? 'Ready' : 'Draft'} /> : <StatusBadge status="not_drafted" label="Not drafted" />}
            {draft && draft.blockingCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-danger"><CircleAlert className="size-3.5" aria-hidden />{draft.blockingCount} blocking</span>
            ) : null}
          </div>
          <p className="break-words">{item.idea}</p>
          {item.cta ? <p className="text-sm break-words text-muted">Call to action: {item.cta}</p> : null}
        </div>
        <div>
          {draft ? (
            <Link className="btn btn-secondary" href={`/app/b/${brandId}/studio/drafts/${draft.id}`}>
              <FileText className="size-4" aria-hidden />Open draft<span className="sr-only">: {item.idea}</span>
            </Link>
          ) : (
            <button type="button" className="btn btn-secondary" disabled={!canDraft} onClick={onDraft}>
              <Sparkles className="size-4" aria-hidden />Draft<span className="sr-only">: {item.idea}</span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function Thumb({ url, drafted, textOnly, alt }: { url: string | null; drafted: boolean; textOnly: boolean; alt: string }) {
  return (
    <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-md bg-surface text-muted">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- presigned storage URL; its size is not known here
        <img src={url} alt={alt} className="size-full object-contain" />
      ) : (
        <span className="grid place-items-center gap-1 px-2 text-center text-xs"><ImageOff className="size-5" aria-hidden />{textOnly ? 'Text only' : drafted ? 'Not rendered' : 'No draft'}</span>
      )}
    </div>
  );
}
