import type { Metadata } from 'next';
import { BookScreen } from '@/components/brand/book';

export const metadata: Metadata = { title: 'Brand book' };

export default function BrandPage() {
  return <BookScreen />;
}
