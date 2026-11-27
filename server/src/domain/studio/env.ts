// What a draft is checked and rendered against today: the brand's languages, palette and licensed assets.
import { getObject } from '../../storage/index.ts';
import type { Tx } from '../../db/tenant.ts';
import { getBrand } from '../brands/index.ts';
import { getPalette, listAssets } from '../knowledge/index.ts';
import { getSource } from '../sources/index.ts';
import type { BrandKit } from './render-types.ts';

export type Env = {
  languages: string[]; kit: BrandKit;
  /** Assets that may be used now: not a font, a licence recorded, and not past the licence's expiry. */
  usable: Map<string, { kind: string; sourceId: string }>;
  /** Every asset id of the brand, usable or not. */
  assetIds: Set<string>;
};

export const normLang = (l: string) => l.trim().toLowerCase();

export async function loadEnv(tx: Tx, brandId: string, now = new Date()): Promise<Env> {
  const brand = await getBrand(tx, brandId);
  const { colours } = await getPalette(tx, brandId);
  const role = (r: string) => colours.find((c) => c.role === r)?.hex;
  const accent = role('accent');
  const assets = await listAssets(tx, brandId);
  const live = (a: (typeof assets)[number]) => {
    const exp = a.rights.expiresAt ? Date.parse(a.rights.expiresAt) : NaN;
    return a.licensed && a.kind !== 'font' && !(!Number.isNaN(exp) && exp < now.getTime());
  };
  return {
    languages: [...new Set(brand.languages.map(normLang))],
    kit: { colours: { primary: role('primary') ?? '#1f2937', text: role('text') ?? '#141414', background: role('background') ?? '#ffffff', ...(accent ? { accent } : {}) } },
    usable: new Map(assets.filter(live).map((a) => [a.id, { kind: a.kind, sourceId: a.sourceId }])),
    assetIds: new Set(assets.map((a) => a.id)),
  };
}

/** The bytes of a usable asset of this brand (the source is looked up inside the brand's scope). */
export async function assetBytes(tx: Tx, brandId: string, env: Env, assetId: string): Promise<Uint8Array | undefined> {
  const a = env.usable.get(assetId);
  if (!a) return undefined;
  return getObject((await getSource(tx, brandId, a.sourceId)).objectKey);
}

/** The first usable logo, or undefined: a missing or unreadable logo leaves the render without one. */
export async function loadLogo(tx: Tx, brandId: string, env: Env): Promise<Uint8Array | undefined> {
  for (const [id, a] of env.usable)
    if (a.kind === 'logo') return assetBytes(tx, brandId, env, id).catch(() => undefined);
  return undefined;
}
