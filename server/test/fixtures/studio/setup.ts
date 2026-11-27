// An approved week and approved facts, made through the Brand and Plan domain functions.
import type { ApprovedFact } from '../../../src/contracts/common.ts';
import { withBrand } from '../../../src/db/tenant.ts';
import { approvedFacts, enterFact, findOrCreateSubject } from '../../../src/domain/knowledge/index.ts';
import { addItem, approveWeek, setSettings } from '../../../src/domain/plan/index.ts';
import type { Renderer } from '../../../src/domain/studio/render-types.ts';
import { SIZES } from '../../../src/domain/studio/render-types.ts';
import type { TestDb } from '../../helpers.ts';

export const SUN = '2026-11-29';
export const PROOF = 'Hand-woven pashmina, 15% off until 24 October';

export async function studioBrand(t: TestDb, o: { formats?: (string | null)[]; languages?: string[]; approve?: boolean } = {}) {
  const brand = await t.makeBrand();
  if (o.languages) await t.adminQuery(`update brands set languages = $1 where id = $2`, [o.languages, brand]);
  const { facts, itemIds } = await withBrand(brand, async (tx) => {
    await setSettings(tx, brand, { channels: [{ channel: 'instagram', postsPerWeek: 7 }], pillars: [], weekStarts: 0 });
    const shawl = await findOrCreateSubject(tx, brand, 'product', 'Pashmina shawl');
    await enterFact(tx, brand, { section: 'products', field: 'price', value: 4000, unit: 'NPR', subjectId: shawl.id, language: 'en' });
    await enterFact(tx, brand, { section: 'positioning', field: 'proof', value: PROOF, language: 'en' });
    await enterFact(tx, brand, { section: 'voice', field: 'prohibited_words', value: ['guarantee'], language: 'en' });
    const facts = await approvedFacts(tx, brand);
    const itemIds: string[] = [];
    for (const [n, format] of (o.formats ?? ['image', 'carousel']).entries()) {
      const day = new Date(Date.parse(`${SUN}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
      const item = await addItem(tx, brand, SUN, {
        day, channel: 'instagram', ...(format ? { format: format as never } : {}), pillar: 'product', funnel: 'unaware', intent: 'teach',
        idea: `Idea ${n}`, cta: 'Visit us', factIds: [facts[0]!.id],
      });
      itemIds.push(item.id);
    }
    if (o.approve !== false) await approveWeek(tx, brand, SUN, facts);
    return { facts, itemIds };
  });
  const fact = (field: string) => facts.find((f: ApprovedFact) => f.field === field)!;
  return { brand, facts, itemIds, price: fact('price'), proof: fact('proof') };
}

/** A renderer that makes tiny bytes. A headline containing OVERFLOW reports overflow. */
export const fakeRenderer = (): Renderer & { calls: string[]; unavailable: boolean } => {
  const r = {
    calls: [] as string[], unavailable: false,
    async renderSlide(slide: { headline: string }, _kit: unknown, ratio: keyof typeof SIZES) {
      r.calls.push(`${slide.headline}@${ratio}`);
      return { png: new TextEncoder().encode(`png ${slide.headline} ${ratio}`), ...SIZES[ratio], overflow: slide.headline.includes('OVERFLOW') };
    },
    async renderVideo(i: { frames: Uint8Array[]; secondsEach: number[] }) {
      if (r.unavailable) throw new (class RenderUnavailable extends Error {})('no ffmpeg');
      return { mp4: new TextEncoder().encode('mp4'), seconds: i.secondsEach.reduce((a, b) => a + b, 0) };
    },
  };
  return r;
};
