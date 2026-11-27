'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useBrandId } from '@/components/app';

/** Overview, Calendar, Channels and Settings; a job page keeps Overview current. */
export function PublishTabs() {
  const brandId = useBrandId();
  const path = usePathname();
  const base = `/app/b/${brandId}/publish`;
  const tabs = [[base, 'Overview'], [`${base}/calendar`, 'Calendar'], [`${base}/channels`, 'Channels'], [`${base}/settings`, 'Settings']] as const;
  return (
    <nav aria-label="Publish" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map(([href, label]) => {
        const here = href === base ? !path.startsWith(`${base}/calendar`) && !path.startsWith(`${base}/channels`) && !path.startsWith(`${base}/settings`) : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={here ? 'page' : undefined} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${here ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
