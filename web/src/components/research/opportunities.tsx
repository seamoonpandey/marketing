'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Async, LiveStatus, MutationError, PageHeader, SourceQuote, StateBlock, useBrandId } from '@/components/app';
import { useSources } from '@/components/brand/data';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { useAct, useCandidates, useCompetitors, useOpportunities } from './lib';

type Status = Schemas['Opportunity']['status'];
type Opportunity = Schemas['Opportunity'];
const TABS: Status[] = ['new', 'accepted', 'dismissed'];
const TAB_LABEL: Record<Status, string> = { new: 'New', accepted: 'Accepted', dismissed: 'Dismissed' };
const KIND: Record<Opportunity['kind'], string> = { change: 'Answer a change', gap: 'Gap', strength: 'Your strength' };
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const found = (n: number) => (n === 0 ? 'Nothing new this time' : `${n} new opportunit${n === 1 ? 'y' : 'ies'}`);

export function Opportunities() {
  const brandId = useBrandId()!;
  const [status, setStatus] = useState<Status>('new');
  const lists = { new: useOpportunities(brandId, 'new'), accepted: useOpportunities(brandId, 'accepted'), dismissed: useOpportunities(brandId, 'dismissed') };
  const q = lists[status];
  const sources = useSources(brandId);
  const competitors = useCompetitors(brandId);
  const candidates = useCandidates(brandId);
  const decide = useAct(brandId, (v: { id: string; to: 'accept' | 'dismiss' | 'restore' }) =>
    unwrap(api.POST(`/api/brands/{brandId}/research/opportunities/{id}/${v.to}`, { params: { path: { brandId, id: v.id } } })),
  );
  const scan = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/research/opportunities/scan', { params: { path: { brandId } } })));
  const nothingToCompare = competitors.data?.length === 0 && candidates.data?.length === 0;
  const find = (
    <button type="button" className="btn btn-primary" disabled={scan.isPending} onClick={() => scan.mutate(undefined, { onSuccess: () => setStatus('new') })}>
      {scan.isPending ? 'Looking…' : 'Find opportunities'}
    </button>
  );

  return (
    <>
      <PageHeader
        title="Opportunities"
        description="Openings found in what competitors changed, what they offer and where your brand is stronger. Accept the ones worth acting on; accepted ones go to planning."
        actions={nothingToCompare ? undefined : find}
      />
      <div role="group" aria-label="Show" className="mb-5 flex flex-wrap gap-1.5">
        {TABS.map((s) => (
          <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={`btn ${status === s ? 'btn-primary' : 'btn-secondary'}`}>
            {TAB_LABEL[s]}{lists[s].data ? ` ${lists[s].data.length}` : ''}
          </button>
        ))}
      </div>
      <MutationError error={decide.error ?? scan.error} />
      {scan.isSuccess ? <p role="status" className="mb-4 text-sm font-medium">{found(scan.data.created.length)}</p> : null}
      <LiveStatus message={decide.isSuccess ? `${{ accept: 'Accepted', dismiss: 'Dismissed', restore: 'Restored' }[decide.variables.to]} the opportunity.` : ''} />
      <Async q={q} what="opportunities">
        {(list) =>
          list.length === 0 ? (
            status === 'new' ? (
              nothingToCompare ? (
                <StateBlock state="empty" title="No new opportunities" action={<Link href={`/app/b/${brandId}/research/discover`} className="btn btn-primary">Find competitors</Link>}>
                  Opportunities come from comparing your brand with competitors. Find some first.
                </StateBlock>
              ) : (
                <StateBlock state="empty" title="No new opportunities">
                  Press Find opportunities: Prachaar compares your brand with the competitors it knows and proposes where to act, each tied to what it saw.
                </StateBlock>
              )
            ) : (
              <StateBlock state="empty" title={`Nothing ${status} yet`}>Opportunities you {status === 'accepted' ? 'accept' : 'dismiss'} are kept here.</StateBlock>
            )
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-4">
              {list.map((o) => (
                <li key={o.id}>
                  <article className="panel grid grid-cols-[minmax(0,1fr)] gap-4 p-5" aria-label={o.title}>
                    <div className="grid gap-1">
                      <p className="text-xs font-medium text-muted">
                        <span className="font-semibold tracking-wide text-brand uppercase">{KIND[o.kind]}</span> · {cap(o.impact)} impact · {cap(o.effort)} effort · {cap(o.confidence)} confidence
                      </p>
                      <h2 className="text-lg font-semibold break-words">{o.title}</h2>
                    </div>
                    <dl className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-3">
                      {([['Hypothesis', o.hypothesis], ['Suggested action', o.suggestedAction], ['Why it matters', o.whyItMatters]] as const).map(([k, v]) => (
                        <div key={k} className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-1"><dt className="text-xs font-semibold tracking-wide text-muted uppercase">{k}</dt><dd className="[overflow-wrap:anywhere]">{v}</dd></div>
                      ))}
                    </dl>
                    <div className="grid gap-1">
                      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Based on</h3>
                      <ul className="grid gap-2 text-sm">
                        {o.evidence.map((e) => {
                          const source = e.sourceId ? sources.data?.find((s) => s.id === e.sourceId) : undefined;
                          return (
                            <li key={`${e.type}-${e.id}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 [overflow-wrap:anywhere]">
                              <span><span className="font-medium">{e.label}</span>: {e.detail}</span>
                              {e.quote ? source ? <SourceQuote quote={e.quote} source={source} /> : <span className="text-muted">“{e.quote}”</span> : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {o.status === 'new' ? (
                        <>
                          <button type="button" className="btn btn-primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: o.id, to: 'accept' })}>Accept<span className="sr-only">: {o.title}</span></button>
                          <button type="button" className="btn btn-secondary" disabled={decide.isPending} onClick={() => decide.mutate({ id: o.id, to: 'dismiss' })}>Dismiss<span className="sr-only">: {o.title}</span></button>
                        </>
                      ) : null}
                      {o.status === 'accepted' ? <Link href={`/app/b/${brandId}/plan`} className="btn btn-primary">Plan a campaign<span className="sr-only">: {o.title}</span></Link> : null}
                      {o.status === 'dismissed' ? <button type="button" className="btn btn-secondary" disabled={decide.isPending} onClick={() => decide.mutate({ id: o.id, to: 'restore' })}>Restore<span className="sr-only">: {o.title}</span></button> : null}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </>
  );
}
