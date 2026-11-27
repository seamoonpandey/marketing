'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

/** Where a week button goes: a link when the week is in the URL, else a handler. */
type Target = { href: string } | { onClick: () => void };

function Step({ to, className, children }: { to: Target; className: string; children: React.ReactNode }) {
  return 'href' in to ? (
    <Link href={to.href} className={className}>{children}</Link>
  ) : (
    <button type="button" className={className} onClick={to.onClick}>{children}</button>
  );
}

/** Previous week, this week and next week: the same three buttons on every module's week screen. Pass `today: null` while on this week. */
export function WeekNav({ prev, next, today }: { prev: Target; next: Target; today: Target | null }) {
  return (
    <nav aria-label="Week" className="flex flex-wrap items-center gap-1.5">
      <Step to={prev} className="btn btn-secondary"><ChevronLeft className="size-4" aria-hidden />Previous week</Step>
      {today ? <Step to={today} className="btn btn-quiet">This week</Step> : null}
      <Step to={next} className="btn btn-secondary">Next week<ChevronRight className="size-4" aria-hidden /></Step>
    </nav>
  );
}
