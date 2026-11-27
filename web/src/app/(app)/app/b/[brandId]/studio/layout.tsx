import { Suspense } from 'react';

// The screens read the brand and the week from the URL on the client, so they render behind Suspense.
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}
