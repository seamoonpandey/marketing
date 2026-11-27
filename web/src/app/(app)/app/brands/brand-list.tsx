'use client';

import { ArrowRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { PageHeader, StateBlock, StatusBadge, Time, useBrands } from '@/components/app';
import { ApiError } from '@/lib/api/client';

export function BrandList() {
  const brands = useBrands();
  const newBrand = (
    <Link href="/app/brands/new" className="btn btn-primary">
      <Plus className="size-4" strokeWidth={2} aria-hidden />
      New brand
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Brands"
        description="Each brand keeps its own facts, sources, costs and audit trail. Pick one to work on."
        actions={brands.data?.length ? newBrand : undefined}
      />
      {brands.isPending ? <StateBlock state="loading" rows={4} title="Loading brands" /> : null}
      {brands.isError ? (
        <StateBlock
          state={brands.error instanceof ApiError && brands.error.code === 'rate_limited' ? 'rate_limited' : 'error'}
          title="The brands could not be loaded"
          action={
            <button type="button" className="btn btn-secondary" onClick={() => brands.refetch()} disabled={brands.isFetching}>
              {brands.isFetching ? 'Trying…' : 'Try again'}
            </button>
          }
        >
          Prachaar’s server did not answer. Your brands are safe; try again in a moment.
        </StateBlock>
      ) : null}
      {brands.data && !brands.data.length ? (
        <StateBlock state="empty" title="No brands yet" action={newBrand}>
          Add the brand you market: its name and website. Prachaar then reads the site and your files to build its brand kit.
        </StateBlock>
      ) : null}
      {brands.data?.length ? (
        <ul aria-label="Brands" className="panel divide-y divide-line overflow-hidden">
          {brands.data.map((b) => (
            <li key={b.id}>
              <Link
                href={`/app/b/${b.id}/brand`}
                className="group flex items-center gap-4 px-4 py-3.5 transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--theme-ink)_4%,transparent)] focus-visible:-outline-offset-2 sm:px-5"
              >
                <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-md bg-surface font-semibold text-brand">
                  {[...b.name.trim()][0]?.toUpperCase()}
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate font-semibold">{b.name}</span>
                  <span className="truncate text-sm text-muted">{b.website ? b.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : 'No website yet'}</span>
                </span>
                {b.status === 'archived' ? <StatusBadge status="archived" /> : null}
                <span className="num hidden text-sm text-muted sm:block">Added <Time iso={b.createdAt} tz={b.timezone} year /></span>
                <ArrowRight className="size-4 shrink-0 text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink" strokeWidth={1.75} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
