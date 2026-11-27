'use client';

import { useState } from 'react';
import { PageHeader, StateBlock, useBrandId } from '@/components/app';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { Async, MutationError, useAct, useObservations, useOpportunities } from './lib';

type Status = Schemas['Opportunity']['status'];
const TABS: [Status, string][] = [['new', 'New'], ['accepted', 'Accepted'], ['dismissed', 'Dismissed']];

export function Opportunities() {
  const brandId = useBrandId()!;
  const [status, setStatus] = useState<Status>('new');
  const q = useOpportunities(brandId, status);
  const obs = useObservations(brandId);
  const decide = useAct(brandId, (v: { id: string; to: 'accept' | 'dismiss' }) =>
    unwrap(api.POST(`/api/brands/{brandId}/research/opportunities/{id}/${v.to}`, { params: { path: { brandId, id: v.id } } })),
  );
  return (
    <>
      <PageHeader title="Opportunities" description="Openings the changes leave for this brand. Accept the ones worth acting on; accepted ones go to planning." />
      <div role="group" aria-label="Show" className="mb-5 flex gap-1.5">
        {TABS.map(([s, label]) => (
          <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={`btn ${status === s ? 'btn-primary' : 'btn-secondary'}`}>{label}</button>
        ))}
      </div>
      <MutationError error={decide.error} />
      <Async q={q} what="opportunities">
        {(list) =>
          list.length === 0 ? (
            <StateBlock state="empty" title={status === 'new' ? 'No new opportunities' : `Nothing ${status} yet`}>
              {status === 'new' ? 'After a run finds changes, Prachaar proposes what to do about them, each tied to what was seen.' : 'Opportunities you ' + (status === 'accepted' ? 'accept' : 'dismiss') + ' are kept here.'}
            </StateBlock>
          ) : (
            <ul className="grid gap-4">
              {list.map((o) => {
                const cited = (obs.data ?? []).filter((x) => o.observationIds.includes(x.id));
                return (
                  <li key={o.id}>
                    <article className="panel grid gap-4 p-5" aria-label={o.title}>
                      <div className="grid gap-1">
                        <p className="text-xs text-muted">{o.confidence[0]!.toUpperCase() + o.confidence.slice(1)} confidence</p>
                        <h2 className="text-lg font-semibold break-words">{o.title}</h2>
                      </div>
                      <dl className="grid gap-3 md:grid-cols-3">
                        {([['Hypothesis', o.hypothesis], ['Suggested action', o.suggestedAction], ['Why it matters', o.whyItMatters]] as const).map(([k, v]) => (
                          <div key={k} className="grid content-start gap-1"><dt className="text-xs font-semibold tracking-wide text-muted uppercase">{k}</dt><dd className="break-words">{v}</dd></div>
                        ))}
                      </dl>
                      <div className="grid gap-1">
                        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Based on</h3>
                        <ul className="grid gap-1 text-sm">
                          {cited.map((x) => <li key={x.id} className="break-words"><span className="font-medium">{x.competitorName ?? 'Removed competitor'}</span>: {x.summary}</li>)}
                          {cited.length < o.observationIds.length ? <li className="text-muted">{o.observationIds.length - cited.length} more observation(s)</li> : null}
                        </ul>
                      </div>
                      {o.status === 'new' ? (
                        <div className="flex gap-2">
                          <button type="button" className="btn btn-primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: o.id, to: 'accept' })}>Accept<span className="sr-only">: {o.title}</span></button>
                          <button type="button" className="btn btn-secondary" disabled={decide.isPending} onClick={() => decide.mutate({ id: o.id, to: 'dismiss' })}>Dismiss<span className="sr-only">: {o.title}</span></button>
                        </div>
                      ) : null}
                    </article>
                  </li>
                );
              })}
            </ul>
          )
        }
      </Async>
    </>
  );
}
