'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError, hasStatus } from '@/lib/api/client';
import { StateBlock, type ViewState } from './state-block';

/** Which state a failure is shown as: by status and code, never by the message's words. */
export function viewStateOf(error: unknown): ViewState {
  if (error instanceof ApiError) {
    if (error.status === 429 || error.code === 'rate_limited') return 'rate_limited';
    if (error.status === 409) return 'stale';
    if (error.code === 'provider_unavailable' || error.status === 0) return 'unavailable';
  }
  return 'error';
}

/**
 * Loading and error handling for one query; `children` renders with data. `what` is a noun phrase
 * without its article ("week", "approval queue"). When a refresh fails but older data is held, the
 * data stays with a stale notice above it. A 404 says the thing is gone and offers no retry.
 */
export function Async<T>({ q, what, rows, children }: { q: UseQueryResult<T>; what: string; rows?: number; children: (data: T) => ReactNode }) {
  const retry = (label: string) => <button type="button" className="btn btn-secondary" onClick={() => void q.refetch()}>{label}</button>;
  if (q.data !== undefined) {
    return (
      <>
        {q.isError ? (
          <div className="pb-4">
            <StateBlock state="stale" size="inline" title="This may be out of date" action={retry('Refresh')}>
              The latest {what} could not be loaded: {q.error.message}
            </StateBlock>
          </div>
        ) : null}
        {children(q.data)}
      </>
    );
  }
  if (q.isPending) return <StateBlock state="loading" title={`Loading the ${what}`} rows={rows} />;
  const gone = hasStatus(q.error, 404);
  return (
    <StateBlock
      state={viewStateOf(q.error)}
      title={`The ${what} could not be ${gone ? 'found' : 'loaded'}`}
      action={gone ? undefined : retry('Try again')}
    >
      {q.error?.message}
    </StateBlock>
  );
}

/** A failed write: its message, with the state's own heading when the cause is not the owner's input. */
export function MutationError({ error }: { error: Error | null }) {
  if (!error) return null;
  const state = viewStateOf(error);
  if (state === 'error') return <p role="alert" className="text-sm text-danger">{error.message}</p>;
  return <StateBlock state={state} size="inline" title={state === 'stale' ? 'This changed since you opened it' : undefined}>{error.message}</StateBlock>;
}
