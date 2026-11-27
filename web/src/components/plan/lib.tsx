'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { StateBlock, type ViewState } from '@/components/app';
import { api, ApiError, unwrap, type Schemas } from '@/lib/api/client';

export type Week = Schemas['PlanWeekView'];
export type Item = Schemas['PlanItem'];
export type Violation = Schemas['PlanViolation'];
export type Settings = Schemas['PlanSettings'];
export type Campaign = Schemas['PlanCampaign'];
export type Run = Schemas['PlanRun'];
export type FactRef = Schemas['PlanFactRef'];
export type Body = Schemas['PlanBriefBody'];

const root = (b: string) => ['plan', b] as const;
const p = (b: string) => ({ params: { path: { brandId: b } } });

// ---- labels --------------------------------------------------------------------------------

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replaceAll('_', ' ');
export const label = (s: string | null | undefined, fallback = 'Not set') => (s ? (LABELS[s] ?? title(s)) : fallback);
const LABELS: Record<string, string> = {
  x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube', whatsapp: 'WhatsApp', gif: 'GIF',
  goal_kpi: 'Goal and KPI', offer_message: 'Offer and message', channel_mix: 'Channel mix', founder_team: 'Founder and team',
  faq: 'FAQ', cta: 'Call to action', capture_lead: 'Capture a lead',
};
export const CHANNELS = ['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin', 'x', 'whatsapp', 'email', 'website'] as const;
export const PILLARS = ['education', 'product', 'proof', 'founder_team', 'behind_scenes', 'comparison', 'faq', 'culture', 'offer', 'industry_insight', 'community'] as const;
export const FORMATS = ['text', 'image', 'carousel', 'infographic', 'poll', 'story', 'short_video', 'long_video', 'live', 'gif', 'blog', 'email', 'landing_page', 'podcast', 'case_study'] as const;
export const FUNNELS = ['unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware', 'customer', 'advocate'] as const;
export const INTENTS = ['teach', 'demonstrate', 'persuade', 'entertain', 'reassure', 'objection', 'capture_lead', 'activate', 'retain'] as const;
export const OBJECTIVES = ['awareness', 'consideration', 'conversion', 'activation', 'retention', 'referral', 'reputation', 'recruitment', 'partner'] as const;
export const SECTIONS = ['goal_kpi', 'audience', 'offer_message', 'channel_mix', 'creative', 'conversion', 'budget', 'measurement', 'risk'] as const;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---- dates (calendar dates are YYYY-MM-DD strings; arithmetic in UTC so no time zone shifts them) ----

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const addDays = (iso: string, n: number) => new Date(utc(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);
export const fmt = (iso: string, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => utc(iso).toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' });
export const weekRange = (start: string) => `${fmt(start)} – ${fmt(addDays(start, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`;

// ---- queries -------------------------------------------------------------------------------

export const useOverview = (b: string) =>
  useQuery({ queryKey: [...root(b), 'overview'], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/plan/overview', p(b))) });
export const useSettings = (b: string) =>
  useQuery({ queryKey: [...root(b), 'settings'], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/plan/settings', p(b))) });
export const useWeek = (b: string, weekStart: string | undefined) =>
  useQuery({
    queryKey: [...root(b), 'week', weekStart],
    enabled: !!weekStart,
    queryFn: () => unwrap(api.GET('/api/brands/{brandId}/plan/weeks/{weekStart}', { params: { path: { brandId: b, weekStart: weekStart! } } })),
  });
export const useCampaigns = (b: string) =>
  useQuery({ queryKey: [...root(b), 'campaigns'], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/plan/campaigns', p(b))) });
export const useBrief = (b: string, id: string) =>
  useQuery({ queryKey: [...root(b), 'brief', id], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/plan/campaigns/{id}/brief', { params: { path: { brandId: b, id } } })) });
export const fetchRun = (b: string, id: string) => unwrap(api.GET('/api/brands/{brandId}/plan/runs/{id}', { params: { path: { brandId: b, id } } }));
export const runKey = (b: string, id: string) => [...root(b), 'run', id] as const;

/** A write that refreshes everything the module caches for the brand, so no screen shows stale rows. */
export function useAct<V = void, R = unknown>(b: string, fn: (v: V) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => client.invalidateQueries({ queryKey: root(b) }) });
}

// ---- states --------------------------------------------------------------------------------

export function stateOf(error: unknown): ViewState {
  if (error instanceof ApiError) {
    if (error.status === 429 || error.code === 'rate_limited') return 'rate_limited';
    if (error.status === 409) return 'stale';
    if (error.code.includes('provider') || error.status === 0) return 'unavailable';
  }
  return 'error';
}

export function Async<T>({ q, what, children }: { q: UseQueryResult<T>; what: string; children: (data: T) => ReactNode }) {
  if (q.isPending) return <StateBlock state="loading" title={`Loading ${what}`} />;
  if (q.isError) {
    return (
      <StateBlock state={stateOf(q.error)} title={`The ${what} could not be loaded`} action={<button type="button" className="btn btn-secondary" onClick={() => q.refetch()}>Try again</button>}>
        {q.error.message}
      </StateBlock>
    );
  }
  return <>{children(q.data)}</>;
}

/** A failed write: a message, with the state's own heading when the cause is not the owner's input. */
export function MutationError({ error }: { error: Error | null }) {
  if (!error) return null;
  const state = stateOf(error);
  if (state === 'error') return <p role="alert" className="text-sm text-danger">{error.message}</p>;
  return <StateBlock state={state} size="inline" title={state === 'stale' ? 'This changed since you opened it' : undefined}>{error.message}</StateBlock>;
}

export const factText = (f: FactRef) =>
  `${f.subjectName ?? label(f.section)} · ${label(f.field)}: ${f.value === undefined || f.value === null ? '' : typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value)}${f.unit ? ` ${f.unit}` : ''}`;
