import type { Metadata } from 'next';
import { SourcesScreen } from '@/components/brand/sources';

export const metadata: Metadata = { title: 'Sources' };

export default function SourcesPage() {
  return <SourcesScreen />;
}
