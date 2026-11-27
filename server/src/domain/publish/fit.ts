// What a draft posts on a platform, and whether it fits. Pure.
import { CAPABILITIES, isPlatform } from './capabilities.ts';
import type { DraftForPublish, Render } from './reads.ts';

export type Copy = { language: string; caption: string; cta: string; hashtags: string[] };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The draft's copy per language, read defensively: Studio stores sentences, hashtags without # and a call to action. */
export function copiesOf(content: unknown): Copy[] {
  const copies = (content as { copies?: unknown } | null)?.copies;
  if (!Array.isArray(copies)) return [];
  return copies.map((c) => ({
    language: str(c?.language),
    caption: (Array.isArray(c?.sentences) ? c.sentences : []).map((s: { text?: unknown }) => str(s?.text)).filter(Boolean).join(' '),
    cta: str(c?.cta),
    hashtags: (Array.isArray(c?.hashtags) ? c.hashtags : []).map((h: unknown) => str(h).replace(/^#+/, '')).filter(Boolean).map((h: string) => `#${h}`),
  }));
}

/** The text that is posted: caption, call to action and hashtags. */
export const postText = (c: Copy) => [c.caption, c.cta, c.hashtags.join(' ')].filter(Boolean).join('\n\n');

/** The longest posted text over the draft's languages, in characters (code points). */
export const captionLength = (d: DraftForPublish) => Math.max(0, ...copiesOf(d.content).map((c) => [...postText(c)].length));

export const isVideo = (r: Render) => r.type === 'video' || /\.(mp4|webm|mov)$/i.test(r.key);

/** The renders posted on the platform: those in the first accepted shape the draft has; for a video, the video alone. */
export function mediaFor(d: DraftForPublish, platform: string): { ratio: string | null; items: Render[] } {
  const ratios = isPlatform(platform) ? CAPABILITIES[platform].ratios : [];
  const ratio = ratios.find((r) => d.renders.some((x) => x.ratio === r)) ?? null;
  const all = d.renders.filter((r) => r.ratio === ratio).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return { ratio, items: all.some(isVideo) ? all.filter(isVideo) : all };
}

export function fits(i: { draft: DraftForPublish; captionLength: number; platform: string }): { ok: true } | { ok: false; reason: string } {
  const { draft, platform } = i;
  if (!isPlatform(platform)) return { ok: false, reason: `Unknown platform ${platform}` };
  const cap = CAPABILITIES[platform];
  if (cap.textLimit !== null && i.captionLength > cap.textLimit)
    return { ok: false, reason: `The post is ${i.captionLength} characters; ${platform} takes at most ${cap.textLimit}` };
  if (draft.renders.length === 0) return draft.kind === 'post' ? { ok: true } : { ok: false, reason: 'The draft has no rendered image' };
  const m = mediaFor(draft, platform);
  if (!m.ratio) return { ok: false, reason: `No image in a shape ${platform} accepts (${cap.ratios.join(', ')})` };
  if (m.items.length > cap.maxMedia) return { ok: false, reason: `${m.items.length} images; ${platform} takes at most ${cap.maxMedia}` };
  return { ok: true };
}
