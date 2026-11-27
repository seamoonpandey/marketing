import { eq, sql } from 'drizzle-orm';
import { config } from '../config.ts';
import { audit } from '../domain/audit/index.ts';
import { NotFoundError } from '../http/errors.ts';
import { db, type Db } from './client.ts';
import { brands, tenants } from './schema/core.ts';

/** A Drizzle transaction whose tenant (and brands) are set for RLS. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

let tenant: Promise<string> | undefined;

/** The one tenant the app runs as, resolved from TENANT_SLUG. Login will change only this. */
export function currentTenantId(): Promise<string> {
  tenant ??= db()
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, config.TENANT_SLUG))
    .then(([row]) => {
      if (!row) throw new Error(`Tenant "${config.TENANT_SLUG}" is not seeded: run \`pnpm seed\``);
      return row.id;
    })
    .catch((e) => {
      tenant = undefined;
      throw e;
    });
  return tenant;
}

/** Forgets the cached tenant. Tests only. */
export function resetTenantCache(): void {
  tenant = undefined;
}

// set_config(..., true) is transaction-local, so a pooled connection keeps no context afterwards.
async function scoped<T>(brandIds: string[], fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tenantId = await currentTenantId();
  return db().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.brand_ids', ${`{${brandIds.join(',')}}`}, true)`,
    );
    return fn(tx);
  });
}

/** Runs fn in a transaction scoped to the tenant: tenant-level rows only, no brand-owned rows. */
export function withTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return scoped([], fn);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** True for a UUID. Check an id from a request before Postgres sees it, which answers a malformed one with an error, not a miss. */
export const isUuid = (s: string): boolean => UUID.test(s);

/**
 * Runs fn in a transaction scoped to one brand of the tenant. A brand outside the tenant, or a
 * NotFoundError thrown by fn, rolls back, leaves one `denied` audit event and rethrows.
 */
export async function withBrand<T>(brandId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let brandFound = false;
  try {
    if (!isUuid(brandId)) throw new NotFoundError('brand', brandId);
    return await scoped([brandId], async (tx) => {
      const [row] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId));
      if (!row) throw new NotFoundError('brand', brandId);
      brandFound = true;
      return fn(tx);
    });
  } catch (e) {
    if (e instanceof NotFoundError) {
      // A brand outside the tenant gets a tenant-level event, so no row names another tenant's brand.
      await scoped(brandFound ? [brandId] : [], (tx) =>
        audit(tx, {
          brandId: brandFound ? brandId : undefined,
          actor: 'operator',
          action: 'access',
          objectType: e.objectType,
          objectId: e.objectId,
          result: 'denied',
          reason: e.message,
        }),
      );
    }
    throw e;
  }
}

/** The tenant a transaction is scoped to (app.tenant_id). */
export async function tenantOf(tx: Tx): Promise<string> {
  return (await tx.execute<{ id: string }>(sql`select current_setting('app.tenant_id') as id`)).rows[0]!.id;
}
