'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { api, hasStatus, unwrap } from '@/lib/api/client';
import { StateBlock } from './state-block';

/** The brand in the URL (/app/b/[brandId]/…), or undefined outside a brand. */
export function useBrandId(): string | undefined {
  return useParams<{ brandId?: string }>().brandId;
}

/** One brand, cached under ['brand', id] for the shell, the scope and module pages alike. */
export function useBrand(brandId: string | undefined) {
  return useQuery({
    queryKey: ['brand', brandId],
    queryFn: () => unwrap(api.GET('/api/brands/{brandId}', { params: { path: { brandId: brandId! } } })),
    enabled: !!brandId,
  });
}

/** Every brand of the tenant, cached under ['brands']. */
export function useBrands() {
  return useQuery({ queryKey: ['brands'], queryFn: () => unwrap(api.GET('/api/brands')) });
}

/**
 * Shows the state of the brand in the URL above its pages: an error when it is not the tenant's (and
 * then hides the pages), a notice when it is archived. The pages render at once, without waiting for
 * the brand, so navigation stays instant; a page that needs the brand reads useBrand(useBrandId()).
 */
export function BrandScope({ children }: { children: ReactNode }) {
  const [missing, setMissing] = useState(false);
  return (
    <>
      <Suspense fallback={null}>
        <BrandStatus onMissing={setMissing} />
      </Suspense>
      {missing ? null : children}
    </>
  );
}

function BrandStatus({ onMissing }: { onMissing: (missing: boolean) => void }) {
  const brandId = useBrandId();
  const brand = useBrand(brandId);
  const missing = hasStatus(brand.error, 404);
  useEffect(() => onMissing(missing), [missing, onMissing]);

  if (brand.isError) {
    return (
      <div className="pb-6">
        <StateBlock
          state="error"
          title={missing ? 'This brand was not found' : 'The brand could not be loaded'}
          action={
            missing ? (
              <Link href="/app/brands" className="btn btn-secondary">See all brands</Link>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => brand.refetch()}>Try again</button>
            )
          }
        >
          {missing ? 'It may have been removed, or the link is wrong.' : brand.error.message}
        </StateBlock>
      </div>
    );
  }
  if (brand.data?.status === 'archived') {
    return (
      <div className="pb-6">
        <StateBlock state="stale" size="inline" title="This brand is archived">
          Its records, costs and audit trail are kept; nothing new runs for it.
        </StateBlock>
      </div>
    );
  }
  return null;
}
