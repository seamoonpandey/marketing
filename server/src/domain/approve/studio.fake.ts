// Tests only: an in-memory Studio behind the adapter's interface, so Approve is tested without Studio's domain.
import { randomUUID } from 'node:crypto';
import type { ApprovedFact } from '../../contracts/common.ts';
import { payloadHash, payloadOf } from './hash.ts';
import type { ReadyDraft, StudioReads } from './studio.ts';

export const content = (caption = 'Warm pashmina shawls, woven in Kathmandu.') => ({
  copies: [{ language: 'en', sentences: [{ text: caption, claim: false, factIds: [] }], hashtags: [], cta: 'Visit us' }],
  slides: [{ headline: 'Winter is here' }], scenes: [], template: 'headline', ratios: ['1:1'], channel: 'facebook',
});

export const fact = (id: string, over: Partial<ApprovedFact> = {}): ApprovedFact => ({
  id, section: 'products', subjectType: 'product', subjectId: null, subjectName: 'Shawl', field: 'price', value: 4500, unit: 'NPR',
  language: 'en', sourceId: null, verifiedAt: '2026-11-01T00:00:00Z', expiresAt: null, ...over,
});

/** The tenant the fake's render keys belong to; tests set it to the test database's tenant. */
export const fakeTenant = { id: 't' };

export const hashOf = (d: ReadyDraft) => payloadHash(payloadOf(d)!);

export function fakeStudio() {
  const drafts = new Map<string, ReadyDraft>();
  const key = (brandId: string, id: string) => `${brandId}/${id.toLowerCase()}`;
  const reads: StudioReads = {
    async getDraft(_tx, brandId, id) {
      const d = drafts.get(key(brandId, id));
      return d ? structuredClone(d) : null;
    },
    async listDrafts(_tx, brandId, _facts, filter) {
      return [...drafts].filter(([k, d]) => k.startsWith(`${brandId}/`) && (!filter?.status || d.status === filter.status)).map(([, d]) => structuredClone(d));
    },
  };
  return {
    reads,
    /** A draft ready at version 1, low risk, one rendered image. */
    put(brandId: string, over: Partial<ReadyDraft> = {}): ReadyDraft {
      const d: ReadyDraft = {
        id: randomUUID(), planItemId: randomUUID(), kind: 'static', status: 'ready', currentVersion: 1, readyVersion: 1, channel: 'facebook',
        day: '2026-12-01', pillar: 'product', campaignId: null, content: content(), leftOut: [], findings: [],
        renders: [{ ratio: '1:1', key: `tenant/${fakeTenant.id}/brand/${brandId}/asset/${randomUUID()}.png`, width: 1080, height: 1080, overflow: false, sha256: 'a'.repeat(64), index: 0, type: 'image' }],
        factIds: [], assetIds: [], ...over,
      };
      drafts.set(key(brandId, d.id), d);
      return structuredClone(d);
    },
    /** Studio's edit: a new version, back to draft until marked ready again. */
    edit(brandId: string, id: string, over: Partial<ReadyDraft> = {}): ReadyDraft {
      const d = drafts.get(key(brandId, id))!;
      const next = { ...d, currentVersion: d.currentVersion + 1, status: 'draft' as const, readyVersion: null, ...over };
      drafts.set(key(brandId, id), next);
      return structuredClone(next);
    },
    remove(brandId: string, id: string) {
      drafts.delete(key(brandId, id));
    },
  };
}
