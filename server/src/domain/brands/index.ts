import { and, asc, eq, like } from 'drizzle-orm';
import type { BrandCreate, BrandUpdate, CompetitorCreate, CompetitorUpdate } from '../../contracts/brands.ts';
import { brands, competitors } from '../../db/schema/core.ts';
import type { Tx } from '../../db/tenant.ts';
import { NotFoundError } from '../../http/errors.ts';
import { audit } from '../audit/index.ts';

export { routes } from './routes.ts';

export type Brand = typeof brands.$inferSelect;

export type Competitor = {
  id: string;
  name: string;
  kind: 'direct' | 'indirect' | 'aspirational';
  site: string | null;
  handles: Record<string, string>;
  adLibraryUrl: string | null;
  priority: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const operator = 'operator';

/** Latin letters and digits; a name with none (Devanagari, say) becomes "brand". */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'brand';
}

// shortcut: two brands created at the same instant with the same name can race to one slug; the
// unique index then answers 409 and a retry succeeds. Add a retry loop if that ever shows up.
async function uniqueSlug(tx: Tx, name: string): Promise<string> {
  const base = slugify(name);
  const taken = new Set(
    (await tx.select({ slug: brands.slug }).from(brands).where(like(brands.slug, `${base}%`))).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Brands of the tenant, active first, then by name. Runs in withTenant. */
export async function listBrands(tx: Tx): Promise<Brand[]> {
  return tx.select().from(brands).orderBy(asc(brands.status), asc(brands.name));
}

/** Runs in withTenant. Leaves a tenant-level audit event. */
export async function createBrand(tx: Tx, input: BrandCreate): Promise<Brand> {
  const [row] = await tx
    .insert(brands)
    .values({ ...input, slug: await uniqueSlug(tx, input.name) })
    .returning();
  await audit(tx, { actor: operator, action: 'brand.create', objectType: 'brand', objectId: row!.id, result: 'ok' });
  return row!;
}

export async function getBrand(tx: Tx, brandId: string): Promise<Brand> {
  const [row] = await tx.select().from(brands).where(eq(brands.id, brandId));
  if (!row) throw new NotFoundError('brand', brandId);
  return row;
}

export async function updateBrand(tx: Tx, brandId: string, input: BrandUpdate): Promise<Brand> {
  const [row] = await tx.update(brands).set(input).where(eq(brands.id, brandId)).returning();
  if (!row) throw new NotFoundError('brand', brandId);
  await audit(tx, { brandId, actor: operator, action: 'brand.update', objectType: 'brand', objectId: brandId, result: 'ok' });
  return row;
}

/** Marks the brand archived. Its rows, audit trail and costs stay. */
export async function archiveBrand(tx: Tx, brandId: string): Promise<Brand> {
  const [row] = await tx.update(brands).set({ status: 'archived' }).where(eq(brands.id, brandId)).returning();
  if (!row) throw new NotFoundError('brand', brandId);
  await audit(tx, { brandId, actor: operator, action: 'brand.archive', objectType: 'brand', objectId: brandId, result: 'ok' });
  return row;
}

const competitorColumns = {
  id: competitors.id,
  name: competitors.name,
  kind: competitors.kind,
  site: competitors.site,
  handles: competitors.handles,
  adLibraryUrl: competitors.adLibraryUrl,
  priority: competitors.priority,
};

/** The brand's competitors, highest priority first. */
export async function listCompetitors(tx: Tx, brandId: string): Promise<Competitor[]> {
  return tx
    .select(competitorColumns)
    .from(competitors)
    .where(eq(competitors.brandId, brandId))
    .orderBy(asc(competitors.priority), asc(competitors.name));
}

export async function createCompetitor(tx: Tx, brandId: string, input: CompetitorCreate): Promise<Competitor> {
  const [row] = await tx.insert(competitors).values({ ...input, brandId }).returning(competitorColumns);
  await audit(tx, { brandId, actor: operator, action: 'competitor.create', objectType: 'competitor', objectId: row!.id, result: 'ok' });
  return row!;
}

const competitorWhere = (brandId: string, id: string) => and(eq(competitors.id, id), eq(competitors.brandId, brandId));

export async function updateCompetitor(tx: Tx, brandId: string, id: string, input: CompetitorUpdate): Promise<Competitor> {
  const [row] = UUID.test(id)
    ? await tx.update(competitors).set(input).where(competitorWhere(brandId, id)).returning(competitorColumns)
    : [];
  if (!row) throw new NotFoundError('competitor', id);
  await audit(tx, { brandId, actor: operator, action: 'competitor.update', objectType: 'competitor', objectId: id, result: 'ok' });
  return row;
}

export async function deleteCompetitor(tx: Tx, brandId: string, id: string): Promise<void> {
  const [row] = UUID.test(id)
    ? await tx.delete(competitors).where(competitorWhere(brandId, id)).returning({ id: competitors.id })
    : [];
  if (!row) throw new NotFoundError('competitor', id);
  await audit(tx, { brandId, actor: operator, action: 'competitor.delete', objectType: 'competitor', objectId: id, result: 'ok' });
}
