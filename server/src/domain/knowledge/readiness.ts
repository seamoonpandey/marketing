import { and, eq, ne } from 'drizzle-orm';
import type { ApprovedFact } from '../../contracts/common.ts';
import type { ReadinessOut } from '../../contracts/knowledge.ts';
import { sources } from '../../db/schema/core.ts';
import { assets, facts, paletteColours, subjects } from '../../db/schema/knowledge.ts';
import type { Tx } from '../../db/tenant.ts';
import { listCompetitors } from '../brands/index.ts';
import { fieldDef } from './catalogue.ts';
import { approvedFacts } from './facts/index.ts';

type Criterion = { label: string; pass: boolean; fixPath: string };

/** Sections whose conflicts are a gate: prices and product, legal and trust claims (§5.1). */
const GATED_SECTIONS = ['products', 'legal'];

export function band(score: number, gated: boolean): ReadinessOut['band'] {
  if (gated || score < 50) return 'blocked';
  if (score < 70) return 'draft_only';
  if (score < 85) return 'limited_pilot';
  return 'automation';
}

/**
 * The readiness score (§5.2). Each dimension earns its weight times the share of its criteria that
 * pass; only approved, unexpired facts count. "Every X" criteria fail when there is no X, so a new
 * brand scores 0. Gates (an unresolved conflict on a price or claim, an asset without a licence)
 * make the band `blocked` whatever the score.
 */
