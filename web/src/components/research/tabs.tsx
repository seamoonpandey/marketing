'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useBrandId } from '@/components/app';

/** Overview and Opportunities; competitor pages are reached from the overview and keep Overview current. */
export function ResearchTabs() {
  const brandId = useBrandId();
  const path = usePathname();
  const base = `/app/b/${brandId}/research`;
  return (
    <nav aria-label="Research" className="mb-6 flex gap-1 border-b border-line">
      {[[base, 'Overview'], [`${base}/opportunities`, 'Opportunities']].map(([href, label]) => {
        const here = href === base ? !path.startsWith(`${base}/opportunities`) : path.startsWith(href!);
        return (
          <Link key={href} href={href!} aria-current={here ? 'page' : undefined} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${here ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
