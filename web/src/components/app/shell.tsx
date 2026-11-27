'use client';

import { Check, ChevronsUpDown, Layers, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Mark } from '@/components/brand';
import { NAV } from '@/nav';
import { useBrand, useBrandId, useBrands } from './brand-scope';

/** The product frame: the side navigation with the active brand always in view (FR-TEN-003), and the page. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15.5rem_minmax(0,1fr)]">
      <a href="#main" className="btn btn-primary sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50">
        Skip to content
      </a>
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:h-dvh md:border-r md:border-b-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 pt-4 pb-3 md:flex-col md:items-stretch md:gap-5 md:px-3 md:pt-5">
          <Link href="/app/brands" className="flex items-center gap-2 rounded-md px-1.5 py-1 text-lg font-semibold tracking-tight">
            <Mark className="size-6" label="" />
            Prachaar
          </Link>
          <div className="ml-auto md:ml-0">
            <Suspense fallback={<div className="skeleton h-12 w-48 md:w-auto" aria-hidden />}>
              <BrandSwitcher />
            </Suspense>
          </div>
          <Suspense fallback={null}>
            <Nav />
          </Suspense>
        </div>
      </aside>
      <main id="main" tabIndex={-1} className="min-w-0 px-4 py-6 outline-none sm:px-8 md:py-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

function Nav() {
  const pathname = usePathname();
  const brandId = useBrandId();
  return (
    <nav aria-label="Product" className="-mx-1 w-full md:mx-0">
      <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {NAV.map((item) => {
          const href = item.href(brandId);
          const current = href !== null && (item.id === 'home' ? pathname === '/app' || pathname.startsWith('/app/brands') : pathname.startsWith(href));
          const Icon = item.icon;
          const base = 'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap';
          return (
            <li key={item.id}>
              {href ? (
                <Link
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={`${base} transition-colors duration-150 ${
                    current ? 'bg-panel text-ink shadow-[0_1px_2px_var(--color-line)]' : 'text-muted hover:bg-[color-mix(in_oklab,var(--theme-ink)_6%,transparent)] hover:text-ink'
                  }`}
                >
                  <Icon className={`size-4 ${current ? 'text-brand' : ''}`} strokeWidth={1.75} aria-hidden />
                  {item.label}
                </Link>
              ) : (
                <span aria-disabled="true" title="Choose a brand first" className={`${base} cursor-not-allowed text-muted opacity-55`}>
                  <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Which section of a brand the page is on, so switching brands keeps it. */
function sectionOf(pathname: string): string {
  return pathname.match(/^\/app\/b\/[^/]+\/([^/]+)/)?.[1] ?? 'brand';
}

function BrandSwitcher() {
  const brandId = useBrandId();
  const pathname = usePathname();
  const active = useBrand(brandId);
  const brands = useBrands();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const name = brandId ? (active.data?.name ?? (active.isError ? 'Unknown brand' : '…')) : null;
  const section = sectionOf(pathname);
  const list = (brands.data ?? []).filter((b) => b.status === 'active');

  return (
    <div ref={root} className="relative md:w-full">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={name ? `Active brand: ${name}. Switch brand` : 'Choose a brand'}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-12 w-56 max-w-full items-center gap-2.5 rounded-lg border border-line bg-panel py-1.5 pr-2 pl-2 text-left transition-colors duration-150 hover:border-line-strong md:w-full"
      >
        <span
          aria-hidden
          className={`grid size-8 shrink-0 place-items-center rounded-md text-sm font-semibold ${name ? 'bg-brand text-brand-ink' : 'bg-surface text-muted'}`}
        >
          {name ? [...name.trim()][0]?.toUpperCase() : <Layers className="size-4" strokeWidth={1.75} />}
        </span>
        <span className="grid min-w-0 flex-1 leading-snug">
          <span className="text-xs text-muted">{name ? 'Brand' : 'No brand chosen'}</span>
          <span data-testid="active-brand" className="text-sm font-semibold break-words">{name ?? 'Choose a brand'}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" strokeWidth={1.75} aria-hidden />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute top-[calc(100%+0.375rem)] right-0 z-40 w-64 rounded-lg border border-line bg-panel p-1.5 shadow-pop md:left-0 md:w-full"
      >
        {brands.isPending ? <div className="skeleton m-1.5 h-4" aria-hidden /> : null}
        {brands.isError ? <p className="px-2 py-1.5 text-sm text-danger">The brands could not be loaded.</p> : null}
        {list.length ? (
          <ul aria-label="Brands" className="grid max-h-72 gap-0.5 overflow-y-auto">
            {list.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/app/b/${b.id}/${section}`}
                  aria-current={b.id === brandId ? 'true' : undefined}
                  className="flex min-h-9 items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-[color-mix(in_oklab,var(--theme-ink)_6%,transparent)]"
                >
                  <span className="min-w-0 flex-1 break-words">{b.name}</span>
                  {b.id === brandId ? <Check className="size-4 text-brand" strokeWidth={2} aria-hidden /> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-1 grid gap-0.5 border-t border-line pt-1">
          <Link href="/app/brands" className="flex h-9 items-center rounded-md px-2 text-sm text-muted hover:bg-[color-mix(in_oklab,var(--theme-ink)_6%,transparent)] hover:text-ink">
            All brands
          </Link>
          <Link href="/app/brands/new" className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted hover:bg-[color-mix(in_oklab,var(--theme-ink)_6%,transparent)] hover:text-ink">
            <Plus className="size-4" strokeWidth={1.75} aria-hidden />
            New brand
          </Link>
        </div>
      </div>
    </div>
  );
}
