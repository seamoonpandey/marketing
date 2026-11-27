import type { Metadata } from 'next';
import { Overview } from '@/components/plan/overview';

export const metadata: Metadata = { title: 'Plan' };

export default function Page() {
  return <Overview />;
}
