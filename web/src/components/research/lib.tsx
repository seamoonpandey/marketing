'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { StateBlock, type ViewState } from '@/components/app';
import { api, ApiError, unwrap, type Money, type Schemas } from '@/lib/api/client';

export type Observation = Schemas['Observation'];
export type Competitor = Schemas['Competitor'];
// The contract types estimate and actual as `Money & (object | null)`, which no Money satisfies; this is what the API sends.
export type Run = Omit<Schemas['WatchRun'], 'estimate' | 'actual'> & { estimate: Money | null; actual: Money | null };

const root = (brandId: string) => ['research', brandId] as const;
const p = (brandId: string) => ({ path: { brandId } });

export const TYPE_LABEL: Record<Schemas['ObservationType'], string> = {
  price_change: 'Price change',
  new_offer: 'New offer',
  offer_ended: 'Offer ended',
  new_product: 'New product',
  product_removed: 'Product removed',
  messaging_change: 'Messaging change',
  other: 'Other change',
};

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'never';
}

/** Adds NPR/USD decimal strings without floats (4 decimals, as the API sends them). */
export function sumMoney(values: Money[]): Money {
  const scale = (s: string) => {
    const [w, f = ''] = s.split('.');
    return Number(w + f.padEnd(4, '0').slice(0, 4)); // whole 1/10000ths: exact below 2^53
  };
  const fmt = (n: number) => (Math.round(n / 100) / 100).toFixed(2); // shown to 2 decimals
  return {
    npr: fmt(values.reduce((a, v) => a + scale(v.npr), 0)),
    usd: fmt(values.reduce((a, v) => a + scale(v.usd), 0)),
  };
}

// ---- queries -------------------------------------------------------------------------------

export const useCompetitors = (b: string) =>
  useQuery({ queryKey: [...root(b), 'competitors'], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/competitors', { params: p(b) })) });

export const useCosts = (b: string) =>
  useQuery({ queryKey: [...root(b), 'costs'], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/costs', { params: p(b) })) });

export const useRuns = (b: string) =>
  useQuery({
    queryKey: [...root(b), 'runs'],
    queryFn: async () =>
      ((await unwrap(api.GET('/api/brands/{brandId}/research/runs', { params: p(b) }))) as unknown as Run[]).sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
  });

export const runKey = (b: string, id: string) => [...root(b), 'run', id] as const;
export const fetchRun = async (b: string, id: string) =>
  (await unwrap(api.GET('/api/brands/{brandId}/research/runs/{id}', { params: { path: { brandId: b, id } } }))) as unknown as Run;

export const useSchedule = (b: string) =>
  useQuery({ queryKey: [...root(b), 'schedule'], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/research/schedule', { params: p(b) })) });

export const useObservations = (b: string, competitorId?: string) =>
  useQuery({
    queryKey: [...root(b), 'observations', competitorId ?? 'all'],
    queryFn: async () =>
      (await unwrap(api.GET('/api/brands/{brandId}/research/observations', { params: { ...p(b), query: { competitorId } } }))).sort((x, y) =>
        y.observedAt.localeCompare(x.observedAt),
      ),
  });

export const useTargets = (b: string, competitorId?: string) =>
  useQuery({
    queryKey: [...root(b), 'targets', competitorId ?? 'all'],
    queryFn: () => unwrap(api.GET('/api/brands/{brandId}/research/targets', { params: { ...p(b), query: { competitorId } } })),
  });

export const useOpportunities = (b: string, status: 'new' | 'accepted' | 'dismissed') =>
  useQuery({
    queryKey: [...root(b), 'opportunities', status],
    queryFn: () => unwrap(api.GET('/api/brands/{brandId}/research/opportunities', { params: { ...p(b), query: { status } } })),
  });

export const useProfile = (b: string, competitorId: string) =>
  useQuery({
    queryKey: [...root(b), 'profile', competitorId],
    queryFn: () => unwrap(api.GET('/api/brands/{brandId}/research/competitors/{competitorId}/profile', { params: { path: { brandId: b, competitorId } } })),
    retry: false,
  });

export const useBattlecard = (b: string, competitorId: string) =>
  useQuery({
    queryKey: [...root(b), 'battlecard', competitorId],
    queryFn: () => unwrap(api.GET('/api/brands/{brandId}/research/competitors/{competitorId}/battlecard', { params: { path: { brandId: b, competitorId } } })),
  });

/** A write that refreshes everything the module caches for the brand, so no screen shows stale rows. */
export function useAct<V = void, R = unknown>(b: string, fn: (v: V) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => client.invalidateQueries({ queryKey: root(b) }) });
}

// ---- states --------------------------------------------------------------------------------

export function stateOf(error: unknown): ViewState {
  if (error instanceof ApiError) {
    if (error.status === 429 || error.code === 'rate_limited') return 'rate_limited';
    if (error.code.includes('provider')) return 'unavailable';
  }
  return 'error';
}

/** Loading and error handling for one query; `children` renders only with data. */
export function Async<T>({ q, what, children }: { q: UseQueryResult<T>; what: string; children: (data: T) => ReactNode }) {
  if (q.isPending) return <StateBlock state="loading" title={`Loading ${what}`} />;
  if (q.isError) {
    return (
      <StateBlock
        state={stateOf(q.error)}
        title={`The ${what} could not be loaded`}
        action={<button type="button" className="btn btn-secondary" onClick={() => q.refetch()}>Try again</button>}
      >
        {q.error.message}
      </StateBlock>
    );
  }
  return <>{children(q.data)}</>;
}

export function MutationError({ error }: { error: Error | null }) {
  return error ? <p role="alert" className="text-sm text-danger">{error.message}</p> : null;
}
