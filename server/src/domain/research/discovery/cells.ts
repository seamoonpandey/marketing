// The cells of a discovered business's row and of the brand's own row (spec §5.3): each kept only when what it cites checks out. Pure.
import { z } from 'zod';
import {
  discoveryColumns as COLUMNS, ownColumns as OWN_COLUMNS, type Cell, type Cells, type DiscoveryColumn as Column, type OwnCell, type OwnRow,
} from '../../../db/schema/research.ts';
import { cleanCut, foldText } from '../../../text/normalise.ts';
import { verifyQuote } from '../../sources/index.ts';

export { COLUMNS, OWN_COLUMNS };
export type { Cell, Cells, Column, OwnCell, OwnRow };

const MAX_VALUE = 200;
const MAX_TEXT = 300;

/** Columns whose value is one of a few words, stored in lower case. */
const VALUES: Partial<Record<Column, string[]>> = {
  kind: ['direct', 'indirect', 'aspirational'], priceLevel: ['low', 'mid', 'high'], overlap: ['high', 'medium', 'low'],
};
/** They compare the business with the brand, so no page can quote them. */
const INFERRED_ONLY: Column[] = ['kind', 'overlap'];

const CellAnswer = z.object({
  value: z.string(),
  basis: z.enum(['quoted', 'inferred']),
  quote: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  evidence: z.array(z.string()).nullable().optional(),
  confidence: z.enum(['low', 'medium', 'high']).nullable().optional(),
}).nullable().optional();
export const RowAnswer = z.object({
  kind: CellAnswer, sells: CellAnswer, sellsTo: CellAnswer, priceLevel: CellAnswer, where: CellAnswer, pitch: CellAnswer, overlap: CellAnswer,
});

const OwnCellAnswer = z.object({ value: z.string(), factIds: z.array(z.string()) }).nullable().optional();
export const OwnRowAnswer = z.object({ sells: OwnCellAnswer, sellsTo: OwnCellAnswer, priceLevel: OwnCellAnswer, where: OwnCellAnswer, pitch: OwnCellAnswer });

/** The value as stored: cleaned and cut, or the canonical word of an enumerated column; '' when it does not qualify. */
function cellValue(col: Column, raw: string): string {
  const value = cleanCut(raw, MAX_VALUE);
  const allowed = VALUES[col];
  if (!allowed) return value;
  const folded = foldText(value);
  return allowed.includes(folded) ? folded : '';
}

type Ctx = { sources: Map<string, string>; factIds: Set<string> };

function checkCell(col: Column, a: NonNullable<z.infer<typeof CellAnswer>>, { sources, factIds }: Ctx): Cell | null {
  const value = cellValue(col, a.value);
  if (!value) return null;
  if (a.basis === 'quoted') {
    const quote = cleanCut(a.quote ?? '', MAX_TEXT);
    const text = a.sourceId ? sources.get(a.sourceId) : undefined;
    if (INFERRED_ONLY.includes(col) || text === undefined || !verifyQuote(text, quote)) return null;
    return { value, basis: 'quoted', quote, sourceId: a.sourceId! };
  }
  const reason = cleanCut(a.reason ?? '', MAX_TEXT);
  const evidence = [...new Set(a.evidence ?? [])];
  if (!reason || !a.confidence || !evidence.length || !evidence.every((id) => sources.has(id) || factIds.has(id))) return null;
  if (col === 'overlap' && !evidence.some((id) => factIds.has(id))) return null;
  return { value, basis: 'inferred', reason, evidence, confidence: a.confidence };
}

/**
 * Keeps a quoted cell only when its quote is in its source (one of this row's), and an inferred cell only with a reason
 * and evidence that are all this row's sources or approved facts; overlap must cite a fact. Counts what it drops.
 */
export function checkCells(answer: z.infer<typeof RowAnswer>, ctx: Ctx): { cells: Cells; dropped: number } {
  const cells: Cells = {};
  let dropped = 0;
  for (const col of COLUMNS) {
    const a = answer[col];
    if (!a) continue;
    const cell = checkCell(col, a, ctx);
    if (cell) cells[col] = cell;
    else dropped++;
  }
  return { cells, dropped };
}

/** The brand's own cells: each kept only with at least one approved fact, and only those facts kept. */
export function checkOwnRow(answer: z.infer<typeof OwnRowAnswer>, factIds: Set<string>): OwnRow {
  const row: OwnRow = {};
  for (const col of OWN_COLUMNS) {
    const a = answer[col];
    const value = a ? cellValue(col, a.value) : '';
    const ids = [...new Set((a?.factIds ?? []).filter((id) => factIds.has(id)))];
    if (value && ids.length) row[col] = { value, factIds: ids };
  }
  return row;
}
