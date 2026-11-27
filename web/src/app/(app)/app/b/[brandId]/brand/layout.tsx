import { Suspense } from 'react';
import { BrandNav } from '@/components/brand/subnav';

// The screens read the brand from the URL on the client, so they render behind Suspense.
export default function BrandModuleLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <BrandNav />
      {children}
    </Suspense>
  );
}
