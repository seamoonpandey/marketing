import { describe, expect, it } from 'vitest';
import { captionLength, copiesOf, fits, mediaFor } from './fit.ts';
import type { DraftForPublish, Render } from './reads.ts';

const r = (ratio: string, index = 0, type: 'image' | 'video' = 'image'): Render => ({
  ratio, index, type, key: `k/${ratio}/${index}.${type === 'video' ? 'mp4' : 'png'}`, width: 1080, height: 1080, sha256: 's',
});
const draft = (o: Partial<DraftForPublish> = {}): DraftForPublish => ({
  id: 'd', kind: 'post', status: 'ready', currentVersion: 1, channel: 'x', day: '2026-12-01',
  content: { copies: [{ language: 'en', sentences: [{ text: 'Hello.' }], hashtags: [], cta: '' }] }, renders: [], ...o,
});
const fit = (d: DraftForPublish, platform: string) => fits({ draft: d, captionLength: captionLength(d), platform });

describe('fits', () => {
  it('refuses a 300-character caption on x, and accepts 280', () => {
    const long = draft({ content: { copies: [{ language: 'en', sentences: [{ text: 'a'.repeat(300) }], hashtags: [], cta: '' }] } });
    expect(fit(long, 'x')).toEqual({ ok: false, reason: expect.stringMatching(/300 characters; x takes at most 280/) });
    expect(fits({ draft: draft(), captionLength: 280, platform: 'x' })).toEqual({ ok: true });
    expect(fit(long, 'facebook')).toEqual({ ok: true });
  });

  it('counts the call to action and hashtags in the length', () => {
    const d = draft({ content: { copies: [{ language: 'en', sentences: [{ text: 'a'.repeat(270) }], hashtags: ['#nepal', 'shawl'], cta: 'Visit' }] } });
    expect(copiesOf(d.content)[0]!.hashtags).toEqual(['#nepal', '#shawl']);
    expect(captionLength(d)).toBe(270 + 2 + 5 + 2 + 13);
    expect(fit(d, 'x').ok).toBe(false);
  });

  it('refuses a draft with only a 16:9 render on instagram', () => {
    expect(fit(draft({ kind: 'static', renders: [r('16:9')] }), 'instagram')).toEqual({ ok: false, reason: expect.stringMatching(/No image in a shape instagram accepts/) });
    expect(fit(draft({ kind: 'static', renders: [r('16:9'), r('4:5')] }), 'instagram')).toEqual({ ok: true });
  });

  it('refuses five images on x and accepts four', () => {
    const five = [0, 1, 2, 3, 4].map((i) => r('1:1', i));
    expect(fit(draft({ kind: 'carousel', renders: five }), 'x')).toEqual({ ok: false, reason: '5 images; x takes at most 4' });
    expect(fit(draft({ kind: 'carousel', renders: five.slice(0, 4) }), 'x')).toEqual({ ok: true });
  });

  it('accepts a post draft with no render on x, refuses a static draft with none, and refuses an unknown platform', () => {
    expect(fit(draft(), 'x')).toEqual({ ok: true });
    expect(fit(draft({ kind: 'static' }), 'x').ok).toBe(false);
    expect(fit(draft(), 'myspace').ok).toBe(false);
  });

  it('posts the first accepted shape in order, and a video alone', () => {
    const d = draft({ kind: 'carousel', renders: [r('1:1', 1), r('4:5', 0), r('1:1', 0)] });
    expect(mediaFor(d, 'instagram')).toMatchObject({ ratio: '1:1', items: [{ index: 0 }, { index: 1 }] });
    const v = draft({ kind: 'video', renders: [r('9:16', 0), r('9:16', 1), r('9:16', 0, 'video')] });
    expect(mediaFor(v, 'tiktok').items).toEqual([r('9:16', 0, 'video')]);
    expect(fit(v, 'tiktok')).toEqual({ ok: true });
  });
});
