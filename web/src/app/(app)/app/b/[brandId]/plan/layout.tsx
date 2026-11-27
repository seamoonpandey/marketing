import { Suspense } from 'react';
import { PlanTabs } from '@/components/plan/tabs';

// The screens read the brand and week from the URL on the client, so they render behind Suspense.
export default function PlanLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <PlanTabs />
      {children}
    </Suspense>
  );
}
