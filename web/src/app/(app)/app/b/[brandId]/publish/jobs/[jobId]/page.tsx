import type { Metadata } from 'next';
import { JobView } from '@/components/publish/job-view';

export const metadata: Metadata = { title: 'Post' };

export default function JobPage() {
  return <JobView />;
}
