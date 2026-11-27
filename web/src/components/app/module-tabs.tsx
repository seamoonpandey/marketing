'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useBrandId } from './brand-scope';

/**
 * The sub-page tabs of a module (`name` is the nav's label, `path` its folder under the brand). A tab's
 * `to` is its path below the module ('' for the first). The first tab is current on every page no other
 * tab claims, so a competitor or a job page keeps Overview lit.
 */
export function ModuleTabs({ name, path, tabs }: { name: string; path: string; tabs: readonly (readonly [to: string, label: string])[] }) {
  const brandId = useBrandId();
  const pathname = usePathname();
  const base = `/app/b/${brandId}/${path}`;
  const claimed = tabs.slice(1).find(([to]) => pathname.startsWith(base + to));
  return (
    <nav aria-label={name} className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map(([to, label], i) => {
        const here = i === 0 ? !claimed : claimed?.[0] === to;
        return (
          <Link
            key={to}
            href={base + to}
            aria-current={here ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${here ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
