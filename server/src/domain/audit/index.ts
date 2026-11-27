import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { auditEvents } from '../../db/schema/core.ts';
import type { Tx } from '../../db/tenant.ts';

export type AuditInput = {
  brandId?: string;
  actor: string;
  action: string;
  objectType: string;
  objectId: string;
  objectVersion?: number;
  result: 'ok' | 'denied' | 'failed';
  reason?: string;
};

type AuditRow = {
  id: string;
  tenantId: string;
  brandId: string | null;
  actor: string;
  action: string;
  objectType: string;
  objectId: string;
  objectVersion: number | null;
  result: string;
  reason: string | null;
  traceId: string | null;
  prevHash: string | null;
  createdAt: Date;
};

/** The SHA-256 of a row's fields and the previous row's hash. */
export function auditHash(r: AuditRow): string {
  const fields = [
    r.id, r.tenantId, r.brandId, r.actor, r.action, r.objectType, r.objectId, r.objectVersion,
    r.result, r.reason, r.traceId, r.createdAt.toISOString(), r.prevHash,
  ];
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

/** True when every row's hash matches its fields and links to the row before it. Rows of one chain, in seq order. */
export function verifyAuditChain(rows: (AuditRow & { hash: string })[]): boolean {
  return rows.every((r, i) => r.prevHash === (i === 0 ? null : rows[i - 1]!.hash) && r.hash === auditHash(r));
}

/**
 * Appends an audit event to its chain: the brand's when brandId is set (the transaction must be
 * scoped to that brand), else the tenant's. actor is 'operator' until login exists.
 */
export async function audit(tx: Tx, e: AuditInput): Promise<void> {
  const brandId = e.brandId ?? null;
  const [ctx] = (
    await tx.execute<{ id: string; tenant_id: string }>(
      sql`select uuidv7() as id, current_setting('app.tenant_id') as tenant_id`,
    )
  ).rows;
  // One writer per chain at a time, so two events never share a previous hash.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${ctx!.tenant_id}:${brandId ?? ''}`}, 0))`);
  const [prev] = await tx
    .select({ hash: auditEvents.hash })
    .from(auditEvents)
    .where(brandId ? eq(auditEvents.brandId, brandId) : isNull(auditEvents.brandId))
    .orderBy(desc(auditEvents.seq))
    .limit(1);
  const row: AuditRow = {
    id: ctx!.id,
    tenantId: ctx!.tenant_id,
    brandId,
    actor: e.actor,
    action: e.action,
    objectType: e.objectType,
    objectId: e.objectId,
    objectVersion: e.objectVersion ?? null,
    result: e.result,
    reason: e.reason ?? null,
    traceId: null,
    prevHash: prev?.hash ?? null,
    createdAt: new Date(),
  };
  await tx.insert(auditEvents).values({ ...row, result: e.result, hash: auditHash(row) });
}


/** A brand's audit trail, newest first: its own events and the tenant-level events about it (creation, denials). */
export async function listAudit(tx: Tx, brandId: string, limit = 200) {
  return tx
    .select({
      id: auditEvents.id, actor: auditEvents.actor, action: auditEvents.action, objectType: auditEvents.objectType,
      objectId: auditEvents.objectId, objectVersion: auditEvents.objectVersion, result: auditEvents.result,
      reason: auditEvents.reason, createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(
      or(
        eq(auditEvents.brandId, brandId),
        and(isNull(auditEvents.brandId), eq(auditEvents.objectType, 'brand'), eq(auditEvents.objectId, brandId)),
      ),
    )
    .orderBy(desc(auditEvents.seq))
    .limit(limit);
}
