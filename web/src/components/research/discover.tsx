'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Async, CostConfirm, MoneyText, MutationError, PageHeader, RunProgress, StateBlock, useBrandId } from '@/components/app';
import { api, unwrap } from '@/lib/api/client';
import { DiscoverTable } from './discover-table';
import { discoveryKey, fetchDiscovery, useAct, useCosts, useDiscoveries, type DiscoveryRun } from './lib';

const MAX_KEYWORDS = 15;
const MAX_LENGTH = 80;
const bid = (b: string, id: string) => ({ params: { path: { brandId: b, id } } });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function Discover() {
  const brandId = useBrandId()!;
  const runs = useDiscoveries(brandId);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState('');
  const latest = runs.data?.[0];
  const active = latest?.state === 'running' || latest?.state === 'awaiting_approval';

  const merge = (more: string[]) => setKeywords((cur) => {
    const seen = new Set(cur.map((k) => k.toLowerCase()));
    const next = [...cur];
    for (const k of more.map((x) => x.trim())) if (k && !seen.has(k.toLowerCase()) && next.length < MAX_KEYWORDS) { seen.add(k.toLowerCase()); next.push(k); }
    return next;
  });
  const add = () => {
    const k = draft.trim();
    if (!k) return;
    if (k.length > MAX_LENGTH) return setProblem(`A keyword can be at most ${MAX_LENGTH} characters; this one has ${k.length}.`);
    if (keywords.length >= MAX_KEYWORDS) return setProblem(`At most ${MAX_KEYWORDS} keywords. Remove one first.`);
    setProblem('');
    merge([k]);
    setDraft('');
  };
  const suggest = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/research/discovery/keywords', { params: { path: { brandId } } })).then((r) => r.keywords));
  const start = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/research/discoveries', { params: { path: { brandId } }, body: { keywords } })));

  return (
    <>
      <PageHeader title="Find competitors" description="Search the web and the map for businesses like yours, compare them side by side, and choose which to watch." />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8">
        <section aria-labelledby="kw-h" className="grid gap-3">
          <h2 id="kw-h" className="text-xl font-semibold">Keywords</h2>
          <ul aria-label="Keywords" className="flex flex-wrap gap-2">
            {keywords.map((k) => (
              <li key={k} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line-strong bg-panel py-1 pr-1 pl-3 text-sm">
                <span className="min-w-0 break-words">{k}</span>
                <button type="button" className="grid size-6 shrink-0 place-items-center rounded-full hover:bg-[color-mix(in_oklab,var(--theme-ink)_8%,transparent)]" aria-label={`Remove ${k}`} onClick={() => setKeywords((c) => c.filter((x) => x !== k))}>
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <div className="field min-w-0 flex-1 basis-60">
              <label htmlFor="kw-add" className="label">Add a keyword</label>
              <input id="kw-add" className="input" value={draft} aria-describedby="kw-help" aria-invalid={!!problem} onChange={(e) => { setDraft(e.target.value); setProblem(''); }} />
            </div>
            <button type="submit" className="btn btn-secondary">Add keyword</button>
            <button type="button" className="btn btn-secondary" disabled={suggest.isPending} onClick={() => suggest.mutate(undefined, { onSuccess: merge })}>
              {suggest.isPending ? 'Thinking…' : 'Suggest keywords'}
            </button>
          </form>
          <p id="kw-help" className="text-sm text-muted">A keyword without a place in it finds online and aspirational competitors. Up to {MAX_KEYWORDS} keywords.</p>
          {problem ? <p className="text-sm text-danger" role="alert">{problem}</p> : null}
          <MutationError error={suggest.error ?? start.error} />
          <div>
            <button type="button" className="btn btn-primary" disabled={!keywords.length || active || start.isPending} onClick={() => start.mutate()}>
              {start.isPending ? 'Starting…' : 'Search'}
            </button>
          </div>
        </section>
        <Async q={runs} what="searches">
          {(list) => (
            <>
              {latest ? <RunSection brandId={brandId} latest={latest} /> : <StateBlock state="empty" size="inline" title="No search yet">Add keywords, or let Prachaar suggest them from the brand, then press Search. Nothing is searched until you confirm the cost.</StateBlock>}
              <DiscoverTable brandId={brandId} own={list.find((r) => r.ownRow)?.ownRow ?? null} />
            </>
          )}
        </Async>
      </div>
    </>
  );
}

function RunSection({ brandId, latest }: { brandId: string; latest: DiscoveryRun }) {
  const client = useQueryClient();
  const costs = useCosts(brandId);
  const key = discoveryKey(brandId, latest.id);
  const run = useQuery({ queryKey: key, queryFn: () => fetchDiscovery(brandId, latest.id), initialData: latest });
  const confirm = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/research/discoveries/{id}/confirm', bid(brandId, latest.id))));
  const cancel = () => unwrap(api.POST('/api/brands/{brandId}/research/discoveries/{id}/cancel', bid(brandId, latest.id)));
  const retry = () => unwrap(api.POST('/api/brands/{brandId}/research/discoveries/{id}/retry', bid(brandId, latest.id)));
  const r = run.data;
  const state = r.state;

  // When a run settles, what it found must show up without a reload.
  useEffect(() => {
    if (state !== 'running' && state !== 'awaiting_approval') client.invalidateQueries({ queryKey: ['research', brandId] });
  }, [state, client, brandId]);

  const n = r.counts;
  return (
    <section aria-label="Search run" className="grid gap-3">
      <RunProgress queryKey={key} fetchRun={() => fetchDiscovery(brandId, latest.id)} onCancel={cancel} onRetry={retry} label="Search" />
      <MutationError error={confirm.error} />
      {state === 'awaiting_approval' && r.estimate ? (
        <Async q={costs} what="budget">
          {(c) => (
            <CostConfirm estimate={r.estimate!} remaining={c.remaining} onConfirm={() => confirm.mutate()} onCancel={() => cancel().then(() => client.invalidateQueries({ queryKey: ['research', brandId] }))} pending={confirm.isPending}>
              Searching the web and the map for {plural(r.keywords.length, 'keyword', 'keywords')}, then reading what turns up.
            </CostConfirm>
          )}
        </Async>
      ) : null}
      {state === 'completed' ? (
        (n.found ?? 0) === 0 ? (
          <p className="text-sm text-muted">No businesses found. Try broader keywords.</p>
        ) : (
          <p className="text-sm text-muted">
            Found {plural(n.found ?? 0, 'business', 'businesses')}, described {n.profiled ?? 0}; {n.skipped ?? 0} you already watch or hid {(n.skipped ?? 0) === 1 ? 'was' : 'were'} skipped; {plural(n.dropped ?? 0, 'unsupported cell', 'unsupported cells')} dropped.
            {r.actual ? <> Cost <MoneyText value={r.actual} />.</> : null}
          </p>
        )
      ) : null}
    </section>
  );
}
