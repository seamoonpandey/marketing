import type { Metadata } from 'next';
import { Opportunities } from '@/components/research/opportunities';

export const metadata: Metadata = { title: 'Opportunities' };

export default function OpportunitiesPage() {
  return <Opportunities />;
}
