import type { Metadata } from 'next';
import { Calendar } from '@/components/publish/calendar';

export const metadata: Metadata = { title: 'Publish calendar' };

export default function CalendarPage() {
  return <Calendar />;
}
