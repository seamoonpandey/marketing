import type { ApprovedFact } from '../../contracts/common.ts';
import type { DraftKind } from '../../db/schema/studio.ts';

export type Sentence = { text: string; claim: boolean; factIds?: string[] };

const KINDS: Record<string, DraftKind> = { carousel: 'carousel', short_video: 'video', long_video: 'video', gif: 'video', live: 'video', image: 'static', infographic: 'static', story: 'static' };
/** The design's table: every format not listed is a post. */
export const kindFor = (format: string | null): DraftKind => (format && KINDS[format]) || 'post';

/**
 * Keeps a sentence's fact IDs that are in `facts`; a claim left with none is moved to leftOut. Pure.
 * A non-claim sentence keeps whatever known IDs it has and is never dropped.
 */
export function composeCopy(i: { sentences: Sentence[]; facts: ApprovedFact[] }) {
  const known = new Set(i.facts.map((f) => f.id));
  const sentences: { text: string; claim: boolean; factIds: string[] }[] = [];
  const leftOut: { text: string; reason: string }[] = [];
  for (const s of i.sentences) {
    const factIds = [...new Set((s.factIds ?? []).filter((id) => known.has(id)))];
    if (s.claim && !factIds.length) leftOut.push({ text: s.text, reason: 'no approved fact' });
    else sentences.push({ text: s.text, claim: s.claim, factIds });
  }
  return { sentences, caption: sentences.map((s) => s.text).join(' '), leftOut };
}
