import type { Metadata } from 'next';
import { Settings } from '@/components/publish/settings';

export const metadata: Metadata = { title: 'Publish settings' };

export default function SettingsPage() {
  return <Settings />;
}
