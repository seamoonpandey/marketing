'use client';

import { ModuleTabs } from '@/components/app';

/** The four screens of the Brand module. */
export const BrandNav = () => <ModuleTabs name="Brand" path="brand" tabs={[['', 'Brand book'], ['/sources', 'Sources'], ['/review', 'Review'], ['/visual', 'Visual identity']]} />;
