// What the owner posts by hand: the copy by language and the media in the channel's shape. Shown only
// while the approval still matches what the job was scheduled with.
import type { ApprovedFact } from '../../contracts/common.ts';
import { tenantOf, type Tx } from '../../db/tenant.ts';
import { brandPrefix, presignDownload, underPrefix } from '../../storage/index.ts';
import type { Channel } from './channels.ts';
import { copiesOf, isVideo, mediaFor, type Copy } from './fit.ts';
import type { Job } from './jobs.ts';
import { approvalOf, draftOf, type Reads } from './reads.ts';

export type Package = {
  available: boolean; reason: string | null; ratio: string | null; captions: Copy[];
  media: { index: number; ratio: string; kind: 'image' | 'video'; width: number; height: number; filename: string; url: string }[];
};

const none = (reason: string): Package => ({ available: false, reason, ratio: null, captions: [], media: [] });

export async function jobPackage(tx: Tx, brandId: string, job: Job, channel: Channel | null, r: Reads, facts: ApprovedFact[]): Promise<Package> {
  const draft = await draftOf(r, tx, brandId, job.draftId, facts);
  if (!draft) return none('The draft no longer exists');
  const approval = await approvalOf(r, tx, brandId, job.draftId, facts);
  if (!approval || approval.payloadHash !== job.payloadHash || approval.objectVersion !== job.draftVersion || draft.currentVersion !== job.draftVersion)
    return none('The approval no longer matches what was scheduled, so there is nothing here to post');
  const platform = channel?.platform ?? draft.channel;
  const { ratio, items } = mediaFor(draft, platform);
  const prefix = brandPrefix(await tenantOf(tx), brandId);
  if (items.some((m) => !underPrefix(prefix, m.key))) return none('A media file of this draft is not stored for this brand');
  const media = await Promise.all(
    items.map(async (m, i) => {
      const ext = m.key.slice(m.key.lastIndexOf('.') + 1).toLowerCase();
      return {
        index: m.index ?? i, ratio: m.ratio, kind: isVideo(m) ? ('video' as const) : ('image' as const), width: m.width, height: m.height,
        filename: `${platform}-${i + 1}.${ext}`, url: await presignDownload(m.key),
      };
    }),
  );
  return { available: true, reason: null, ratio, captions: copiesOf(draft.content), media };
}
