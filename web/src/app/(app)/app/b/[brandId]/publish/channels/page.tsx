import type { Metadata } from 'next';
import { Channels } from '@/components/publish/channels';

export const metadata: Metadata = { title: 'Publish channels' };

export default function ChannelsPage() {
  return <Channels />;
}
