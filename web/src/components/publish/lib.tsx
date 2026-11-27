'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { StateBlock, StatusBadge, type ViewState } from '@/components/app';
import { api, ApiError, unwrap, type Schemas } from '@/lib/api/client';

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

export const useJobs = (b: string, from: string, to: string, enabled: boolean) =>
  useQuery({
    queryKey: [...root(b), 'jobs', from, to],
    enabled,
    queryFn: () => unwrap(api.GET('/api/brands/{brandId}/publish/jobs', { params: { ...p(b), query: { from, to } } })),
  });

export const useJob = (b: string, id: string) =>
  useQuery({ queryKey: [...root(b), 'job', id], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/publish/jobs/{id}', { params: { path: { brandId: b, id } } })) });

/** A write that refreshes everything the module caches for the brand. */
export function useAct<V = void, R = unknown>(b: string, fn: (v: V) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => client.invalidateQueries({ queryKey: root(b) }) });
}

export const jobPath = (b: string, id: string) => ({ params: { path: { brandId: b, id } } });

// ---- labels --------------------------------------------------------------------------------

export const PLATFORM: Record<Platform, string> = {
  facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', x: 'X', whatsapp: 'WhatsApp', email: 'Email', website: 'Website',
};

/** Each state, what it means and what the owner can do about it. */
export const STATE: Record<JobState, { label: string; badge: string; meaning: string; next: string }> = {
  scheduled: { label: 'Scheduled', badge: 'expired', meaning: 'Waiting for its time.', next: 'You can move it to another time or cancel it.' },
  publishing: { label: 'Sending', badge: 'running', meaning: 'A send is in progress.', next: 'Nothing to do; this page updates when it ends.' },
  awaiting_manual: { label: 'Post by hand', badge: 'awaiting_approval', meaning: 'Its time has come and this channel is posted by hand.', next: 'Copy the text, download the image, post it, then paste the link.' },
  published: { label: 'Published', badge: 'completed', meaning: 'It is out.', next: 'Open the post from its link.' },
  unknown: { label: 'Outcome unknown', badge: 'unverified', meaning: 'The system could not tell whether the post went out.', next: 'Check the channel, then say whether it was posted.' },
  blocked: { label: 'Blocked', badge: 'conflicting', meaning: 'Nothing was sent: the approval or the channel said no at send time.', next: 'Fix the cause, then retry or move it.' },
  failed: { label: 'Failed', badge: 'failed_final', meaning: 'Sending failed.', next: 'Retry it if allowed, or post it by hand and confirm.' },
  cancelled: { label: 'Cancelled', badge: 'cancelled', meaning: 'You stopped it.', next: 'Nothing will be sent. Schedule the draft again if you want it out.' },
};

export function JobBadge({ state }: { state: JobState }) {
  return <StatusBadge status={STATE[state].badge} label={STATE[state].label} />;
}

// ---- time: always the brand's timezone -------------------------------------------------------

const safeTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
};

const fmt = (tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: safeTz(tz), hourCycle: 'h23', ...o });
export const dayLabel = (iso: string, tz: string) => fmt(tz, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso)).replace(',', '');
export const timeLabel = (iso: string, tz: string) => fmt(tz, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
/** YYYY-MM-DD of the instant in the timezone. */
export const dayKey = (iso: string | Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: safeTz(tz) }).format(new Date(iso));

/** A time with the day, its zone named beside it. */
export function Time({ iso, tz, day = true }: { iso: string; tz: string; day?: boolean }) {
  return (
    <time dateTime={iso} className="num">
      {day ? `${dayLabel(iso, tz)}, ` : ''}{timeLabel(iso, tz)} <span className="text-muted">{tz}</span>
    </time>
  );
}

function offsetMinutes(tz: string, ms: number): number {
  const parts = Object.fromEntries(fmt(tz, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Math.round((Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!) - Math.floor(ms / 1000) * 1000) / 60000);
}

/** A wall-clock date (YYYY-MM-DD) and time (HH:MM) in the brand's timezone, as ISO 8601 with that zone's offset, whatever the browser's zone is. */
export function wallToIso(date: string, time: string, tz: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  let off = offsetMinutes(tz, wall);
  off = offsetMinutes(tz, wall - off * 60000);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  const hh = (n: number) => String(n).padStart(2, '0');
  return `${date}T${time}:00${sign}${hh(Math.floor(a / 60))}:${hh(a % 60)}`;
}

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ---- states --------------------------------------------------------------------------------

export function stateOf(error: unknown): ViewState {
  if (error instanceof ApiError) {
    if (error.status === 429 || error.code === 'rate_limited') return 'rate_limited';
    if (error.code.includes('provider')) return 'unavailable';
  }
  return 'error';
}

/**
 * Loading and error handling for one query; `children` renders with data. When a refresh fails but
 * older data is held, the data stays with a stale notice above it.
 */
export function Async<T>({ q, what, children }: { q: UseQueryResult<T>; what: string; children: (data: T) => ReactNode }) {
  if (q.data !== undefined) {
    return (
      <>
        {q.isError ? (
          <div className="pb-4">
            <StateBlock state="stale" size="inline" title="This may be out of date" action={<button type="button" className="btn btn-secondary" onClick={() => q.refetch()}>Refresh</button>}>
              The latest {what} could not be loaded.
            </StateBlock>
          </div>
        ) : null}
        {children(q.data)}
      </>
    );
  }
  if (q.isPending) return <StateBlock state="loading" title={`Loading ${what}`} />;
  return (
    <StateBlock state={stateOf(q.error)} title={`The ${what} could not be loaded`} action={<button type="button" className="btn btn-secondary" onClick={() => q.refetch()}>Try again</button>}>
      {q.error?.message}
    </StateBlock>
  );
}

export function MutationError({ error }: { error: Error | null }) {
  return error ? <p role="alert" className="text-sm text-danger">{error.message}</p> : null;
}
