import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReviewScreen } from '@/components/brand/review';

export const metadata: Metadata = { title: 'Review facts' };

export default function ReviewPage() {
  return (
    <Suspense fallback={null}>
      <ReviewScreen />
    </Suspense>
  );
}
