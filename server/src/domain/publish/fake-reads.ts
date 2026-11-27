// Tests only: a stand-in for Approve and Studio that keeps each draft with its brand, as the real ones do.
import { randomUUID } from 'node:crypto';
import type { DraftForPublish, GateApproval, Reads } from './reads.ts';

export function fakeReads() {
  const drafts = new Map<string, DraftForPublish & { brandId: string }>();
  const approvals = new Map<string, GateApproval | null>();
  const reads: Reads = {
    validApproval: async (_tx, brandId, id) => (drafts.get(id)?.brandId === brandId ? approvals.get(id) ?? null : null),
    getDraft: async (_tx, brandId, id) => {
      const d = drafts.get(id);
      return d?.brandId === brandId ? d : null;
    },
    listDrafts: async (_tx, brandId, _facts, filter) =>
      [...drafts.values()].filter((d) => d.brandId === brandId && (!filter?.status || d.status === filter.status)),
  };
  return {
    reads,
    drafts,
    approvals,
    /** A ready draft at version 1, approved for a week unless approval is null. */
    add(brandId: string, d: Partial<DraftForPublish> = {}, approval: Partial<GateApproval> | null = {}): DraftForPublish & { brandId: string } {
      const id = d.id ?? randomUUID();
      const draft = {
        brandId, id, kind: 'post', status: 'ready', currentVersion: 1, channel: 'facebook', day: '2026-12-01', renders: [],
        content: { copies: [{ language: 'en', sentences: [{ text: 'Warm pashmina shawls, woven in Kathmandu.', claim: false, factIds: [] }], hashtags: ['shawl'], cta: 'Visit the shop' }] },
        ...d,
      };
      drafts.set(id, draft);
      approvals.set(id, approval && {
        id: randomUUID(), objectId: id, objectVersion: draft.currentVersion, payloadHash: `hash-${id}-v${draft.currentVersion}`,
        expiresAt: new Date(Date.now() + 7 * 86_400_000), ...approval,
      });
      return draft;
    },
    /** The owner edits the draft: a new version, and the old approval no longer stands. */
    edit(id: string) {
      const d = drafts.get(id)!;
      drafts.set(id, { ...d, currentVersion: d.currentVersion + 1, status: 'draft' });
      approvals.set(id, null);
    },
  };
}
