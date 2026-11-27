'use client';

import { useQuery } from '@tanstack/react-query';
import { StatusBadge, useAct as useBrandAct } from '@/components/app';
import { api, unwrap, type Schemas } from '@/lib/api/client';

export type Job = Schemas['PublishJob'];
export type JobState = Schemas['PublishJobState'];
export type Platform = Schemas['PublishPlatform'];

const root = (b: string) => ['publish', b] as const;
const p = (brandId: string) => ({ path: { brandId } });

// ---- queries -------------------------------------------------------------------------------

export const useSummary = (b: string) =>
  useQuery({ queryKey: [...root(b), 'summary'], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/publish/summary', { params: p(b) })), refetchInterval: 60_000 });

export const useChannels = (b: string) =>
  useQuery({ queryKey: [...root(b), 'channels'], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/publish/channels', { params: p(b) })) });

export const useCapabilities = (b: string) =>
  useQuery({ queryKey: [...root(b), 'capabilities'], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/publish/capabilities', { params: p(b) })) });

export const useSchedulable = (b: string) =>
  useQuery({ queryKey: [...root(b), 'schedulable'], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/publish/schedulable', { params: p(b) })) });

export const useSettings = (b: string) =>
  useQuery({ queryKey: [...root(b), 'settings'], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/publish/settings', { params: p(b) })) });

export const useJobs = (b: string, from: string, to: string, enabled: boolean) =>
  useQuery({
    queryKey: [...root(b), 'jobs', from, to],
    enabled,
    queryFn: () => unwrap(api.GET('/api/brands/{brandId}/publish/jobs', { params: { ...p(b), query: { from, to } } })),
  });

export const useJob = (b: string, id: string) =>
  useQuery({ queryKey: [...root(b), 'job', id], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/publish/jobs/{id}', { params: { path: { brandId: b, id } } })) });

/** A write that refreshes everything the module caches for the brand, so no screen shows stale rows. */
export const useAct = <V = void, R = unknown>(b: string, fn: (v: V) => Promise<R>) => useBrandAct(root(b), fn);

export const jobPath = (b: string, id: string) => ({ params: { path: { brandId: b, id } } });

// ---- labels --------------------------------------------------------------------------------

export const PLATFORMS: Platform[] = ['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin', 'x', 'whatsapp', 'email', 'website'];

/** Each state, what it means and what the owner can do about it. */
export const STATE: Record<JobState, { label: string; badge: string; meaning: string; next: string }> = {
  scheduled: { label: 'Scheduled', badge: 'waiting', meaning: 'Waiting for its time.', next: 'You can move it to another time or cancel it.' },
  publishing: { label: 'Sending', badge: 'running', meaning: 'A send is in progress.', next: 'Nothing to do; this page updates when it ends.' },
  awaiting_manual: { label: 'Post by hand', badge: 'awaiting_approval', meaning: 'Its time has come and this channel is posted by hand.', next: 'Copy the text, download the image, post it, then paste the link.' },
  published: { label: 'Published', badge: 'completed', meaning: 'It is out.', next: 'Open the post from its link.' },
  unknown: { label: 'Outcome unknown', badge: 'unverified', meaning: 'The system could not tell whether the post went out.', next: 'Check the channel, then say whether it was posted.' },
  blocked: { label: 'Blocked', badge: 'blocked', meaning: 'Nothing was sent: the approval or the channel said no at send time.', next: 'Fix the cause, then retry or move it.' },
  failed: { label: 'Failed', badge: 'failed_final', meaning: 'Sending failed.', next: 'Retry it if allowed, or post it by hand and confirm.' },
  cancelled: { label: 'Cancelled', badge: 'cancelled', meaning: 'You stopped it.', next: 'Nothing will be sent. Schedule the draft again if you want it out.' },
};

export function JobBadge({ state }: { state: JobState }) {
  return <StatusBadge status={STATE[state].badge} label={STATE[state].label} />;
}