export async function readiness(tx: Tx, brandId: string): Promise<ReadinessOut> {
  const at = (path: string) => `/app/b/${brandId}/brand/${path}`;
  const review = (section: string) => at(`review?section=${section}`);

  const approved = await approvedFacts(tx, brandId);
  const live = await tx
    .select({ section: facts.section, field: facts.field, subjectId: facts.subjectId, status: facts.status, subjectName: subjects.name })
    .from(facts)
    .leftJoin(subjects, eq(subjects.id, facts.subjectId))
    .where(and(eq(facts.brandId, brandId), eq(facts.isCurrent, true), ne(facts.status, 'rejected')));
  const subjectRows = await tx.select({ id: subjects.id, type: subjects.type }).from(subjects).where(eq(subjects.brandId, brandId));
  const assetRows = await tx
    .select({ kind: assets.kind, rights: assets.rights, variant: assets.variant, meta: sources.meta })
    .from(assets)
    .innerJoin(sources, eq(sources.id, assets.sourceId))
    .where(eq(assets.brandId, brandId));
  const roles = new Set<string | null>(
    (await tx.select({ role: paletteColours.role }).from(paletteColours).where(eq(paletteColours.brandId, brandId))).map((r) => r.role),
  );
  const competitors = await listCompetitors(tx, brandId);

  const find = (section: string, field: string, subjectId?: string): ApprovedFact | undefined =>
    approved.find((f) => f.section === section && f.field === field && (subjectId === undefined || f.subjectId === subjectId));
  const has = (section: string, field: string, subjectId?: string) => find(section, field, subjectId) !== undefined;
  const filledList = (section: string, field: string) => {
    const v = find(section, field)?.value;
    return Array.isArray(v) && v.length > 0;
  };
  // A product counts once it has an approved fact.
  const products = subjectRows.filter((s) => s.type === 'product' && approved.some((f) => f.subjectId === s.id));
  const segments = subjectRows.filter((s) => s.type === 'segment');
  const conflicts = live.filter((f) => f.status === 'conflicting');
  const licensed = (r: (typeof assetRows)[number]) => typeof r.rights.licence === 'string' && r.rights.licence.trim() !== '';

  const dimension = (key: string, label: string, weight: number, criteria: Criterion[], note?: string) => ({
    key, label, weight, criteria, ...(note ? { note } : {}),
    earned: criteria.length ? (weight * criteria.filter((c) => c.pass).length) / criteria.length : 0,
  });
  const later = (key: string, label: string, module: string) => dimension(key, label, 10, [], `Set up with ${module}`);

  const dimensions = [
    dimension('product_truth', 'Product truth', 15, [
      { label: 'At least one product', pass: products.length > 0, fixPath: review('products') },
      {
        label: 'Every product has an approved name, description and price',
        pass: products.length > 0 && products.every((p) => ['name', 'description', 'price'].every((f) => has('products', f, p.id))),
        fixPath: review('products'),
      },
      {
        label: 'No conflicting product fact',
        pass: products.length > 0 && !conflicts.some((f) => f.section === 'products'),
        fixPath: at('review?section=products&status=conflicting'),
      },
    ]),
    dimension('positioning_audience', 'Positioning and audience', 15, [
      {
        label: 'A segment with an approved problem and desired outcome',
        pass: segments.some((s) => has('audience', 'problem', s.id) && has('audience', 'desired_outcome', s.id)),
        fixPath: review('audience'),
      },
      { label: 'An approved value proposition', pass: has('positioning', 'value_proposition'), fixPath: review('positioning') },
      { label: 'Approved differentiators', pass: has('positioning', 'differentiators'), fixPath: review('positioning') },
    ]),
    dimension('voice_visual', 'Voice and visual', 10, [
      { label: 'Approved voice traits', pass: filledList('voice', 'traits'), fixPath: review('voice') },
      { label: 'A logo', pass: assetRows.some((a) => a.kind === 'logo'), fixPath: at('sources') },
      {
        label: 'Palette roles primary, text and background assigned',
        pass: ['primary', 'text', 'background'].every((r) => roles.has(r)),
        fixPath: at('visual'),
      },
    ]),
    dimension('legal_trust_rights', 'Legal, trust and rights', 15, [
      { label: 'Approved refund terms', pass: has('legal', 'refund'), fixPath: review('legal') },
      { label: 'An approved privacy policy or terms link', pass: has('legal', 'privacy_url') || has('legal', 'terms_url'), fixPath: review('legal') },
      { label: 'Every asset has a licence', pass: assetRows.length > 0 && assetRows.every(licensed), fixPath: at('sources') },
      { label: 'Prohibited claims answered', pass: has('positioning', 'prohibited_claims'), fixPath: review('positioning') },
    ]),
    dimension('goals_budget_approval', 'Goals, budget and approval', 10, [
      { label: 'An approved primary objective', pass: has('goals', 'primary_objective'), fixPath: review('goals') },
      { label: 'An approved maximum AI spend', pass: has('goals', 'max_ai_spend'), fixPath: review('goals') },
      { label: 'At least one approver', pass: filledList('goals', 'approvers'), fixPath: review('goals') },
    ]),
    dimension('competitor_baseline', 'Competitor baseline', 5, [
      { label: 'Three competitors, each with a site', pass: competitors.filter((c) => c.site).length >= 3, fixPath: review('competitors') },
    ]),
    later('channels', 'Channels', 'Publish'),
    later('website_analytics', 'Website, SEO and analytics', 'Results'),
    later('crm', 'CRM and communication', 'Leads'),
  ];

  const gates: { label: string; fixPath: string }[] = [];
  const seen = new Set<string>();
  for (const c of conflicts.filter((f) => GATED_SECTIONS.includes(f.section))) {
    const key = `${c.section}:${c.subjectId}:${c.field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = fieldDef(c.section, c.field)?.label ?? c.field;
    gates.push({
      label: `Resolve the conflicting ${label.toLowerCase()}${c.subjectName ? ` of ${c.subjectName}` : ''}`,
      fixPath: at(`review?section=${c.section}&status=conflicting`),
    });
  }
  for (const a of assetRows.filter((r) => !licensed(r)))
    gates.push({ label: `Add the licence of ${String(a.meta.filename ?? a.variant ?? 'an asset')}`, fixPath: at('sources') });

  const score = Math.round(dimensions.reduce((t, d) => t + d.earned, 0));
  return { score, band: band(score, gates.length > 0), gates, dimensions };
}
