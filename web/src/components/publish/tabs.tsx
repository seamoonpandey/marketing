'use client';

import { ModuleTabs } from '@/components/app';

/** Overview, Calendar, Channels and Settings; a job page keeps Overview current. */
export const PublishTabs = () => <ModuleTabs name="Publish" path="publish" tabs={[['', 'Overview'], ['/calendar', 'Calendar'], ['/channels', 'Channels'], ['/settings', 'Settings']]} />;
