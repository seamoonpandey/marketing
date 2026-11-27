'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Async, CostConfirm, MoneyText, MutationError, RunProgress, StateBlock } from '@/components/app';
import { api, unwrap } from '@/lib/api/client';
import { fetchRun, runKey, useAct, useCosts, useRuns, type Run } from './lib';
import { sumMoney } from '@/lib/money';

const bid = (b: string, id: string) => ({ params: { path: { brandId: b, id } } });

/** Starts a run, shows the current one, and holds the cost confirmation until the owner agrees. */
export function RunPanel({ brandId, hasTargets }: { brandId: string; hasTargets: boolean }) {
  const runs = useRuns(brandId);
  return (
    <Async q={runs} what="research runs">
      {(list) => <Inner brandId={brandId} latest={list[0]} everCompleted={list.some((r) => r.state === 'completed')} hasTargets={hasTargets} runIds={list.map((r) => r.id)} />}
    </Async>
  );
}

function Inner({ brandId, latest, everCompleted, hasTargets, runIds }: { brandId: string; latest?: Run; everCompleted: boolean; hasTargets: boolean; runIds: string[] }) {
  const client = useQueryClient();
  const costs = useCosts(brandId);
  const key = runKey(brandId, latest?.id ?? '');
  const run = useQuery({ queryKey: key, queryFn: () => fetchRun(brandId, latest!.id), enabled: !!latest, initialData: latest });
  const start = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/research/runs', { params: { path: { brandId } }, body: { trigger: everCompleted ? 'manual' : 'baseline' } })));
  const confirm = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/research/runs/{id}/confirm', bid(brandId, latest!.id))));
  const cancel = () => unwrap(api.POST('/api/brands/{brandId}/research/runs/{id}/cancel', bid(brandId, latest!.id)));
  const retry = () => unwrap(api.POST('/api/brands/{brandId}/research/runs/{id}/retry', bid(brandId, latest!.id)));

  // When a run settles, what it found must show up without a reload.
  const state = run.data?.state;
  useEffect(() => {
    if (state && state !== 'running' && state !== 'awaiting_approval') client.invalidateQueries({ queryKey: ['research', brandId] });
  }, [state, client, brandId]);

  const active = state === 'running' || state === 'awaiting_approval';
  const label = !everCompleted ? 'Baseline run' : 'Research run';
  const r = run.data;

  return (
    <section aria-label="Run" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{everCompleted ? 'Run' : 'First run'}</h2>
        <button type="button" className="btn btn-primary" onClick={() => start.mutate()} disabled={active || start.isPending || !hasTargets}>
          {start.isPending ? 'Starting…' : everCompleted ? 'Run now' : 'Start the baseline'}
        </button>
      </div>
      <MutationError error={start.error ?? confirm.error} />
      {!hasTargets && !latest ? (
        <p className="text-sm text-muted">Add at least one page to watch on a competitor first. The baseline reads each page once and costs nothing until you confirm.</p>
      ) : null}
      {!latest ? (
        hasTargets ? <StateBlock state="empty" size="inline" title="No run yet">The baseline reads every watched page once, so later runs can tell what changed.</StateBlock> : null
      ) : (
        <>
          <RunProgress queryKey={key} fetchRun={() => fetchRun(brandId, latest.id)} onCancel={cancel} onRetry={retry} label={label} />
          {r && state === 'awaiting_approval' && r.estimate ? (
            <Async q={costs} what="budget">
              {(c) => (
                <CostConfirm estimate={r.estimate!} remaining={c.remaining} onConfirm={() => confirm.mutate()} onCancel={() => cancel().then(() => client.invalidateQueries({ queryKey: ['research', brandId] }))} pending={confirm.isPending}>
                  {r.counts.pages ? `Reading ${r.counts.pages} watched page${r.counts.pages === 1 ? '' : 's'}.` : 'Reading the watched pages.'}
                </CostConfirm>
              )}
            </Async>
          ) : null}
          {r && state === 'completed' ? (
            <p className="text-sm text-muted">
              {r.counts.pages} pages read: {r.counts.changed} changed, {r.counts.unchanged} unchanged
              {r.counts.failed ? `, ${r.counts.failed} failed` : ''}. {r.counts.observations} observation{r.counts.observations === 1 ? '' : 's'}, {r.counts.opportunities} opportunit{r.counts.opportunities === 1 ? 'y' : 'ies'}.
              {r.counts.discarded ? ` ${r.counts.discarded} answer${r.counts.discarded === 1 ? ' was' : 's were'} dropped because the quote was not on the page.` : ''}
              {r.actual ? <> Cost <MoneyText value={r.actual} />.</> : null}
            </p>
          ) : null}
        </>
      )}
      <ResearchCost brandId={brandId} runIds={runIds} />
    </section>
  );
}

function ResearchCost({ brandId, runIds }: { brandId: string; runIds: string[] }) {
  const costs = useCosts(brandId);
  if (!costs.data) return null;
  const mine = costs.data.runs.filter((c) => runIds.includes(c.runId));
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
      <div className="flex gap-2"><dt className="text-muted">Research this month</dt><dd className="font-semibold"><MoneyText value={sumMoney(mine.map((c) => c.cost))} /></dd></div>
      <div className="flex gap-2"><dt className="text-muted">Left in the AI budget</dt><dd className="font-semibold"><MoneyText value={costs.data.remaining} /></dd></div>
    </dl>
  );
}
