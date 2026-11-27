'use client';

import { useQuery } from '@tanstack/react-query';
import { useAct as useBrandAct } from '@/components/app';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { label } from '@/lib/labels';

export type Week = Schemas['PlanWeekView'];
export type Item = Schemas['PlanItem'];
export type Settings = Schemas['PlanSettings'];
export type Campaign = Schemas['PlanCampaign'];
export type Run = Schemas['PlanRun'];
export type FactRef = Schemas['PlanFactRef'];
export type Body = Schemas['PlanBriefBody'];

const root = (b: string) => ['plan', b] as const;
const p = (b: string) => ({ params: { path: { brandId: b } } });

// ---- labels --------------------------------------------------------------------------------

export const CHANNELS = ['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin', 'x', 'whatsapp', 'email', 'website'] as const;
export const PILLARS = ['education', 'product', 'proof', 'founder_team', 'behind_scenes', 'comparison', 'faq', 'culture', 'offer', 'industry_insight', 'community'] as const;
export const FORMATS = ['text', 'image', 'carousel', 'infographic', 'poll', 'story', 'short_video', 'long_video', 'live', 'gif', 'blog', 'email', 'landing_page', 'podcast', 'case_study'] as const;
export const FUNNELS = ['unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware', 'customer', 'advocate'] as const;
export const INTENTS = ['teach', 'demonstrate', 'persuade', 'entertain', 'reassure', 'objection', 'capture_lead', 'activate', 'retain'] as const;
export const OBJECTIVES = ['awareness', 'consideration', 'conversion', 'activation', 'retention', 'referral', 'reputation', 'recruitment', 'partner'] as const;
export const SECTIONS = ['goal_kpi', 'audience', 'offer_message', 'channel_mix', 'creative', 'conversion', 'budget', 'measurement', 'risk'] as const;

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
export const useAct = <V = void, R = unknown>(b: string, fn: (v: V) => Promise<R>) => useBrandAct(root(b), fn);

export const factText = (f: FactRef) =>
  `${f.subjectName ?? label(f.section)} · ${label(f.field)}: ${f.value === undefined || f.value === null ? '' : typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value)}${f.unit ? ` ${f.unit}` : ''}`;
