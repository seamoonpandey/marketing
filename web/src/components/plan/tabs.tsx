'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useBrandId } from '@/components/app';

const TABS = [['', 'Overview'], ['/calendar', 'Calendar'], ['/campaigns', 'Campaigns'], ['/settings', 'Settings']] as const;

export function PlanTabs() {
  const brandId = useBrandId();
  const path = usePathname();
  const base = `/app/b/${brandId}/plan`;
  return (
    <nav aria-label="Plan" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map(([suffix, name]) => {
        const href = base + suffix;
        const here = suffix === '' ? path === base : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={here ? 'page' : undefined} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${here ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
            {name}
          </Link>
        );
      })}
    </nav>
  );
}
