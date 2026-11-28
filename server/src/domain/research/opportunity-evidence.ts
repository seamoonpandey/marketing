// The evidence an opportunity can rest on (opportunities design §3.1), each item a snapshot that stays readable
// after its competitor is deleted, with the short reference (e1, e2, …) the model cites.
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ApprovedFact } from '../../contracts/common.ts';
import { competitors } from '../../db/schema/core.ts';
import { competitorProfiles, discoveryColumns, observations, type DiscoveryColumn, type OpportunityEvidence } from '../../db/schema/research.ts';
import type { Tx } from '../../db/tenant.ts';
import { cleanCut } from '../../text/normalise.ts';
import { listCompetitors } from '../brands/index.ts';
import { approvedFacts } from '../knowledge/index.ts';
import { listCandidates } from './discovery/candidates.ts';
import { listObservations, type ObservationRow } from './observations.ts';

export type EvidenceItem = OpportunityEvidence & { ref: string };

const DAY = 86_400_000;
export const LABEL_MAX = 200; // a competitor's name, as the contract allows it
const DETAIL_MAX = 600;
const COLUMN: Record<DiscoveryColumn, string> = {
  kind: 'Kind', sells: 'Sells', sellsTo: 'Sells to', priceLevel: 'Price level', where: 'Where', pitch: 'Pitch', overlap: 'Overlap',
};

const label = (name: string | null) => cleanCut(name ?? 'Removed competitor', LABEL_MAX);
const observationItem = (o: ObservationRow): OpportunityEvidence => ({
  type: 'observation', id: o.id, label: label(o.competitorName), detail: cleanCut(o.summary, DETAIL_MAX), quote: o.after.quote, sourceId: o.after.sourceId,
});
export const factItem = (f: ApprovedFact): OpportunityEvidence => ({
  type: 'fact', id: f.id, label: 'Your brand',
  detail: cleanCut(`${f.subjectName ? `${f.subjectName} ` : ''}${f.field}: ${typeof f.value === 'string' ? f.value : JSON.stringify(f.value)}${f.unit ? ` ${f.unit}` : ''}`, DETAIL_MAX),
});

/**
 * Observations (60 days, the 40 newest), each competitor's latest profile (12 entries each), the cells of 30 new or
 * watched candidates, then every approved fact. `{ runId }`: that run's observations and the facts only.
 */
export async function buildEvidence(tx: Tx, brandId: string, scope: { runId: string } | 'all'): Promise<EvidenceItem[]> {
  const items: OpportunityEvidence[] = [];
  if (scope === 'all') {
    const since = new Date(Date.now() - 60 * DAY).toISOString();
    items.push(...(await listObservations(tx, brandId, { since })).slice(0, 40).map(observationItem));
    const latest = new Map(
      (await tx.selectDistinctOn([competitorProfiles.competitorId]).from(competitorProfiles)
        .where(eq(competitorProfiles.brandId, brandId)).orderBy(competitorProfiles.competitorId, desc(competitorProfiles.createdAt)))
        .map((p) => [p.competitorId, p]),
    );
    for (const c of await listCompetitors(tx, brandId)) {
      const p = latest.get(c.id);
      for (const e of p?.profile.entries.slice(0, 12) ?? [])
        items.push({ type: 'profile', id: p!.id, label: label(c.name), detail: cleanCut(e.price ? `${e.text} (${e.price})` : e.text, DETAIL_MAX), quote: e.quote, sourceId: e.sourceId });
    }
    for (const c of (await listCandidates(tx, brandId)).slice(0, 30)) {
      for (const col of discoveryColumns) {
        const cell = c.cells[col];
        if (!cell) continue;
        const detail = cleanCut(`${COLUMN[col]}: ${cell.value}${cell.basis === 'inferred' ? ` (inferred: ${cell.reason})` : ''}`, DETAIL_MAX);
        items.push({ type: 'candidate', id: c.id, label: label(c.name), detail, ...(cell.basis === 'quoted' ? { quote: cell.quote, sourceId: cell.sourceId } : {}) });
      }
    }
  } else {
    items.push(...(await listObservations(tx, brandId, { runId: scope.runId })).map(observationItem));
  }
  items.push(...(await approvedFacts(tx, brandId)).map(factItem));
  return items.map((x, i) => ({ ...x, ref: `e${i + 1}` }));
}

/** Evidence for a row from before evidence was stored, built from its observations; a deleted observation is left out. */
export async function observationEvidence(tx: Tx, brandId: string, ids: string[]): Promise<Map<string, OpportunityEvidence>> {
  if (!ids.length) return new Map();
  const rows = await tx
    .select({ o: observations, name: competitors.name }).from(observations)
    .leftJoin(competitors, eq(competitors.id, observations.competitorId))
    .where(and(eq(observations.brandId, brandId), inArray(observations.id, ids)));
  return new Map(rows.map((r) => [r.o.id, observationItem({ ...r.o, competitorName: r.name })]));
}
