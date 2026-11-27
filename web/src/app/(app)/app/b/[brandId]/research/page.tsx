import type { Metadata } from 'next';
import { PageHeader, StateBlock } from '@/components/app';

export const metadata: Metadata = { title: 'Research' };

// Placeholder: the research branch replaces this page (docs/structure.md section 3).
export default function ResearchPage() {
  return (
    <>
      <PageHeader title="Research" description="What competitors publish and change, and the openings it leaves for this brand." />
      <StateBlock state="empty" title="Competitor research is on its way">
        Watching competitors, their changes and battlecards arrive in this sprint.
      </StateBlock>
    </>
  );
}
