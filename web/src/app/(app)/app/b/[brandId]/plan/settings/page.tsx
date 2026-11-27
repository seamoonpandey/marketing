import type { Metadata } from 'next';
import { SettingsView } from '@/components/plan/settings';

export const metadata: Metadata = { title: 'Plan settings' };

export default function Page() {
  return <SettingsView />;
}
