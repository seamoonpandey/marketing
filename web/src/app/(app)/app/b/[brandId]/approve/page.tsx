import type { Metadata } from 'next';
import { Queue } from '@/components/approve/queue';

export const metadata: Metadata = { title: 'Approve' };

export default function ApprovePage() {
  return <Queue />;
}
