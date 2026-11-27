import { CircleAlert, Clock, Inbox, PlugZap, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** The states a view can be in besides "ready" (spec §17). */
export type ViewState = 'loading' | 'empty' | 'partial' | 'error' | 'unavailable' | 'rate_limited' | 'stale';

const DEFAULTS: Record<Exclude<ViewState, 'loading'>, { icon: LucideIcon; title: string; tone: 'quiet' | 'warn' | 'danger' }> = {
  empty: { icon: Inbox, title: 'Nothing here yet', tone: 'quiet' },
  partial: { icon: TriangleAlert, title: 'Some of this could not be loaded', tone: 'warn' },
  error: { icon: CircleAlert, title: 'This could not be loaded', tone: 'danger' },
  unavailable: { icon: PlugZap, title: 'The AI provider is not answering', tone: 'warn' },
  rate_limited: { icon: Clock, title: 'Too many requests for now', tone: 'warn' },
  stale: { icon: RefreshCw, title: 'This may be out of date', tone: 'quiet' },
};

const TONE = {
  quiet: 'text-muted bg-[color-mix(in_oklab,var(--theme-ink)_6%,transparent)]',
  warn: 'text-ink bg-[color-mix(in_oklab,var(--theme-highlight)_30%,transparent)]',
  danger: 'text-danger bg-[color-mix(in_oklab,var(--theme-danger)_10%,transparent)]',
};

type Props = {
  state: ViewState;
  /** Overrides the state's default heading. */
  title?: string;
  /** What happened and what to do next, in the product's words. */
  children?: ReactNode;
  /** A recovery or next step: a retry button, a link to add the first item. */
  action?: ReactNode;
  /** `inline` for a strip inside a page section; `block` (default) fills the content area. */
  size?: 'block' | 'inline';
  /** Skeleton rows while loading. */
  rows?: number;
};

/**
 * One component for every not-ready state: loading, empty, partial, error, provider-unavailable,
 * rate-limited and stale. Errors are announced (role=alert); the rest are polite status updates.
 */
export function StateBlock({ state, title, children, action, size = 'block', rows = 3 }: Props) {
  if (state === 'loading') {
    return (
      <div data-state="loading" role="status" aria-busy="true" className={size === 'block' ? 'grid gap-3 py-2' : 'grid gap-2'}>
        <span className="sr-only">{title ?? 'Loading'}</span>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton h-4" style={{ width: `${[92, 74, 58, 81, 66][i % 5]}%` }} aria-hidden />
        ))}
      </div>
    );
  }
  const d = DEFAULTS[state];
  const Icon = d.icon;
  const inline = size === 'inline';
  return (
    <div
      data-state={state}
      role={d.tone === 'danger' ? 'alert' : 'status'}
      className={
        inline
          ? 'flex items-start gap-3 rounded-md border border-line bg-panel px-3 py-2.5'
          : 'flex flex-col items-start gap-3 rounded-lg border border-line bg-panel px-6 py-8 sm:px-8'
      }
    >
      <span className={`grid shrink-0 place-items-center rounded-md ${TONE[d.tone]} ${inline ? 'size-7' : 'size-9'}`} aria-hidden>
        <Icon className={inline ? 'size-4' : 'size-[1.125rem]'} strokeWidth={1.75} />
      </span>
      <div className={inline ? 'grid min-w-0 gap-0.5 pt-0.5' : 'grid max-w-[60ch] gap-1'}>
        <p className={inline ? 'text-sm font-semibold' : 'text-lg font-semibold'}>{title ?? d.title}</p>
        {children ? <div className="text-sm text-muted">{children}</div> : null}
      </div>
      {action ? <div className={inline ? 'ml-auto shrink-0' : 'pt-1'}>{action}</div> : null}
    </div>
  );
}
