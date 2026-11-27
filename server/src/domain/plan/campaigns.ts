import { and, desc, eq } from 'drizzle-orm';
import { campaigns } from '../../db/schema/plan.ts';
import type { Tx } from '../../db/tenant.ts';
import { NotFoundError, ValidationError } from '../../http/errors.ts';
import { audit } from '../audit/index.ts';
import { listOpportunities } from '../research/index.ts';
import { isDay, UUID } from './dates.ts';

export type Campaign = typeof campaigns.$inferSelect;
type Fields = Pick<typeof campaigns.$inferInsert, 'name' | 'objective' | 'status' | 'startsOn' | 'endsOn' | 'segmentId' | 'budgetNpr'>;

function check(f: { startsOn?: string | null; endsOn?: string | null; segmentId?: string | null }) {
  for (const d of [f.startsOn, f.endsOn]) if (d && !isDay(d)) throw new ValidationError('Dates are YYYY-MM-DD');
  if (f.startsOn && f.endsOn && f.endsOn < f.startsOn) throw new ValidationError('ends_on is before starts_on');
  if (f.segmentId && !UUID.test(f.segmentId)) throw new ValidationError('segmentId is not an id');
}

/** An opportunity must be this brand's and accepted: another brand's is a 404 (denied), a dismissed or new one a 400. */
export async function createCampaign(
  tx: Tx, brandId: string, i: Omit<Fields, 'status'> & { opportunityId?: string | null },
): Promise<Campaign> {
  check(i);
  if (i.opportunityId) {
    const opp = UUID.test(i.opportunityId) ? (await listOpportunities(tx, brandId)).find((o) => o.id === i.opportunityId) : undefined;
    if (!opp) throw new NotFoundError('opportunity', i.opportunityId);
    if (opp.status !== 'accepted') throw new ValidationError(`The opportunity is ${opp.status}; accept it first`);
  }
  const [row] = await tx.insert(campaigns).values({ ...i, brandId }).returning();
  await audit(tx, { brandId, actor: 'operator', action: 'plan.campaign.create', objectType: 'campaign', objectId: row!.id, result: 'ok' });
  return row!;
}

export async function getCampaign(tx: Tx, brandId: string, id: string): Promise<Campaign> {
  const [row] = UUID.test(id) ? await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.brandId, brandId))) : [];
  if (!row) throw new NotFoundError('campaign', id);
  return row;
}

export async function updateCampaign(tx: Tx, brandId: string, id: string, patch: Partial<Fields>): Promise<Campaign> {
  const cur = await getCampaign(tx, brandId, id);
  check({ startsOn: cur.startsOn, endsOn: cur.endsOn, ...patch });
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const [row] = Object.keys(set).length ? await tx.update(campaigns).set(set).where(eq(campaigns.id, id)).returning() : [cur];
  await audit(tx, { brandId, actor: 'operator', action: 'plan.campaign.update', objectType: 'campaign', objectId: id, result: 'ok' });
  return row!;
}

export async function listCampaigns(tx: Tx, brandId: string, status?: Campaign['status']): Promise<Campaign[]> {
  return tx.select().from(campaigns)
    .where(and(eq(campaigns.brandId, brandId), status ? eq(campaigns.status, status) : undefined)).orderBy(desc(campaigns.createdAt));
}
