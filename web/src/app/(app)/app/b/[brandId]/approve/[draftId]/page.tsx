import type { Metadata } from 'next';
import { PreviewScreen } from '@/components/approve/preview';

export const metadata: Metadata = { title: 'Approve a draft' };

export default function ApprovePreviewPage() {
  return <PreviewScreen />;
}
