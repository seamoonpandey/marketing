// The one place Approve reads Studio. Every caller takes a StudioReads argument that tests replace.
import type { ApprovedFact } from '../../contracts/common.ts';
import { isUuid, type Tx } from '../../db/tenant.ts';
import { NotFoundError } from '../../http/errors.ts';
import { getDraft, listDrafts } from '../studio/index.ts';

export type ReadyDraft = {
  id: string; planItemId: string; kind: string; status: 'draft' | 'ready';
  currentVersion: number; readyVersion: number | null; channel: string; day: string; // YYYY-MM-DD
  pillar: string | null; campaignId: string | null; content: unknown; leftOut: unknown[];
  findings: { check: string; blocking: boolean; where: string; message: string }[];
  // index and type are optional extras Studio sends, for showing slides in order and a video as a video.
  renders: { ratio: string; key: string; width: number; height: number; overflow: boolean; sha256: string; index?: number; type?: 'image' | 'video' }[];
  factIds: string[]; assetIds: string[];
};

export type StudioReads = {
  getDraft(tx: Tx, brandId: string, draftId: string, facts: ApprovedFact[]): Promise<ReadyDraft | null>;
  listDrafts(tx: Tx, brandId: string, facts: ApprovedFact[], filter?: { status?: 'draft' | 'ready' }): Promise<ReadyDraft[]>;
};

/** Studio's getDraft and listDrafts. */
export const studioReads = async (): Promise<StudioReads> => ({ getDraft, listDrafts });


/** The brand's draft by id, or null when Studio has none (Studio's getDraft may answer null or throw NotFoundError). */
export async function draftOf(studio: StudioReads, tx: Tx, brandId: string, draftId: string, facts: ApprovedFact[]): Promise<ReadyDraft | null> {
  if (!isUuid(draftId)) return null;
  try {
    const d = await studio.getDraft(tx, brandId, draftId, facts);
    return d && d.id.toLowerCase() === draftId.toLowerCase() ? d : null;
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}
