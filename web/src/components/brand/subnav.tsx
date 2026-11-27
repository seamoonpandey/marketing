'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useBrandId } from '@/components/app';

const TABS = [['', 'Brand book'], ['/sources', 'Sources'], ['/review', 'Review'], ['/visual', 'Visual identity']] as const;

/** The four screens of the Brand module. */
export function BrandNav() {
  const brandId = useBrandId();
  const pathname = usePathname();
  const base = `/app/b/${brandId}/brand`;
  return (
    <nav aria-label="Brand" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map(([p, label]) => {
        const href = base + p;
        const current = p === '' ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={p} href={href} aria-current={current ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${current ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
