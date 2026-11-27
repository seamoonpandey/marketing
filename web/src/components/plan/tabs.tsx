'use client';

import { ModuleTabs } from '@/components/app';

export const PlanTabs = () => <ModuleTabs name="Plan" path="plan" tabs={[['', 'Overview'], ['/calendar', 'Calendar'], ['/campaigns', 'Campaigns'], ['/settings', 'Settings']]} />;
