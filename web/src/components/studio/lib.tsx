'use client';

import { useQuery } from '@tanstack/react-query';
import { useAct as useBrandAct } from '@/components/app';
import { api, hasStatus, unwrap, type Money, type Schemas } from '@/lib/api/client';

export type Overview = Schemas['StudioOverview'];
export type OverviewItem = Schemas['StudioOverviewItem'];
export type DraftView = Schemas['StudioDraftView'];
export type Run = Schemas['StudioRun'];
export type Ratio = Schemas['StudioRatio'];
export type Template = Schemas['StudioTemplate'];
export type Asset = Schemas['Asset'];

const root = (b: string) => ['studio', b] as const;
const p = (brandId: string) => ({ path: { brandId } });

export const NO_COST: Money = { npr: '0.00', usd: '0.0000' };

export const LANGUAGE_LABEL: Record<string, string> = { en: 'English', ne: 'नेपाली (Nepali)' };
export const CHECK_LABEL: Record<Schemas['StudioCheck'], string> = {
  unverified_number: 'Number not in a cited fact', prohibited_word: 'Prohibited word', too_long: 'Caption too long', missing_cta: 'No call to action',
  expired_fact: 'Cited fact expired', no_rights: 'No licence for an asset', text_overflow: 'Text does not fit', not_rendered: 'Not rendered',
  low_contrast: 'Low contrast', many_hashtags: 'Many hashtags',
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
    retry: (n, e) => !hasStatus(e, 404) && n < 2,
  });

export const useTemplates = (b: string) =>
  useQuery({ queryKey: [...root(b), 'templates'], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/studio/templates', { params: p(b) })), staleTime: 3_600_000 });

export const useAssets = (b: string) =>
  useQuery({ queryKey: [...root(b), 'assets'], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/knowledge/assets', { params: p(b) })) });

/** Why an asset cannot go on a slide (the server refuses a photo without a live licence), or null when it can. */
export function whyUnavailable(a: Asset): string | null {
  if (!a.licensed) return 'No licence recorded.';
  const expires = a.rights.expiresAt ? Date.parse(a.rights.expiresAt) : NaN;
  return !Number.isNaN(expires) && expires < Date.now() ? `The licence expired on ${a.rights.expiresAt!.slice(0, 10)}.` : null;
}

export const runKey = (b: string, id: string) => [...root(b), 'run', id] as const;
export const fetchRun = (b: string, id: string) => unwrap(api.GET('/api/brands/{brandId}/studio/runs/{id}', { params: { path: { brandId: b, id } } }));
export const cancelRun = (b: string, id: string) => unwrap(api.POST('/api/brands/{brandId}/studio/runs/{id}/cancel', { params: { path: { brandId: b, id } } }));
export const retryRun = (b: string, id: string) => unwrap(api.POST('/api/brands/{brandId}/studio/runs/{id}/retry', { params: { path: { brandId: b, id } } }));

/** A write that refreshes everything the module caches for the brand, so no screen shows stale rows. */
export const useAct = <V = void, R = unknown>(b: string, fn: (v: V) => Promise<R>) => useBrandAct(root(b), fn);
