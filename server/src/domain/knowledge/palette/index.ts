import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { PaletteOut } from '../../../contracts/knowledge.ts';
import { paletteColours, type paletteOrigins, type paletteRoles } from '../../../db/schema/knowledge.ts';
import type { Tx } from '../../../db/tenant.ts';
import { ValidationError } from '../../../http/errors.ts';
import { audit } from '../../audit/index.ts';
import { contrast, toCmyk, toRgb } from './colour.ts';

export { contrast, cssColours, extractPalette, toCmyk, toRgb } from './colour.ts';

type Role = (typeof paletteRoles)[number];
type Origin = (typeof paletteOrigins)[number];

/** The palette with RGB, approximate CMYK, and the contrast of every text colour on every background. */
export async function getPalette(tx: Tx, brandId: string): Promise<PaletteOut> {
  const rows = await tx
    .select()
    .from(paletteColours)
    .where(eq(paletteColours.brandId, brandId))
    .orderBy(sql`${paletteColours.share} desc nulls last`, asc(paletteColours.id));
  const colours = rows.map((r) => ({
    id: r.id, hex: r.hex, role: r.role, origin: r.origin, share: r.share === null ? null : Number(r.share),
    rgb: toRgb(r.hex), cmyk: toCmyk(r.hex),
  }));
  const contrasts = colours
    .filter((t) => t.role === 'text')
    .flatMap((t) => colours.filter((b) => b.role === 'background').map((b) => ({ text: t.hex, background: b.hex })))
    .map((p) => {
      const ratio = contrast(p.text, p.background);
      return { ...p, ratio, aa: ratio >= 4.5, aaLarge: ratio >= 3 };
    });
  return { colours, contrasts };
}

/** Adds colours the palette lacks (by hex), keeping existing ones and their roles. Returns how many were added. */
export async function addColours(tx: Tx, brandId: string, colours: { hex: string; origin: Origin; share?: number }[]): Promise<number> {
  if (!colours.length) return 0;
  const added = await tx
    .insert(paletteColours)
    .values(colours.map((c) => ({ brandId, hex: c.hex.toLowerCase(), origin: c.origin, share: c.share?.toFixed(4) ?? null })))
    .onConflictDoNothing()
    .returning({ id: paletteColours.id });
  return added.length;
}

/**
 * Replaces the palette: listed colours keep their origin and share and take the given role, new
 * ones are the owner's, unlisted ones are removed. The role assignment is the owner's approval.
 */
export async function setPalette(tx: Tx, brandId: string, colours: { hex: string; role: Role | null }[]): Promise<PaletteOut> {
  const list = colours.map((c) => ({ hex: c.hex.toLowerCase(), role: c.role }));
  const hexes = list.map((c) => c.hex);
  if (new Set(hexes).size !== hexes.length) throw new ValidationError('A colour is listed twice');
  await tx
    .delete(paletteColours)
    .where(and(eq(paletteColours.brandId, brandId), hexes.length ? notInArray(paletteColours.hex, hexes) : undefined));
  if (hexes.length) {
    const existing = new Set(
      (await tx.select({ hex: paletteColours.hex }).from(paletteColours)
        .where(and(eq(paletteColours.brandId, brandId), inArray(paletteColours.hex, hexes)))).map((r) => r.hex),
    );
    for (const c of list) {
      if (existing.has(c.hex))
        await tx.update(paletteColours).set({ role: c.role }).where(and(eq(paletteColours.brandId, brandId), eq(paletteColours.hex, c.hex)));
      else await tx.insert(paletteColours).values({ brandId, hex: c.hex, role: c.role, origin: 'owner' });
    }
  }
  await audit(tx, { brandId, actor: 'operator', action: 'palette.update', objectType: 'palette', objectId: brandId, result: 'ok' });
  return getPalette(tx, brandId);
}
