import { Suspense } from 'react';
import { ResearchTabs } from '@/components/research/tabs';

// The screens read the brand from the URL on the client, so they render behind Suspense.
export default function ResearchLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <ResearchTabs />
      {children}
    </Suspense>
  );
}
