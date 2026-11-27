'use client';

import { ModuleTabs } from '@/components/app';

/** The queue and its settings; a preview page keeps Queue current. */
export const ApproveTabs = () => <ModuleTabs name="Approve" path="approve" tabs={[['', 'Queue'], ['/settings', 'Settings']]} />;
