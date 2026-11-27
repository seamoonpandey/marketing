import { and, asc, eq, gt, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { ApprovedFact } from '../../../contracts/common.ts';
import type { FactOut, FactSourceOut } from '../../../contracts/knowledge.ts';
import { sources } from '../../../db/schema/core.ts';
import { facts, subjects } from '../../../db/schema/knowledge.ts';
import { isUuid, type Tx } from '../../../db/tenant.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../../http/errors.ts';
import { presignDownload } from '../../../storage/index.ts';
import { audit } from '../../audit/index.ts';
import { verifyQuote } from '../../sources/index.ts';
import { fieldDef, sectionDef, type FieldDef, type SectionKey } from '../catalogue.ts';
import { sameValue, validValue } from './values.ts';

export type Fact = FactOut;
export type FactStatus = Fact['status'];

export type ProposedFact = {
  section: SectionKey; subjectName?: string; field: string; value: unknown; unit?: string;
  language: string; origin: 'stated' | 'inferred'; sourceId?: string; quote?: string; page?: number; confidence: number;
};

export type ProposeCounts = { unverified: number; inferred: number; conflicts: number; unchanged: number; dropped: number };

type Row = typeof facts.$inferSelect;
type Key = { brandId: string; section: string; subjectId: string | null; field: string };

const QUOTE_NOT_FOUND = 'quote not found in source';
const OPERATOR = 'operator';

// ── Reading ────────────────────────────────────────────────────────────────

const selection = {
  f: facts,
  subject: { type: subjects.type, name: subjects.name },
  source: { id: sources.id, kind: sources.kind, uri: sources.uri, meta: sources.meta, objectKey: sources.objectKey },
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Facts with their subject and source, in the API shape. `expired` is computed here. */
async function selectFacts(tx: Tx, where: SQL | undefined, order: SQL = asc(facts.id), limit?: number): Promise<Fact[]> {
  const q = tx
    .select(selection)
    .from(facts)
    .leftJoin(subjects, eq(subjects.id, facts.subjectId))
    .leftJoin(sources, eq(sources.id, facts.sourceId))
    .where(where)
    .orderBy(order);
  const rows = limit ? await q.limit(limit) : await q;
  const urls = new Map<string, Promise<string>>();
  const now = Date.now();
  return Promise.all(
    rows.map(async ({ f, subject, source }): Promise<Fact> => {
      let src: FactSourceOut | null = null;
      if (source) {
        if (!urls.has(source.id)) urls.set(source.id, presignDownload(source.objectKey));
        src = { id: source.id, kind: source.kind, uri: source.uri, meta: source.meta, downloadUrl: await urls.get(source.id)! };
      }
      const expired = f.status === 'approved' && f.expiresAt !== null && f.expiresAt.getTime() < now;
      return {
        id: f.id,
        section: f.section as SectionKey,
        subjectType: subject?.type ?? 'brand',
        subjectId: f.subjectId,
        subjectName: subject?.name ?? null,
        field: f.field,
        fieldLabel: fieldDef(f.section, f.field)?.label ?? f.field,
        value: f.value as Fact['value'],
        unit: f.unit,
        language: f.language,
        status: expired ? 'expired' : f.status,
        origin: f.origin,
        confidence: f.confidence === null ? null : Number(f.confidence),
        source: src,
        quote: f.locator?.quote ?? null,
        page: f.locator?.page ?? null,
        warning: f.warning,
        version: f.version,
        supersedesId: f.supersedesId,
        isCurrent: f.isCurrent,
        verifiedBy: f.verifiedBy,
        verifiedAt: iso(f.verifiedAt),
        expiresAt: iso(f.expiresAt),
        importRunId: f.importRunId,
        createdAt: f.createdAt.toISOString(),
      };
    }),
  );
}

async function showOne(tx: Tx, id: string): Promise<Fact> {
  return (await selectFacts(tx, eq(facts.id, id)))[0]!;
}

/** Current, approved and not expired. */
const live = () => and(eq(facts.status, 'approved'), or(isNull(facts.expiresAt), gte(facts.expiresAt, sql`now()`)));

function statusWhere(status: FactStatus): SQL | undefined {
  if (status === 'approved') return live();
  if (status === 'expired') return and(eq(facts.status, 'approved'), lt(facts.expiresAt, sql`now()`));
  return eq(facts.status, status);
}

/** The brand's current facts, oldest first, a page at a time. */
export async function listFacts(
  tx: Tx, brandId: string,
  f: { section?: string; status?: FactStatus; subjectId?: string; cursor?: string; limit?: number } = {},
): Promise<{ items: Fact[]; next: string | null }> {
  if (f.cursor !== undefined && !isUuid(f.cursor)) throw new ValidationError('Not a valid cursor');
  if (f.subjectId !== undefined && !isUuid(f.subjectId)) return { items: [], next: null };
  const limit = f.limit ?? 100;
  const items = await selectFacts(
    tx,
    and(
      eq(facts.brandId, brandId),
      eq(facts.isCurrent, true),
      f.section ? eq(facts.section, f.section) : undefined,
      f.status ? statusWhere(f.status) : undefined,
      f.subjectId ? eq(facts.subjectId, f.subjectId) : undefined,
      f.cursor ? gt(facts.id, f.cursor) : undefined,
    ),
    asc(facts.id),
    limit + 1,
  );
  const more = items.length > limit;
  if (more) items.pop();
  return { items, next: more ? items.at(-1)!.id : null };
}

/** Every version of a fact, oldest first, from any one of its versions. */
export async function factHistory(tx: Tx, brandId: string, factId: string): Promise<Fact[]> {
  if (!isUuid(factId)) throw new NotFoundError('fact', factId);
  const { rows } = await tx.execute<{ id: string }>(sql`
    with recursive back(id, supersedes_id) as (
      select id, supersedes_id from facts where id = ${factId} and brand_id = ${brandId}
      union all select f.id, f.supersedes_id from facts f join back b on f.id = b.supersedes_id
    ), fwd(id) as (
      select id from facts where id = ${factId} and brand_id = ${brandId}
      union all select f.id from facts f join fwd x on f.supersedes_id = x.id
    )
    select id from back union select id from fwd`);
  if (!rows.length) throw new NotFoundError('fact', factId);
  return selectFacts(tx, inArray(facts.id, rows.map((r) => r.id)), asc(facts.version));
}

/** Current, approved, unexpired facts. The one gate other modules read brand facts through (FR-BRD-006). */
export async function approvedFacts(tx: Tx, brandId: string, filter?: { section?: string }): Promise<ApprovedFact[]> {
  const rows = await tx
    .select({ f: facts, subject: { type: subjects.type, name: subjects.name } })
    .from(facts)
    .leftJoin(subjects, eq(subjects.id, facts.subjectId))
    .where(and(eq(facts.brandId, brandId), eq(facts.isCurrent, true), live(), filter?.section ? eq(facts.section, filter.section) : undefined))
    .orderBy(asc(facts.id));
  return rows.map(({ f, subject }) => ({
    id: f.id,
    section: f.section,
    subjectType: subject?.type ?? 'brand',
    subjectId: f.subjectId,
    subjectName: subject?.name ?? null,
    field: f.field,
    value: f.value,
    unit: f.unit,
    language: f.language,
    sourceId: f.sourceId,
    verifiedAt: (f.verifiedAt ?? f.createdAt).toISOString(),
    expiresAt: iso(f.expiresAt),
  }));
}

// ── Writing ────────────────────────────────────────────────────────────────

const keyOf = (r: Key): Key => ({ brandId: r.brandId, section: r.section, subjectId: r.subjectId, field: r.field });

/** Serialises writers of one subject and field, so two never both add a value unseen by the other. */
async function lockKey(tx: Tx, k: Key): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`fact:${k.brandId}:${k.section}:${k.subjectId ?? ''}:${k.field}`}, 0))`);
}

async function currentOnKey(tx: Tx, k: Key): Promise<Row[]> {
  return tx
    .select()
    .from(facts)
    .where(and(
      eq(facts.brandId, k.brandId), eq(facts.section, k.section), eq(facts.field, k.field), eq(facts.isCurrent, true),
      k.subjectId ? eq(facts.subjectId, k.subjectId) : isNull(facts.subjectId),
    ))
    .orderBy(asc(facts.id));
}

async function insertFact(tx: Tx, values: typeof facts.$inferInsert, action: string): Promise<Row> {
  const [row] = await tx.insert(facts).values(values).returning();
  await audit(tx, {
    brandId: row!.brandId, actor: OPERATOR, action, objectType: 'fact', objectId: row!.id, objectVersion: 1, result: 'ok',
  });
  return row!;
}

/** Appends a version: clears is_current on prev (409 if another writer got there first) and inserts the change. */
async function addVersion(tx: Tx, prev: Row, change: Partial<typeof facts.$inferInsert>, action: string, reason?: string): Promise<Row> {
  const cleared = await tx
    .update(facts)
    .set({ isCurrent: false })
    .where(and(eq(facts.id, prev.id), eq(facts.isCurrent, true)))
    .returning({ id: facts.id });
  if (!cleared.length) throw new ConflictError('This fact has changed since it was loaded; reload it');
  const { id: _id, createdAt: _createdAt, ...kept } = prev;
  const [row] = await tx
    .insert(facts)
    .values({ ...kept, ...change, version: prev.version + 1, supersedesId: prev.id, isCurrent: true })
    .returning();
  await audit(tx, {
    brandId: row!.brandId, actor: OPERATOR, action, objectType: 'fact', objectId: row!.id, objectVersion: row!.version,
    result: 'ok', reason,
  });
  return row!;
}

/** The current version of a fact of this brand; 404 if there is none, 409 if this version is not current. */
async function getCurrent(tx: Tx, brandId: string, factId: string): Promise<Row> {
  const [row] = isUuid(factId)
    ? await tx.select().from(facts).where(and(eq(facts.id, factId), eq(facts.brandId, brandId)))
    : [];
  if (!row) throw new NotFoundError('fact', factId);
  if (!row.isCurrent) throw new ConflictError('This is an older version of the fact; reload it');
  return row;
}

const defOf = (r: Row): FieldDef => fieldDef(r.section, r.field)!;
const notLive = (r: Row) => r.status === 'rejected';

/** A rejected fact may come back only while no other value holds its single-valued field. */
async function assertNoRival(tx: Tx, f: Row, value: unknown, unit: string | null): Promise<void> {
  if (!notLive(f) || defOf(f).multi) return;
  await lockKey(tx, keyOf(f));
  const rivals = (await currentOnKey(tx, keyOf(f))).filter((r) => r.id !== f.id && !notLive(r));
  if (rivals.some((r) => !sameValue(defOf(f), r.value, r.unit, value, unit)))
    throw new ConflictError('Another value holds this field; edit or resolve that one instead');
}

const ownerApproval = () => ({ status: 'approved' as const, verifiedBy: OPERATOR, verifiedAt: new Date() });
const ownerValue = (value: unknown, unit: string | null, language: string, expiresAt: Date | null) => ({
  value, unit, language, expiresAt, origin: 'owner' as const, confidence: null, sourceId: null, locator: null, warning: null,
  ...ownerApproval(),
});

const toDate = (s: string | null | undefined) => (s ? new Date(s) : null);

/** Checks the section, field and subject the owner names. */
async function ownerKey(
  tx: Tx, brandId: string, i: { section: string; subjectId?: string | null; field: string; value: unknown },
): Promise<{ key: Key; def: FieldDef }> {
  const section = sectionDef(i.section);
  const def = fieldDef(i.section, i.field);
  if (!section || !def) throw new ValidationError(`${i.section}.${i.field} is not in the catalogue`);
  if (!validValue(def, i.value)) throw new ValidationError(`That is not a valid ${def.type} for ${def.label}`);
  const subjectId = i.subjectId ?? null;
  if (section.subject === 'brand') {
    if (subjectId) throw new ValidationError(`${section.label} facts are about the brand and take no subject`);
  } else {
    if (!subjectId) throw new ValidationError(`${section.label} facts need a ${section.subject}`);
    const [s] = isUuid(subjectId)
      ? await tx.select({ id: subjects.id }).from(subjects)
        .where(and(eq(subjects.id, subjectId), eq(subjects.brandId, brandId), eq(subjects.type, section.subject)))
      : [];
    if (!s) throw new NotFoundError('subject', subjectId);
  }
  return { key: { brandId, section: i.section, subjectId, field: i.field }, def };
}

/**
 * Stores what an import extracted. A stated fact whose quote is found in its source's text is
 * `unverified`; any other is `inferred`, and a stated one gets the warning `quote not found in source`.
 * Only a verified fact keeps its source and quote, and only a source in `sourceIds` (those the model
 * read) can verify one. A value equal to a current fact changes nothing; a different value on a
 * single-valued field marks it and every live rival `conflicting`.
 */
export async function proposeFacts(
  tx: Tx, brandId: string, runId: string, items: ProposedFact[], sourceIds: string[],
): Promise<ProposeCounts> {
  const counts: ProposeCounts = { unverified: 0, inferred: 0, conflicts: 0, unchanged: 0, dropped: 0 };
  const texts = new Map<string, string | null>();
  const sourceText = async (id: string) => {
    if (!isUuid(id) || !sourceIds.includes(id)) return null;
    if (!texts.has(id)) {
      const [s] = await tx.select({ text: sources.text }).from(sources).where(and(eq(sources.id, id), eq(sources.brandId, brandId)));
      texts.set(id, s?.text ?? null);
    }
    return texts.get(id)!;
  };

  for (const item of items) {
    const section = sectionDef(item.section);
    const def = fieldDef(item.section, item.field);
    const name = typeof item.subjectName === 'string' ? item.subjectName.trim().slice(0, 200) : '';
    if (!section || !def || !validValue(def, item.value) || (section.subject !== 'brand' && !name)) {
      counts.dropped++;
      continue;
    }
    const subjectId = section.subject === 'brand' ? null : (await findOrCreateSubject(tx, brandId, section.subject, name)).id;

    let status: 'unverified' | 'inferred' = 'inferred';
    let verified: { sourceId: string; locator: { quote: string; page?: number } } | null = null;
    if (item.origin === 'stated' && item.sourceId && typeof item.quote === 'string') {
      const text = await sourceText(item.sourceId);
      if (text && verifyQuote(text, item.quote)) {
        status = 'unverified';
        const page = Number.isInteger(item.page) && item.page! > 0 ? { page: item.page } : {};
        verified = { sourceId: item.sourceId, locator: { quote: item.quote, ...page } };
      }
    }

    const key: Key = { brandId, section: item.section, subjectId, field: item.field };
    const unit = typeof item.unit === 'string' && item.unit.trim() ? item.unit.trim().slice(0, 20) : null;
    await lockKey(tx, key);
    const current = await currentOnKey(tx, key);
    if (current.some((c) => sameValue(def, c.value, c.unit, item.value, unit))) {
      counts.unchanged++;
      continue;
    }
    const rivals = def.multi ? [] : current.filter((c) => !notLive(c));
    for (const r of rivals) if (r.status !== 'conflicting') await addVersion(tx, r, { status: 'conflicting' }, 'fact.conflict');
    const confidence = Number.isFinite(item.confidence) ? Math.min(1, Math.max(0, item.confidence)).toFixed(2) : null;
    await insertFact(tx, {
      ...key,
      value: item.value,
      unit,
      language: typeof item.language === 'string' && item.language.trim() ? item.language.trim().slice(0, 10) : 'und',
      status: rivals.length ? 'conflicting' : status,
      origin: item.origin === 'stated' ? 'stated' : 'inferred',
      confidence,
      sourceId: verified?.sourceId ?? null,
      locator: verified?.locator ?? null,
      warning: item.origin === 'stated' && !verified ? QUOTE_NOT_FOUND : null,
      importRunId: runId,
    }, 'fact.propose');
    if (rivals.length) counts.conflicts++;
    else counts[status]++;
  }
  return counts;
}

/**
 * The owner's own value: approved, origin owner. On a single-valued field that already holds a
 * live fact, it becomes that fact's next version; while that field is conflicting it answers 409.
 */
export async function enterFact(
  tx: Tx, brandId: string,
  i: { section: string; subjectId?: string | null; field: string; value: unknown; unit?: string | null; language: string; expiresAt?: string | null },
): Promise<Fact> {
  const { key, def } = await ownerKey(tx, brandId, i);
  const values = ownerValue(i.value, i.unit ?? null, i.language, toDate(i.expiresAt));
  await lockKey(tx, key);
  if (!def.multi) {
    const holders = (await currentOnKey(tx, key)).filter((r) => !notLive(r));
    if (holders.some((r) => r.status === 'conflicting')) throw new ConflictError('This field has conflicting values: resolve them first');
    if (holders[0]) return showOne(tx, (await addVersion(tx, holders[0], values, 'fact.edit')).id);
  }
  return showOne(tx, (await insertFact(tx, { ...key, ...values }, 'fact.create')).id);
}

export async function approveFact(tx: Tx, brandId: string, factId: string): Promise<Fact> {
  const f = await getCurrent(tx, brandId, factId);
  if (f.status === 'conflicting') throw new ConflictError('This fact conflicts with another value: resolve the conflict');
  if (f.status === 'approved') return showOne(tx, f.id);
  await assertNoRival(tx, f, f.value, f.unit);
  return showOne(tx, (await addVersion(tx, f, ownerApproval(), 'fact.approve')).id);
}

/** Approves quote-checked (unverified) facts together. Anything else refuses the whole batch. */
export async function approveBatch(tx: Tx, brandId: string, ids: string[]): Promise<Fact[]> {
  const rows = [];
  for (const id of [...new Set(ids)]) {
    const f = await getCurrent(tx, brandId, id);
    if (f.status !== 'unverified' && f.status !== 'approved')
      throw new ConflictError(`Fact ${id} is ${f.status}: only quote-checked facts can be approved together`);
    rows.push(f);
  }
  const out = [];
  for (const f of rows) out.push(f.status === 'approved' ? f : await addVersion(tx, f, ownerApproval(), 'fact.approve'));
  const shown = await selectFacts(tx, inArray(facts.id, out.map((r) => r.id)));
  return out.map((r) => shown.find((s) => s.id === r.id)!);
}

/** The owner's correction: a new approved version. A changed value drops the old source and becomes origin owner. */
export async function editFact(
  tx: Tx, brandId: string, factId: string, patch: { value: unknown; unit?: string | null; expiresAt?: string | null },
): Promise<Fact> {
  const f = await getCurrent(tx, brandId, factId);
  if (f.status === 'conflicting') throw new ConflictError('This fact conflicts with another value: resolve the conflict');
  const def = defOf(f);
  if (!validValue(def, patch.value)) throw new ValidationError(`That is not a valid ${def.type} for ${def.label}`);
  const unit = patch.unit === undefined ? f.unit : patch.unit;
  const expiresAt = patch.expiresAt === undefined ? f.expiresAt : toDate(patch.expiresAt);
  await assertNoRival(tx, f, patch.value, unit);
  const change = sameValue(def, f.value, f.unit, patch.value, unit)
    ? { value: patch.value, unit, expiresAt, ...ownerApproval() }
    : ownerValue(patch.value, unit, f.language, expiresAt);
  return showOne(tx, (await addVersion(tx, f, change, 'fact.edit')).id);
}

export async function rejectFact(tx: Tx, brandId: string, factId: string, reason?: string): Promise<Fact> {
  const f = await getCurrent(tx, brandId, factId);
  if (f.status === 'conflicting') throw new ConflictError('This fact conflicts with another value: resolve the conflict');
  if (f.status === 'rejected') return showOne(tx, f.id);
  return showOne(tx, (await addVersion(tx, f, { status: 'rejected' }, 'fact.reject', reason)).id);
}

/**
 * Ends a conflict: keeps one fact (approved) or stores the owner's typed value, and rejects every
 * other live fact on that subject and field.
 */
export async function resolveConflict(
  tx: Tx, brandId: string,
  i: { keepFactId: string } | {
    section: string; subjectId?: string | null; field: string; value: unknown; unit?: string | null; language: string;
    expiresAt?: string | null;
  },
): Promise<Fact> {
  if ('keepFactId' in i) {
    const keep = await getCurrent(tx, brandId, i.keepFactId);
    if (defOf(keep).multi) throw new ValidationError('This field holds several values and cannot conflict');
    await lockKey(tx, keyOf(keep));
    for (const r of await currentOnKey(tx, keyOf(keep)))
      if (r.id !== keep.id && !notLive(r)) await addVersion(tx, r, { status: 'rejected' }, 'fact.reject', 'conflict resolved');
    return showOne(tx, (await addVersion(tx, keep, ownerApproval(), 'fact.resolve')).id);
  }
  const { key, def } = await ownerKey(tx, brandId, i);
  if (def.multi) throw new ValidationError('This field holds several values and cannot conflict');
  await lockKey(tx, key);
  for (const r of await currentOnKey(tx, key))
    if (!notLive(r)) await addVersion(tx, r, { status: 'rejected' }, 'fact.reject', 'conflict resolved');
  const values = ownerValue(i.value, i.unit ?? null, i.language, toDate(i.expiresAt));
  return showOne(tx, (await insertFact(tx, { ...key, ...values }, 'fact.resolve')).id);
}

// ── Subjects ───────────────────────────────────────────────────────────────

export type Subject = { id: string; type: 'product' | 'segment'; name: string; createdAt: string };

const subjectOut = (s: typeof subjects.$inferSelect): Subject => ({
  id: s.id, type: s.type, name: s.name, createdAt: s.createdAt.toISOString(),
});

export async function listSubjects(tx: Tx, brandId: string, type?: 'product' | 'segment'): Promise<Subject[]> {
  const rows = await tx
    .select()
    .from(subjects)
    .where(and(eq(subjects.brandId, brandId), type ? eq(subjects.type, type) : undefined))
    .orderBy(asc(subjects.name));
  return rows.map(subjectOut);
}

/** The subject of that type whose name matches (trimmed, any case), created if there is none. */
export async function findOrCreateSubject(tx: Tx, brandId: string, type: 'product' | 'segment', name: string): Promise<Subject> {
  const trimmed = name.trim();
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`subject:${brandId}:${type}:${trimmed.toLowerCase()}`}, 0))`);
  const [found] = await tx
    .select()
    .from(subjects)
    .where(and(eq(subjects.brandId, brandId), eq(subjects.type, type), sql`lower(${subjects.name}) = lower(${trimmed})`))
    .limit(1);
  if (found) return subjectOut(found);
  const [row] = await tx.insert(subjects).values({ brandId, type, name: trimmed }).returning();
  await audit(tx, { brandId, actor: OPERATOR, action: 'subject.create', objectType: 'subject', objectId: row!.id, result: 'ok' });
  return subjectOut(row!);
}
