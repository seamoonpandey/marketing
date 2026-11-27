'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StatusBadge } from './status-badge';

export type RunState = 'running' | 'awaiting_approval' | 'completed' | 'failed_retryable' | 'failed_final' | 'cancelled';
export type Run = { state: RunState; error?: string | null };

/** States that wait for nobody but the owner, so polling stops. */
const SETTLED: RunState[] = ['completed', 'failed_retryable', 'failed_final', 'cancelled'];
const POLL_MS = 3000;

type Props<R extends Run> = {
  queryKey: readonly unknown[];
  fetchRun: () => Promise<R>;
  onCancel?: () => Promise<unknown>;
  onRetry?: () => Promise<unknown>;
  /** What the run is, e.g. "Website import". */
  label: string;
};

/** Polls a run every 3 seconds until it settles, shows its state, and offers cancel and retry. */
export function RunProgress<R extends Run>({ queryKey, fetchRun, onCancel, onRetry, label }: Props<R>) {
  const client = useQueryClient();
  const run = useQuery({
    queryKey,
    queryFn: fetchRun,
    // The interval is the only retry: a failed poll is just one tick lost, not the end of polling.
    // It keeps ticking in a tab that is not in front and while the browser thinks it is offline (those
    // pauses once left a finished run on "Running"), and a tab coming back or reconnecting asks at once.
    retry: false,
    staleTime: 0,
    refetchInterval: (q) => (q.state.data && SETTLED.includes(q.state.data.state) ? false : POLL_MS),
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    networkMode: 'always',
  });
  const refresh = () => client.invalidateQueries({ queryKey });
  const cancel = useMutation({ mutationFn: () => onCancel!(), onSettled: refresh });
  const retry = useMutation({ mutationFn: () => onRetry!(), onSettled: refresh });
  const state = run.data?.state;
  const failed = state === 'failed_retryable' || state === 'failed_final';
  const actionError = cancel.error ?? retry.error;

  return (
    <section aria-label={label} aria-busy={state === 'running'} className="panel grid gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3" role="status">
          <span className="truncate font-semibold">{label}</span>
          {state ? <StatusBadge status={state} /> : <span className="text-sm text-muted">Checking…</span>}
        </div>
        <div className="flex gap-2">
          {onCancel && (state === 'running' || state === 'awaiting_approval') ? (
            <button type="button" className="btn btn-secondary" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              {cancel.isPending ? 'Cancelling…' : 'Cancel'}
            </button>
          ) : null}
          {onRetry && state === 'failed_retryable' ? (
            <button type="button" className="btn btn-primary" onClick={() => retry.mutate()} disabled={retry.isPending}>
              {retry.isPending ? 'Retrying…' : 'Retry from the failed step'}
            </button>
          ) : null}
        </div>
      </div>
      {state === 'running' ? (
        <div className="indeterminate h-1 rounded-full bg-line" aria-hidden />
      ) : null}
      {failed && run.data?.error ? <p className="text-sm text-danger">{run.data.error}</p> : null}
      {run.isError ? (
        <p className="text-sm text-danger" role="alert">The run’s status could not be loaded. Prachaar keeps trying.</p>
      ) : null}
      {actionError ? <p className="text-sm text-danger" role="alert">{actionError.message}</p> : null}
    </section>
  );
}
