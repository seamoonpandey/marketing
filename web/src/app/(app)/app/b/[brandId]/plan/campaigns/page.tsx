import type { Metadata } from 'next';
import { Campaigns } from '@/components/plan/campaigns';

export const metadata: Metadata = { title: 'Campaigns' };

export default function Page() {
  return <Campaigns />;
}
