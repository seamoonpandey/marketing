import type { Metadata } from 'next';
import { Calendar } from '@/components/plan/calendar';

export const metadata: Metadata = { title: 'Calendar' };

export default function Page() {
  return <Calendar />;
}
