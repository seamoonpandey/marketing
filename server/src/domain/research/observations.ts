import { and, desc, eq, gte } from 'drizzle-orm';
import { competitorProfiles, observations } from '../../db/schema/research.ts';
import { competitors } from '../../db/schema/core.ts';
import { isUuid, type Tx } from '../../db/tenant.ts';
import { NotFoundError } from '../../http/errors.ts';

export type ObservationRow = typeof observations.$inferSelect & { competitorName: string | null };

/** Newest first. A deleted competitor's observations stay, with competitorName null. */
export async function listObservations(
  tx: Tx, brandId: string, f: { competitorId?: string; type?: string; since?: string; runId?: string } = {},
): Promise<ObservationRow[]> {
  if ((f.competitorId && !isUuid(f.competitorId)) || (f.runId && !isUuid(f.runId))) return [];
  const since = f.since ? new Date(f.since) : undefined;
  const rows = await tx
    .select({ o: observations, name: competitors.name })
    .from(observations)
    .leftJoin(competitors, eq(competitors.id, observations.competitorId))
    .where(
      and(
        eq(observations.brandId, brandId),
        f.competitorId ? eq(observations.competitorId, f.competitorId) : undefined,
        f.type ? eq(observations.type, f.type as ObservationRow['type']) : undefined,
        f.runId ? eq(observations.runId, f.runId) : undefined,
        since && !Number.isNaN(since.getTime()) ? gte(observations.observedAt, since) : undefined,
      ),
    )
    .orderBy(desc(observations.observedAt));
  return rows.map((r) => ({ ...r.o, competitorName: r.name }));
}

export async function getProfile(tx: Tx, brandId: string, competitorId: string) {
  const [row] = isUuid(competitorId)
    ? await tx
        .select().from(competitorProfiles)
        .where(and(eq(competitorProfiles.brandId, brandId), eq(competitorProfiles.competitorId, competitorId)))
        .orderBy(desc(competitorProfiles.createdAt)).limit(1)
    : [];
  if (!row) throw new NotFoundError('competitor_profile', competitorId);
  return row;
}
