import type { Metadata } from 'next';
import { CompetitorView } from '@/components/research/competitor-view';

export const metadata: Metadata = { title: 'Competitor' };

export default function CompetitorPage() {
  return <CompetitorView />;
}
