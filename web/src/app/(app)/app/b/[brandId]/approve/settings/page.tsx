import type { Metadata } from 'next';
import { SettingsView } from '@/components/approve/settings';

export const metadata: Metadata = { title: 'Approve settings' };

export default function Page() {
  return <SettingsView />;
}
