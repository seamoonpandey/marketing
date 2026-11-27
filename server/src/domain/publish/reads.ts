// The one place Publish reads Approve and Studio (docs/structure.md section 11). Both are built on other
// branches, so they are imported at call time; every caller takes a Reads argument that tests replace.
import type { ApprovedFact } from '../../contracts/common.ts';
import type { Tx } from '../../db/tenant.ts';
import { NotFoundError } from '../../http/errors.ts';

export type GateApproval = { id: string; objectId: string; objectVersion: number; payloadHash: string; expiresAt: Date | string };
export type Render = { ratio: string; key: string; width: number; height: number; sha256: string; index?: number; type?: 'image' | 'video' };
export type DraftForPublish = {
  id: string; kind: string; status: string; currentVersion: number; channel: string; day: string;
  content: unknown; renders: Render[];
};
export type Reads = {
  validApproval(tx: Tx, brandId: string, draftId: string, facts: ApprovedFact[]): Promise<GateApproval | null>;
  getDraft(tx: Tx, brandId: string, draftId: string, facts: ApprovedFact[]): Promise<DraftForPublish | null>;
  listDrafts(tx: Tx, brandId: string, facts: ApprovedFact[], filter?: { status?: 'ready' }): Promise<DraftForPublish[]>;
};

export async function reads(): Promise<Reads> {
  const approve = (await import('../approve/index.ts')) as unknown as Partial<Reads>;
  const studio = (await import('../studio/index.ts')) as unknown as Partial<Reads>;
  if (typeof approve.validApproval !== 'function') throw new Error('Approve does not export validApproval yet');
  if (typeof studio.getDraft !== 'function' || typeof studio.listDrafts !== 'function') throw new Error('Studio does not export getDraft and listDrafts yet');
  return { validApproval: approve.validApproval, getDraft: studio.getDraft, listDrafts: studio.listDrafts };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

/** The brand's draft by id, or null. Studio's getDraft may answer null or throw NotFoundError; a draft with another id is ignored. */
export async function draftOf(r: Reads, tx: Tx, brandId: string, draftId: string, facts: ApprovedFact[]): Promise<DraftForPublish | null> {
  if (!isUuid(draftId)) return null;
  try {
    const d = await r.getDraft(tx, brandId, draftId, facts);
    return d && d.id.toLowerCase() === draftId.toLowerCase() ? d : null;
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

/** The gate: the valid approval of this draft, or null. An approval for another object is treated as none. */
export async function approvalOf(r: Reads, tx: Tx, brandId: string, draftId: string, facts: ApprovedFact[]): Promise<GateApproval | null> {
  if (!isUuid(draftId)) return null;
  const a = await r.validApproval(tx, brandId, draftId, facts);
  return a && a.objectId.toLowerCase() === draftId.toLowerCase() ? a : null;
}
