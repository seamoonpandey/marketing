import { Suspense } from 'react';
import { PublishTabs } from '@/components/publish/tabs';

// The screens read the brand from the URL on the client, so they render behind Suspense.
export default function PublishLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <PublishTabs />
      {children}
    </Suspense>
  );
}
