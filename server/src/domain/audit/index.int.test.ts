import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { auditEvents } from '../../db/schema/index.ts';
import { withBrand } from '../../db/tenant.ts';
import { audit, verifyAuditChain } from './index.ts';

let t: TestDb;
let brand: string;
beforeAll(async () => {
  t = await testDb();
  brand = await t.makeBrand();
});
afterAll(() => t.close());

const chain = () =>
  withBrand(brand, (tx) =>
    tx.select().from(auditEvents).where(eq(auditEvents.brandId, brand)).orderBy(asc(auditEvents.seq)),
  );

describe('audit', () => {
  it('chains each row to the one before, so changing an old row breaks the chain', async () => {
    for (const action of ['create', 'update', 'archive']) {
      await withBrand(brand, (tx) =>
        audit(tx, { brandId: brand, actor: 'operator', action, objectType: 'brand', objectId: brand, result: 'ok' }),
      );
    }
    const rows = await chain();
    expect(rows).toHaveLength(3);
    expect(rows[0]!.prevHash).toBeNull();
    expect(rows[1]!.prevHash).toBe(rows[0]!.hash);
    expect(verifyAuditChain(rows)).toBe(true);

    await t.adminQuery(`update audit_events set action = 'tampered' where id = $1`, [rows[0]!.id]);
    expect(verifyAuditChain(await chain())).toBe(false);
  });
});
