import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Home } from '@/components/home/home';

export const metadata: Metadata = { title: 'Home' };

// The screen reads the brand from the URL on the client, so it renders behind Suspense.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
}
