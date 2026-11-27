import type { Metadata } from 'next';
import { DraftEditor } from '@/components/studio/editor';

export const metadata: Metadata = { title: 'Draft' };

export default function DraftPage() {
  return <DraftEditor />;
}
