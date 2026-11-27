import type { Metadata } from 'next';
import { Overview } from '@/components/research/overview';

export const metadata: Metadata = { title: 'Research' };

export default function ResearchPage() {
  return <Overview />;
}
