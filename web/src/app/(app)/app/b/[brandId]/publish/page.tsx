import type { Metadata } from 'next';
import { Dashboard } from '@/components/publish/dashboard';

export const metadata: Metadata = { title: 'Publish' };

export default function PublishPage() {
  return <Dashboard />;
}
