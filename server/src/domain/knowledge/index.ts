// Module 1 (brand branch): facts, import, palette, readiness, brand book.
import type { ApprovedFact } from '../../contracts/common.ts';
import type { Tx } from '../../db/tenant.ts';

/** Routes under /api/brands/{brandId}/knowledge/…, mounted by src/modules.ts. */
export { routes } from './routes.ts';

/** The brand's approved facts, optionally one section. The one way other modules read brand facts. */
export async function approvedFacts(tx: Tx, brandId: string, filter?: { section?: string }): Promise<ApprovedFact[]> {
  void tx;
  void brandId;
  void filter;
  return [];
}
