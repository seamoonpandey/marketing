'use client';

import { FileText, PauseCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Async, MutationError, PageHeader, StateBlock, Time, useBrandId } from '@/components/app';
import { api, hasStatus, unwrap } from '@/lib/api/client';
import { label } from '@/lib/labels';
import { fmtDay, Notice, RiskTag, StateTag, STATE_LABEL, STATES, useAct, useQueue, type QueueItem, type State } from './lib';

export function Queue() {
  const brandId = useBrandId()!;
  const [filter, setFilter] = useState<State | undefined>();
  const q = useQueue(brandId, filter);
  return (
    <>
      <PageHeader title="Approve" description="Nothing goes out until you approve the exact version. Open an item to see it as it will appear." />
      <Async q={q} what="approval queue">
        {({ summary, items }) => (
          <div className="grid gap-8">
            <PausePanel brandId={brandId} paused={summary.paused} reason={summary.pausedReason} at={summary.pausedAt} />
            <div role="group" aria-label="Filter by state" className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={!filter} className={`btn ${!filter ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(undefined)}>All</button>
              {STATES.map((s) => (
                <button key={s} type="button" aria-pressed={filter === s} className={`btn ${filter === s ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(s)}>
                  {STATE_LABEL[s]} <span className="num font-normal opacity-80" aria-label={`${summary.counts[s]} items`}>{summary.counts[s]}</span>
                </button>
              ))}
            </div>
            <p className="-mt-4 text-sm text-muted">{summary.monthDecisions} decision{summary.monthDecisions === 1 ? '' : 's'} this month.</p>
            {items.length === 0 ? <Empty filter={filter} /> : <Days brandId={brandId} items={items} />}
          </div>
        )}
      </Async>
    </>
  );
}

function Empty({ filter }: { filter?: State }) {
  return filter ? (
    <StateBlock state="empty" title={`Nothing is ${STATE_LABEL[filter].toLowerCase()}`}>Items move here as they are decided or as their approval changes.</StateBlock>
  ) : (
    <StateBlock state="empty" title="Nothing to approve yet">Drafts appear here as soon as Studio marks them ready. You approve each one before it can go out.</StateBlock>
  );
}

// ---- pause -------------------------------------------------------------------------------------

function PausePanel({ brandId, paused, reason, at }: { brandId: string; paused: boolean; reason: string | null; at: string | null }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const act = useAct(brandId, (v: { to: 'pause' | 'resume'; reason: string }) =>
    unwrap(api.POST(`/api/brands/{brandId}/approve/${v.to}`, { params: { path: { brandId } }, body: { reason: v.reason } })),
  );
  const submit = (to: 'pause' | 'resume') => act.mutate({ to, reason: text.trim() }, { onSuccess: () => { setText(''); setOpen(false); } });
  const form = (to: 'pause' | 'resume') => (
    <form className="grid max-w-xl gap-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) submit(to); }}>
      <div className="field">
        <label className="label" htmlFor="pause-reason">Reason</label>
        <input id="pause-reason" className="input" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} autoFocus />
      </div>
      <MutationError error={act.error} />
      <div className="flex gap-2">
        <button type="submit" className={`btn ${to === 'pause' ? 'btn-danger' : 'btn-primary'}`} disabled={!text.trim() || act.isPending}>{to === 'pause' ? 'Pause approvals' : 'Resume approvals'}</button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
  if (paused) {
    return (
      <section aria-label="Pause" className="grid gap-3 rounded-lg border border-line-strong bg-[color-mix(in_oklab,var(--theme-highlight)_30%,transparent)] p-5">
        <div className="flex items-start gap-3">
          <PauseCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="grid gap-0.5">
            <h2 className="font-semibold">Approvals are paused</h2>
            <p className="text-sm break-words">{reason}{at ? <> (since <Time iso={at} year />)</> : null}. Approved items will not go out until you resume.</p>
          </div>
        </div>
        {open ? form('resume') : <button type="button" className="btn btn-secondary justify-self-start" onClick={() => setOpen(true)}>Resume approvals…</button>}
      </section>
    );
  }
  return (
    <section aria-label="Pause" className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-line px-5 py-4">
      <p className="max-w-[55ch] text-sm text-muted">Something wrong? Pause stops every approved item from going out, for this brand, until you resume. Nothing is deleted.</p>
      {open ? form('pause') : <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>Pause approvals…</button>}
    </section>
  );
}

// ---- the queue, by day, with bulk selection ------------------------------------------------------

/** Why this item cannot be added to the selection, or null when it can. The server's own reason comes first. */
function whyNot(item: QueueItem, selected: QueueItem[]): string | null {
  const d = item.draft;
  if (!d) return 'Studio no longer has this draft.';
  if (d.bulkReason) return d.bulkReason;
  if (!d.canApprove) return d.cannotApproveReason ?? 'It cannot be approved right now.';
  const ref = selected.find((s) => s.draftId !== item.draftId)?.draft;
  if (!ref) return null;
  if (ref.channel !== d.channel) return `A bulk approval covers one channel. Your selection is ${ref.channel}, this is ${d.channel}.`;
  if (ref.risk !== d.risk) return `A bulk approval covers one risk level. Your selection is ${ref.risk} risk, this is ${d.risk} risk.`;
  if (ref.weekStart !== d.weekStart) return 'A bulk approval covers one week. This one falls in another week.';
  return null;
}

