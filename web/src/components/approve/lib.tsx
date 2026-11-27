'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleAlert, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react';
import { StatusBadge, useAct as useBrandAct } from '@/components/app';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { formatYmd } from '@/lib/time';

export type State = Schemas['ApproveState'];
type Risk = Schemas['ApproveRisk'];
export type QueueItem = Schemas['ApproveQueueItem'];
export type Preview = Schemas['ApprovePreview'];

export const NOTE_MIN = 20;
export const STATES: State[] = ['waiting', 'approved', 'rejected', 'invalid', 'expired', 'paused'];
export const STATE_LABEL: Record<State, string> = {
  waiting: 'Waiting for you', approved: 'Approved', rejected: 'Rejected', invalid: 'No longer valid', expired: 'Expired', paused: 'Paused',
};
const root = (b: string) => ['approve', b] as const;
const p = (brandId: string) => ({ path: { brandId } });

// ---- queries and writes ----------------------------------------------------------------------

export const useQueue = (b: string, state?: State) =>
  useQuery({
    queryKey: [...root(b), 'queue', state ?? 'all'],
    queryFn: () => unwrap(api.GET('/api/brands/{brandId}/approve/queue', { params: { ...p(b), query: { state } } })),
  });

// Opening a preview records a view on the server, so it is always read fresh.
export const usePreview = (b: string, draftId: string) =>
  useQuery({
    queryKey: [...root(b), 'draft', draftId],
    queryFn: () => unwrap(api.GET('/api/brands/{brandId}/approve/queue/{draftId}', { params: { path: { brandId: b, draftId } } })),
    staleTime: 0,
    retry: false,
  });

/** A write that refreshes every approve view of the brand. */
export const useAct = <V, R>(b: string, fn: (v: V) => Promise<R>) => useBrandAct(root(b), fn);

// ---- formatting ------------------------------------------------------------------------------

/** A YYYY-MM-DD day, written without shifting it through the viewer's time zone. */
export const fmtDay = (day: string) => formatYmd(day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- small shared parts ----------------------------------------------------------------------

// The shared badge knows fact and run statuses; each approval state borrows the closest one's tone and icon.
const BORROWED: Record<State, string> = {
  waiting: 'waiting', approved: 'approved', rejected: 'rejected', invalid: 'blocked', expired: 'expired', paused: 'paused',
};
export function StateTag({ state }: { state: State }) {
  return (
    <span data-approve-state={state} className="inline-flex">
      <StatusBadge status={BORROWED[state]} label={STATE_LABEL[state]} />
    </span>
  );
}

const RISK = {
  high: { icon: ShieldAlert, cls: 'text-danger bg-[color-mix(in_oklab,var(--theme-danger)_11%,transparent)]' },
  medium: { icon: TriangleAlert, cls: 'text-ink bg-[color-mix(in_oklab,var(--theme-highlight)_32%,transparent)]' },
  low: { icon: ShieldCheck, cls: 'text-muted bg-[color-mix(in_oklab,var(--theme-ink)_7%,transparent)]' },
} as const;
export function RiskTag({ risk }: { risk: Risk }) {
  const Icon = RISK[risk].icon;
  return (
    <span data-risk={risk} className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full pr-2.5 pl-2 text-xs font-medium whitespace-nowrap ${RISK[risk].cls}`}>
      <Icon className="size-3.5" strokeWidth={2} aria-hidden />
      {cap(risk)} risk
    </span>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-line-strong bg-[color-mix(in_oklab,var(--theme-highlight)_30%,transparent)] px-4 py-3">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="grid gap-0.5 text-sm">{children}</div>
    </div>
  );
}
