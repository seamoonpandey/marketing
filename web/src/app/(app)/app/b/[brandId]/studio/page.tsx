import type { Metadata } from 'next';
import { Dashboard } from '@/components/studio/dashboard';

export const metadata: Metadata = { title: 'Studio' };

export default function StudioPage() {
  return <Dashboard />;
}
