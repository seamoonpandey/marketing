// The one place Publish reads Approve and Studio. Every caller takes a Reads argument that tests replace.
import type { ApprovedFact } from '../../contracts/common.ts';
import { isUuid, type Tx } from '../../db/tenant.ts';
import { NotFoundError } from '../../http/errors.ts';
import { validApproval } from '../approve/index.ts';
import { getDraft, listDrafts } from '../studio/index.ts';

export type GateApproval = { id: string; objectId: string; objectVersion: number; payloadHash: string; expiresAt: Date };
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

/** Tests only: stands in for Approve and Studio for every caller, the routes and the workflow included. */
export const testReads: { current?: Reads } = {};

// A valid approval always has an expiry (approvalState reads none as expired); the approvals row type allows null.
const gate: Reads['validApproval'] = async (...a) => {
  const v = await validApproval(...a);
  return v?.expiresAt ? { ...v, expiresAt: v.expiresAt } : null;
};

/** Approve's gate and Studio's drafts. */
export const liveReads: Reads = { validApproval: gate, getDraft, listDrafts };

export async function reads(): Promise<Reads> {
  return testReads.current ?? liveReads;
}


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
