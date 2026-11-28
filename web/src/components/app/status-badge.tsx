import {
  Ban, CircleCheck, CircleDashed, CircleHelp, CircleX, Clock3, GitCompareArrows, Hourglass, Loader, RotateCcw,
  Search, Sparkles, type LucideIcon,
} from 'lucide-react';

type Tone = 'neutral' | 'progress' | 'attention' | 'success' | 'danger';

/** Fact statuses (§5.1, plus Research's external_research), run states (Appendix B), and the states modules share: waiting, approved, blocked, failed. */
const STATUSES: Record<string, { label: string; tone: Tone; icon: LucideIcon }> = {
  approved: { label: 'Approved', tone: 'success', icon: CircleCheck },
  unverified: { label: 'Unverified', tone: 'attention', icon: CircleHelp },
  inferred: { label: 'Inferred', tone: 'attention', icon: Sparkles },
  conflicting: { label: 'Conflicting', tone: 'danger', icon: GitCompareArrows },
  expired: { label: 'Expired', tone: 'neutral', icon: Clock3 },
  rejected: { label: 'Rejected', tone: 'neutral', icon: Ban },
  external_research: { label: 'External research', tone: 'neutral', icon: Search },
  running: { label: 'Running', tone: 'progress', icon: Loader },
  awaiting_approval: { label: 'Awaiting approval', tone: 'attention', icon: Hourglass },
  completed: { label: 'Completed', tone: 'success', icon: CircleCheck },
  failed_retryable: { label: 'Failed, can retry', tone: 'danger', icon: RotateCcw },
  failed_final: { label: 'Failed', tone: 'danger', icon: CircleX },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: CircleDashed },
  // Meanings shared by several modules, so like states look alike everywhere.
  waiting: { label: 'Waiting', tone: 'attention', icon: Hourglass },
  blocked: { label: 'Blocked', tone: 'danger', icon: Ban },
  draft: { label: 'Draft', tone: 'neutral', icon: CircleDashed },
  paused: { label: 'Paused', tone: 'neutral', icon: CircleDashed },
  not_drafted: { label: 'Not drafted', tone: 'neutral', icon: CircleDashed },
  watching: { label: 'Watching', tone: 'success', icon: CircleCheck },
  active: { label: 'Active', tone: 'success', icon: CircleCheck },
  archived: { label: 'Archived', tone: 'neutral', icon: CircleDashed },
};

const TONES: Record<Tone, string> = {
  neutral: 'text-muted bg-[color-mix(in_oklab,var(--theme-ink)_7%,transparent)]',
  progress: 'text-brand bg-[color-mix(in_oklab,var(--theme-brand)_12%,transparent)]',
  attention: 'text-ink bg-[color-mix(in_oklab,var(--theme-highlight)_32%,transparent)]',
  success: 'text-success bg-success-bg',
  danger: 'text-danger bg-[color-mix(in_oklab,var(--theme-danger)_11%,transparent)]',
};

/** A status as a word with an icon, never colour alone. Unknown statuses show their raw name, neutral. */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STATUSES[status] ?? { label: status.replaceAll('_', ' '), tone: 'neutral' as Tone, icon: CircleDashed };
  const Icon = s.icon;
  return (
    <span
      data-status={status}
      className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full pr-2.5 pl-2 text-xs font-medium whitespace-nowrap ${TONES[s.tone]}`}
    >
      <Icon className={`size-3.5 ${status === 'running' ? 'motion-safe:animate-spin' : ''}`} strokeWidth={2} aria-hidden />
      {label ?? s.label}
    </span>
  );
}
