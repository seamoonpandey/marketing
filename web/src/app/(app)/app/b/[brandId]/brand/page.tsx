import type { Metadata } from 'next';
import { PageHeader, StateBlock } from '@/components/app';

export const metadata: Metadata = { title: 'Brand' };

// Placeholder: the brand branch replaces this page (docs/structure.md section 3).
export default function BrandPage() {
  return (
    <>
      <PageHeader title="Brand" description="The brand kit: facts read from the website and files, each with its source, for you to approve." />
      <StateBlock state="empty" title="Brand onboarding is on its way">
        Importing the website and files, approving facts and the readiness score arrive in this sprint.
      </StateBlock>
    </>
  );
}
