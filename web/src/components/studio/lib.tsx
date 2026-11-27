'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { StateBlock, type ViewState } from '@/components/app';
import { api, ApiError, unwrap, type Money, type Schemas } from '@/lib/api/client';

export type Overview = Schemas['StudioOverview'];
export type OverviewItem = Schemas['StudioOverviewItem'];
export type DraftView = Schemas['StudioDraftView'];
export type Run = Schemas['StudioRun'];
export type Content = Schemas['StudioContent'];
export type Kind = Schemas['StudioKind'];
export type Ratio = Schemas['StudioRatio'];
export type Template = Schemas['StudioTemplate'];

const root = (b: string) => ['studio', b] as const;
const p = (brandId: string) => ({ path: { brandId } });

export const NO_COST: Money = { npr: '0.00', usd: '0.0000' };

export const KIND_LABEL: Record<Kind, string> = { post: 'Text post', static: 'Single image', carousel: 'Carousel', video: 'Video' };
export const CHANNEL_LABEL: Record<string, string> = {
  facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', x: 'X', whatsapp: 'WhatsApp', email: 'Email', website: 'Website',
};
export const LANGUAGE_LABEL: Record<string, string> = { en: 'English', ne: 'नेपाली (Nepali)' };
export const CHECK_LABEL: Record<Schemas['StudioCheck'], string> = {
  unverified_number: 'Number not in a cited fact', prohibited_word: 'Prohibited word', too_long: 'Caption too long', missing_cta: 'No call to action',
  expired_fact: 'Cited fact expired', no_rights: 'No licence for an asset', text_overflow: 'Text does not fit', not_rendered: 'Not rendered',
  low_contrast: 'Low contrast', many_hashtags: 'Many hashtags',
};

// ---- dates (calendar dates only, no time zones: the API speaks YYYY-MM-DD) -------------------

export const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const formatDay = (ymd: string): string =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
export const formatWeek = (ymd: string): string => {
  const o = { day: 'numeric', month: 'short', timeZone: 'UTC' } as const;
  return `${new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', o)} to ${new Date(`${addDays(ymd, 6)}T00:00:00Z`).toLocaleDateString('en-GB', { ...o, year: 'numeric' })}`;
};

// ---- queries ----------------------------------------------------------------------------------

export const useOverview = (b: string, weekStart?: string) =>
  useQuery({
    queryKey: [...root(b), 'overview', weekStart ?? 'current'],
    queryFn: () => unwrap(api.GET('/api/brands/{brandId}/studio/overview', { params: { ...p(b), query: { weekStart } } })),
  });

export const useDraft = (b: string, id: string) =>
  useQuery({
    queryKey: [...root(b), 'draft', id],
    queryFn: () => unwrap(api.GET('/api/brands/{brandId}/studio/drafts/{id}', { params: { path: { brandId: b, id } } })),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });

export const useTemplates = (b: string) =>
  useQuery({ queryKey: [...root(b), 'templates'], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/studio/templates', { params: p(b) })), staleTime: 3_600_000 });

export const runKey = (b: string, id: string) => [...root(b), 'run', id] as const;
export const fetchRun = (b: string, id: string) => unwrap(api.GET('/api/brands/{brandId}/studio/runs/{id}', { params: { path: { brandId: b, id } } }));
export const cancelRun = (b: string, id: string) => unwrap(api.POST('/api/brands/{brandId}/studio/runs/{id}/cancel', { params: { path: { brandId: b, id } } }));
export const retryRun = (b: string, id: string) => unwrap(api.POST('/api/brands/{brandId}/studio/runs/{id}/retry', { params: { path: { brandId: b, id } } }));

/** A write that refreshes everything Studio caches for the brand, so no screen shows stale rows. */
export function useAct<V = void, R = unknown>(b: string, fn: (v: V) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => client.invalidateQueries({ queryKey: root(b) }) });
}

// ---- states ------------------------------------------------------------------------------------

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
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <StateBlock
        state={stateOf(q.error)}
        title={gone ? `The ${what} could not be found` : `The ${what} could not be loaded`}
        action={gone ? undefined : <button type="button" className="btn btn-secondary" onClick={() => q.refetch()}>Try again</button>}
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
