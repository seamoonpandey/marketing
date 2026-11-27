import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** The way up from a detail page: above its header, "Back to" the list it came from. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden />
      {children}
    </Link>
  );
}
