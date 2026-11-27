'use client';

import { useQuery } from '@tanstack/react-query';
import { useAct as useBrandAct } from '@/components/app';
import { api, unwrap, type Schemas } from '@/lib/api/client';

export type Observation = Schemas['Observation'];
export type Run = Schemas['WatchRun'];

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

// ---- queries -------------------------------------------------------------------------------

export const useCompetitors = (b: string) =>
  useQuery({ queryKey: [...root(b), 'competitors'], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/competitors', { params: p(b) })) });

export const useCosts = (b: string) =>
  useQuery({ queryKey: [...root(b), 'costs'], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/costs', { params: p(b) })) });

export const useRuns = (b: string) =>
  useQuery({
    queryKey: [...root(b), 'runs'],
    queryFn: async () =>
      (await unwrap(api.GET('/api/brands/{brandId}/research/runs', { params: p(b) }))).sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
  });

export const runKey = (b: string, id: string) => [...root(b), 'run', id] as const;
export const fetchRun = async (b: string, id: string) =>
  unwrap(api.GET('/api/brands/{brandId}/research/runs/{id}', { params: { path: { brandId: b, id } } }));

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
export const useAct = <V = void, R = unknown>(b: string, fn: (v: V) => Promise<R>) => useBrandAct(root(b), fn);
