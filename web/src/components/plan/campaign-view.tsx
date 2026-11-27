'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Async, BackLink, CostConfirm, LiveStatus, MoneyText, MutationError, PageHeader, RunProgress, StateBlock, StatusBadge, useBrandId } from '@/components/app';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { factText, fetchRun, runKey, SECTIONS, useAct, useBrief, type Body, type FactRef } from './lib';
import { formatYmd } from '@/lib/time';
import { nprText } from '@/lib/money';
import { label } from '@/lib/labels';

type View = Schemas['PlanBriefView'];
type Brief = Schemas['PlanBrief'];
const live = (s?: string) => s === 'running' || s === 'awaiting_approval';
const STATUSES: Schemas['PlanCampaignStatus'][] = ['draft', 'active', 'paused', 'done', 'archived'];

export function CampaignView() {
  const brandId = useBrandId()!;
  const id = useParams<{ id: string }>().id;
  const q = useBrief(brandId, id);
  return <Async q={q} what="campaign">{(v) => <Inner brandId={brandId} id={id} v={v} />}</Async>;
}

function Inner({ brandId, id, v }: { brandId: string; id: string; v: View }) {
  const client = useQueryClient();
  const c = v.campaign;
  const shown = v.draft ?? v.approved;
  const [editing, setEditing] = useState(false);
  const [warn, setWarn] = useState(false);
  const [est, setEst] = useState<Schemas['PlanEstimate'] | null>(null);
  const path = { params: { path: { brandId, id } } };
  const estimate = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/plan/campaigns/{id}/brief/estimate', path)));
  const generate = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/plan/campaigns/{id}/brief/generate', path)));
  const approve = useAct(brandId, (version: number) => unwrap(api.POST('/api/brands/{brandId}/plan/campaigns/{id}/brief/approve', { ...path, body: { version } })));
  const setStatus = useAct(brandId, (status: Schemas['PlanCampaignStatus']) => unwrap(api.PATCH('/api/brands/{brandId}/plan/campaigns/{id}', { ...path, body: { status } })));

  const run = v.latestRun;
  const key = runKey(brandId, run?.id ?? '');
  const polled = useQuery({ queryKey: key, queryFn: () => fetchRun(brandId, run!.id), enabled: !!run, initialData: run ?? undefined });
  const state = polled.data?.state;
  // When a run settles, the new draft must show up without a reload.
  useEffect(() => {
    if (state && !live(state)) client.invalidateQueries({ queryKey: ['plan', brandId] });
  }, [state, client, brandId]);

  return (
    <>
      <BackLink href={`/app/b/${brandId}/plan/campaigns`}>Back to Campaigns</BackLink>
      <PageHeader
        title={c.name}
        description={`${label(c.objective)}${c.startsOn ? ` · ${formatYmd(c.startsOn)}${c.endsOn ? ` to ${formatYmd(c.endsOn)}` : ''}` : ''}${c.budgetNpr ? ` · budget ${nprText(c.budgetNpr)}` : ''}`}
        actions={
          <>
            <label className="sr-only" htmlFor="c-status">Campaign status</label>
            <select id="c-status" className="input !h-9 !w-auto" value={c.status} onChange={(e) => setStatus.mutate(e.target.value as Schemas['PlanCampaignStatus'])}>
              {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </>
        }
      />
      <MutationError error={setStatus.error} />
      <LiveStatus message={setStatus.isSuccess ? `Campaign status is now ${label(setStatus.variables)}.` : ''} />

      <div className="grid gap-6">
        {!v.ready.facts ? (
          <StateBlock state="empty" size="inline" title="No approved brand facts yet" action={<Link className="btn btn-secondary" href={`/app/b/${brandId}/brand`}>Review the brand</Link>}>
            A brief is drafted only from approved facts.
          </StateBlock>
        ) : est ? (
          <CostConfirm estimate={est.estimate} remaining={est.remaining} pending={generate.isPending} onCancel={() => setEst(null)} onConfirm={() => generate.mutate(undefined, { onSuccess: () => setEst(null) })}>
            Drafting the nine sections of the brief from approved facts. The draft is a new version; an approved brief stays in force until you approve the new one.
          </CostConfirm>
        ) : (
          <div>
            <button type="button" className={`btn ${shown ? 'btn-secondary' : 'btn-primary'}`} disabled={live(state) || estimate.isPending} onClick={() => estimate.mutate(undefined, { onSuccess: setEst })}>
              {estimate.isPending ? 'Estimating…' : shown ? 'Draft the brief again' : 'Draft the brief'}
            </button>
          </div>
        )}
        <MutationError error={estimate.error ?? generate.error} />
        {run && polled.data && state !== 'completed' ? (
          <RunProgress
            queryKey={key}
            fetchRun={() => fetchRun(brandId, run.id)}
            label="Brief draft"
            onCancel={() => unwrap(api.POST('/api/brands/{brandId}/plan/runs/{id}/cancel', { params: { path: { brandId, id: run.id } } }))}
            onRetry={() => unwrap(api.POST('/api/brands/{brandId}/plan/runs/{id}/retry', { params: { path: { brandId, id: run.id } } }))}
          />
        ) : polled.data?.actual ? (
          <p className="text-sm text-muted">Cost <MoneyText value={polled.data.actual} />.</p>
        ) : null}

        {!shown ? (
          <StateBlock state="empty" title="No brief yet">Draft the brief to see its nine sections, each statement with the facts behind it.</StateBlock>
        ) : editing ? (
          <Editor brandId={brandId} id={id} brief={shown} facts={v.facts} onDone={() => setEditing(false)} />
        ) : (
          <section aria-label="Brief" className="grid gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-semibold">Brief, version {shown.version}</h2>
                <StatusBadge status={shown.status} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary" onClick={() => (shown.status === 'approved' ? setWarn(true) : setEditing(true))}>Edit the brief</button>
                {shown.status === 'draft' ? (
                  <button type="button" className="btn btn-primary" disabled={approve.isPending} onClick={() => approve.mutate(shown.version)}>{approve.isPending ? 'Approving…' : 'Approve this brief'}</button>
                ) : null}
              </div>
            </div>
            {shown.status === 'approved' && warn ? (
              <div role="alert" className="panel grid gap-3 p-4">
                <p className="font-semibold">Edit an approved brief?</p>
                <p className="text-sm text-muted">Saving an edit retires this approved version and starts a new draft. You must approve the draft again before it counts.</p>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-primary" onClick={() => { setWarn(false); setEditing(true); }}>Edit and start a new draft</button>
                  <button type="button" className="btn btn-quiet" onClick={() => setWarn(false)}>Keep it as is</button>
                </div>
              </div>
            ) : null}
            <MutationError error={approve.error} />
            <div className="grid gap-4">
              {SECTIONS.map((s) => (
                <section key={s} aria-labelledby={`s-${s}`} className="panel grid gap-3 p-5">
                  <h3 id={`s-${s}`} className="text-lg font-semibold">{label(s)}</h3>
                  {shown.body[s].length === 0 ? <p className="text-sm text-muted">Nothing here.</p> : (
                    <ul className="grid gap-3">
                      {shown.body[s].map((st, n) => (
                        <li key={n} className="grid gap-1">
                          <p className="break-words">{st.text}</p>
                          {st.factIds?.length ? (
                            <ul aria-label="Facts cited" className="flex flex-wrap gap-1.5">
                              {st.factIds.map((fid) => <li key={fid} className="rounded-full bg-success-bg px-2.5 py-0.5 text-xs break-words text-success">{factFor(v.facts, fid)}</li>)}
                            </ul>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
            <section aria-labelledby="left-h" className="grid gap-2">
              <h3 id="left-h" className="text-lg font-semibold">Left out</h3>
              {shown.leftOut.length === 0 ? <p className="text-sm text-muted">Nothing was left out. Every claim that needs an approved fact has one.</p> : (
                <>
                  <p className="text-sm text-muted">These statements cited no approved fact, so they are not in the brief.</p>
                  <ul className="panel divide-y divide-line">
                    {shown.leftOut.map((l, n) => (
                      <li key={n} className="grid gap-0.5 px-4 py-3">
                        <p className="break-words">{l.text}</p>
                        <p className="text-sm text-muted">{label(l.section)} · {l.reason}</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </section>
        )}
      </div>
    </>
  );
}

const factFor = (facts: FactRef[], id: string) => { const f = facts.find((x) => x.id === id); return f ? factText(f) : 'A fact that is no longer approved'; };

function Editor({ brandId, id, brief, facts, onDone }: { brandId: string; id: string; brief: Brief; facts: FactRef[]; onDone: () => void }) {
  const [body, setBody] = useState<Body>(structuredClone(brief.body));
  const save = useAct(brandId, () => {
    const clean = Object.fromEntries(SECTIONS.map((s) => [s, body[s].filter((x) => x.text.trim())])) as Body; // empty statements are dropped
    return unwrap(api.PATCH('/api/brands/{brandId}/plan/campaigns/{id}/brief', { params: { path: { brandId, id } }, body: { body: clean } }));
  });
  const change = (s: (typeof SECTIONS)[number], n: number, patch: Partial<Body[typeof s][number]>) =>
    setBody({ ...body, [s]: body[s].map((x, i) => (i === n ? { ...x, ...patch } : x)) });
  return (
    <form aria-label="Edit the brief" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onDone }); }}>
      <h2 className="text-xl font-semibold">Edit the brief</h2>
      <p className="text-sm text-muted">Audience and offer statements need an approved fact. One without a fact is moved to the left-out list when you save.</p>
      {SECTIONS.map((s) => (
        <fieldset key={s} className="panel grid gap-3 p-5">
          <legend className="px-1 text-lg font-semibold">{label(s)}</legend>
          {body[s].map((st, n) => (
            <div key={n} className="grid gap-2">
              <label htmlFor={`e-${s}-${n}`} className="label">Statement {n + 1}<span className="sr-only"> of {label(s)}</span></label>
              <textarea id={`e-${s}-${n}`} rows={2} maxLength={2000} className="input h-auto py-2" value={st.text} onChange={(e) => change(s, n, { text: e.target.value })} />
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">Facts cited ({st.factIds?.length ?? 0})<span className="sr-only"> for statement {n + 1} of {label(s)}</span></summary>
                <div className="mt-2 grid max-h-36 gap-1.5 overflow-auto rounded-md border border-line p-3">
                  {facts.length === 0 ? <p className="text-muted">No approved facts.</p> : facts.map((f) => (
                    <label key={f.id} className="flex items-start gap-2.5">
                      <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={st.factIds?.includes(f.id) ?? false} onChange={(e) => change(s, n, { factIds: e.target.checked ? [...(st.factIds ?? []), f.id] : (st.factIds ?? []).filter((x) => x !== f.id) })} />
                      <span className="break-words">{factText(f)}</span>
                    </label>
                  ))}
                </div>
              </details>
              <button type="button" className="btn btn-quiet justify-self-start" onClick={() => setBody({ ...body, [s]: body[s].filter((_, i) => i !== n) })}>Remove<span className="sr-only"> statement {n + 1} of {label(s)}</span></button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary justify-self-start" onClick={() => setBody({ ...body, [s]: [...body[s], { text: '', factIds: [] }] })}>Add a statement<span className="sr-only"> to {label(s)}</span></button>
        </fieldset>
      ))}
      <MutationError error={save.error} />
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save as a draft'}</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