function Days({ brandId, items }: { brandId: string; items: QueueItem[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const selected = items.filter((i) => picked.includes(i.draftId));
  const bulk = useAct(brandId, (list: QueueItem[]) =>
    unwrap(api.POST('/api/brands/{brandId}/approve/bulk-approve', { params: { path: { brandId } }, body: { items: list.map((i) => ({ draftId: i.draftId, payloadHash: i.draft!.payloadHash! })) } })),
  );
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const days = new Map<string, QueueItem[]>();
  for (const i of items) days.set(i.draft?.day ?? '', [...(days.get(i.draft?.day ?? '') ?? []), i]);
  const approveSelected = () => {
    setMsg(null);
    bulk.mutate(selected, {
      onSuccess: () => setPicked([]),
      onError: (e) => {
        if (hasStatus(e, 409)) { setPicked([]); setMsg(`Nothing was approved: ${e.message}. The list has been reloaded; look at the items again.`); }
      },
    });
  };
  return (
    <div className="grid gap-8">
      {msg ? <Notice><p className="font-semibold">Nothing was approved</p><p>{msg}</p></Notice> : null}
      <MutationError error={hasStatus(bulk.error, 409) ? null : bulk.error} />
      {[...days].map(([day, list]) => (
        <section key={day} aria-labelledby={`day-${day}`} className="grid gap-3">
          <h2 id={`day-${day}`} className="text-lg font-semibold">{day ? fmtDay(day) : 'No longer in Studio'}</h2>
          <ul className="panel divide-y divide-line">
            {list.map((i) => <Row key={i.draftId} brandId={brandId} item={i} checked={picked.includes(i.draftId)} why={i.state === 'waiting' ? whyNot(i, selected) : null} onToggle={() => toggle(i.draftId)} />)}
          </ul>
        </section>
      ))}
      {selected.length > 0 ? (
        <div role="region" aria-label="Bulk approval" className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-inv-bg px-5 py-3 text-inv-ink shadow-pop">
          <p className="text-sm"><span className="font-semibold">{selected.length} selected</span> · {selected[0]!.draft!.channel}, {selected[0]!.draft!.risk} risk. You will approve each version as shown in the list.</p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-quiet text-inv-ink" onClick={() => setPicked([])}>Clear</button>
            <button type="button" className="btn btn-primary" disabled={bulk.isPending} onClick={approveSelected}>Approve {selected.length} selected</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ brandId, item, checked, why, onToggle }: { brandId: string; item: QueueItem; checked: boolean; why: string | null; onToggle: () => void }) {
  const d = item.draft;
  const waiting = item.state === 'waiting';
  const blocked = !checked && !!why;
  return (
    <li>
      <article aria-label={d ? `${label(d.channel)} ${label(d.kind)}, ${d.day}` : 'Draft no longer in Studio'} data-state-of={item.state} className="grid grid-cols-[auto_5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-2 px-4 py-4 md:grid-cols-[auto_5rem_minmax(0,1fr)_auto]">
        {waiting && d ? (
          // aria-disabled, not disabled: it stays reachable by keyboard and its reason is read out.
          <input
            type="checkbox" className="mt-1 size-4" checked={checked} aria-disabled={blocked}
            aria-label={`Select for bulk approval: ${d.excerpt}`} aria-describedby={blocked ? `why-${item.draftId}` : undefined}
            onChange={() => { if (!blocked) onToggle(); }}
          />
        ) : <span aria-hidden />}
        <div className="grid h-16 w-20 place-items-center overflow-hidden rounded-md bg-[color-mix(in_oklab,var(--theme-ink)_5%,transparent)]">
          {d?.thumbnailUrl ? (
            <img src={d.thumbnailUrl} alt={`Preview of the ${d.kind} for ${d.channel}`} className="h-auto max-h-16 w-auto max-w-20 object-contain" />
          ) : (
            <FileText className="size-5 text-muted" aria-hidden />
          )}
        </div>
        <div className="grid min-w-0 gap-1.5">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">{d ? `${label(d.channel)} · ${label(d.kind)}` : 'Draft'}{d && !d.viewed && waiting ? ' · not opened yet' : ''}</p>
          {d ? (
            <Link href={`/app/b/${brandId}/approve/${item.draftId}`} className="font-semibold break-words hover:underline">{d.excerpt || 'No caption'}</Link>
          ) : (
            <Link href={`/app/b/${brandId}/approve/${item.draftId}`} className="font-semibold hover:underline">See its history</Link>
          )}
          {item.stateReason ? <p className="text-sm break-words text-muted">{item.stateReason}</p> : null}
          {blocked ? <p id={`why-${item.draftId}`} data-testid="bulk-why" className="text-sm break-words text-muted">Cannot join the selection: {why}</p> : null}
        </div>
        <div className="col-span-3 flex flex-wrap items-center gap-2 md:col-span-1 md:justify-end">
          {d ? <RiskTag risk={d.risk} /> : null}
          <StateTag state={item.state} />
        </div>
      </article>
    </li>
  );
}
