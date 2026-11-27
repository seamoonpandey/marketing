import type { BrandBookOut } from '../../contracts/knowledge.ts';
import type { Tx } from '../../db/tenant.ts';
import { listCompetitors } from '../brands/index.ts';
import { listAssets } from './assets.ts';
import { CATALOGUE } from './catalogue.ts';
import { listFacts, type Fact } from './facts/index.ts';
import { getPalette } from './palette/index.ts';
import { readiness } from './readiness.ts';

/** The approved brand in one read: approved facts by section, palette, assets, competitors and readiness. */
export async function brandBook(tx: Tx, brandId: string): Promise<BrandBookOut> {
  const approved: Fact[] = [];
  for (let cursor: string | undefined; ;) {
    const page = await listFacts(tx, brandId, { status: 'approved', cursor, limit: 500 });
    approved.push(...page.items);
    if (!page.next) break;
    cursor = page.next;
  }
  return {
    sections: CATALOGUE.map((s) => ({ key: s.key, label: s.label, facts: approved.filter((f) => f.section === s.key) })),
    palette: await getPalette(tx, brandId),
    assets: await listAssets(tx, brandId),
    competitors: await listCompetitors(tx, brandId),
    readiness: await readiness(tx, brandId),
  };
}
