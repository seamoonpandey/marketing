import { Suspense } from 'react';

// The screens read the brand and draft from the URL on the client, so they render behind Suspense.
export default function ApproveLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}
