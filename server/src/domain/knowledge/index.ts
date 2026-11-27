// Module 1 (brand branch). Stub: the brand branch replaces these bodies and adds its routes.
import type { ApprovedFact } from '../../contracts/common.ts';
import type { Tx } from '../../db/tenant.ts';
import { createRouter } from '../../http/router.ts';

/** Routes under /api/brands/{brandId}/knowledge/…, mounted by src/modules.ts. */
export const routes = createRouter();

/** The brand's approved facts, optionally one section. The one way other modules read brand facts. */
export async function approvedFacts(tx: Tx, brandId: string, filter?: { section?: string }): Promise<ApprovedFact[]> {
  void tx;
  void brandId;
  void filter;
  return [];
}
