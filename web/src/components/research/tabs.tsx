'use client';

import { ModuleTabs } from '@/components/app';

/** Overview and Opportunities; competitor pages are reached from the overview and keep Overview current. */
export const ResearchTabs = () => <ModuleTabs name="Research" path="research" tabs={[['', 'Overview'], ['/opportunities', 'Opportunities'], ['/discover', 'Find competitors']]} />;
