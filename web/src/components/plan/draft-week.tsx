'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CostConfirm, MoneyText, MutationError, RunProgress, StateBlock } from '@/components/app';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { fetchRun, runKey, useAct, type Run } from './lib';

type Ready = Schemas['PlanReady'];
const live = (r?: Run | null) => r?.state === 'running' || r?.state === 'awaiting_approval';

/** "Draft this week": cost first, then the run. Without approved facts or channels it says what to fix. */
export function DraftWeek({ brandId, weekStart, name, ready, latestRun, hasItems }: { brandId: string; weekStart: string; name: string; ready: Ready; latestRun: Run | null; hasItems: boolean }) {
  const client = useQueryClient();
  const path = { params: { path: { brandId, weekStart } } };
  const [est, setEst] = useState<Schemas['PlanEstimate'] | null>(null);
  const estimate = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/plan/weeks/{weekStart}/estimate', path)));
  const draft = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/plan/weeks/{weekStart}/draft', path)));

  const key = runKey(brandId, latestRun?.id ?? '');
  const run = useQuery({ queryKey: key, queryFn: () => fetchRun(brandId, latestRun!.id), enabled: !!latestRun, initialData: latestRun ?? undefined });
  const state = run.data?.state;
  // When a run settles, its items must show up without a reload.
  useEffect(() => {
    if (state && !live(run.data)) client.invalidateQueries({ queryKey: ['plan', brandId] });
  }, [state, run.data, client, brandId]);

  if (!ready.facts || !ready.channels) {
    const facts = !ready.facts;
    return (
      <StateBlock
        state="empty"
        size="inline"
        title={facts ? 'No approved brand facts yet' : 'No channels chosen yet'}
        action={<Link className="btn btn-secondary" href={facts ? `/app/b/${brandId}/brand` : `/app/b/${brandId}/plan/settings`}>{facts ? 'Review the brand' : 'Choose channels'}</Link>}
      >
        {facts ? 'Plans are drafted only from approved facts. Approve some in the brand review first.' : 'Say which channels you post on, and how often, before a week is drafted.'}
      </StateBlock>
    );
  }
  const busy = live(run.data) || estimate.isPending;
  return (
    <section aria-label="Draft the week" className="grid gap-3">
      {est ? (
        <CostConfirm
          estimate={est.estimate}
          remaining={est.remaining}
          pending={draft.isPending}
          onCancel={() => setEst(null)}
          onConfirm={() => draft.mutate(undefined, { onSuccess: () => setEst(null) })}
        >
          Drafting {name} from your approved facts, channels and accepted opportunities. {hasItems ? 'The draft is a new version; the current plan stays until you approve it.' : null}
        </CostConfirm>
      ) : (
        <div>
          <button type="button" className={`btn ${hasItems ? 'btn-secondary' : 'btn-primary'}`} disabled={busy} onClick={() => estimate.mutate(undefined, { onSuccess: setEst })}>
            {estimate.isPending ? 'Estimating…' : hasItems ? `Draft ${name} again` : `Draft ${name}`}
          </button>
        </div>
      )}
      <MutationError error={estimate.error ?? draft.error} />
      {latestRun && run.data ? (
        <>
          {state !== 'completed' ? (
            <RunProgress
              queryKey={key}
              fetchRun={() => fetchRun(brandId, latestRun.id)}
              label="Week draft"
              onCancel={() => unwrap(api.POST('/api/brands/{brandId}/plan/runs/{id}/cancel', { params: { path: { brandId, id: latestRun.id } } }))}
              onRetry={() => unwrap(api.POST('/api/brands/{brandId}/plan/runs/{id}/retry', { params: { path: { brandId, id: latestRun.id } } }))}
            />
          ) : (
            <p className="text-sm text-muted">
              Last draft: {run.data.counts.items ?? 0} idea{run.data.counts.items === 1 ? '' : 's'}
              {run.data.counts.dropped ? `, ${run.data.counts.dropped} dropped because they did not fit the settings` : ''}.
              {run.data.actual ? <> Cost <MoneyText value={run.data.actual} />.</> : null}
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
