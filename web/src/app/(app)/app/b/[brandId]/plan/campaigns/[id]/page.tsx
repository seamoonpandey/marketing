import type { Metadata } from 'next';
import { CampaignView } from '@/components/plan/campaign-view';

export const metadata: Metadata = { title: 'Campaign' };

export default function Page() {
  return <CampaignView />;
}
