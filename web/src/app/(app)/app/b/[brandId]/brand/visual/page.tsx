import type { Metadata } from 'next';
import { VisualScreen } from '@/components/brand/visual';

export const metadata: Metadata = { title: 'Visual identity' };

export default function VisualPage() {
  return <VisualScreen />;
}
