import type { Metadata } from 'next';
import { Discover } from '@/components/research/discover';

export const metadata: Metadata = { title: 'Find competitors' };

export default function DiscoverPage() {
  return <Discover />;
}
