import { and, asc, desc, eq } from 'drizzle-orm';
import type { ApprovedFact } from '../../contracts/common.ts';
import {
  studioDrafts, studioRuns, studioVersions, type DraftContent, type DraftKind, type LeftOut, type RenderRecord,
} from '../../db/schema/studio.ts';
import type { Tx } from '../../db/tenant.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../http/errors.ts';
import { audit } from '../audit/index.ts';
import { getItem, getPlan } from '../plan/index.ts';
import { checkDraft, prohibitedOf, type Finding } from './checks.ts';
import { composeCopy, kindFor } from './compose.ts';
import { loadEnv, normLang, type Env } from './env.ts';

export type Draft = typeof studioDrafts.$inferSelect;
export type StudioRunRow = typeof studioRuns.$inferSelect;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DraftView = {
  id: string; planItemId: string; kind: DraftKind; status: 'draft' | 'ready'; currentVersion: number; readyVersion: number | null; readyAt: Date | null; createdAt: Date;
  channel: string;
  /** The plan item's date, YYYY-MM-DD (the draft's creation date if the item was deleted). */
  day: string; pillar: string | null; campaignId: string | null;
  content: DraftContent; leftOut: LeftOut[]; findings: Finding[];
  /** Every render of the current version; sha256 is the hex SHA-256 of the stored file, taken when it was stored. */
  renders: RenderRecord[];
  /** Every fact id the current version cites, approved today or not. */
  factIds: string[];
  /** Every brand asset the current version uses. */
  assetIds: string[];
  version: { version: number; origin: 'model' | 'owner'; createdAt: Date };
  versions: { version: number; origin: 'model' | 'owner'; createdAt: Date }[];
  planItem: { id: string; day: string; channel: string; format: string | null; idea: string; cta: string; kind: DraftKind } | null;
  planApproved: boolean; languages: string[]; missingLanguages: string[];
  /** The cited facts that are approved today. */
  facts: ApprovedFact[]; blockingCount: number; canMarkReady: boolean; cannotMarkReadyReason: string | null;
};

export async function getDraftRow(tx: Tx, brandId: string, draftId: string, lock = false): Promise<Draft> {
  const q = tx.select().from(studioDrafts).where(and(eq(studioDrafts.id, draftId), eq(studioDrafts.brandId, brandId)));
  const [row] = UUID.test(draftId) ? await (lock ? q.for('update') : q) : [];
  if (!row) throw new NotFoundError('studio_draft', draftId);
  return row;
}

const versionRow = async (tx: Tx, draftId: string, version: number) => {
  const [v] = await tx.select().from(studioVersions).where(and(eq(studioVersions.draftId, draftId), eq(studioVersions.version, version)));
  return v!;
};

const citedIds = (c: DraftContent) => [...new Set(c.copies.flatMap((x) => x.sentences.flatMap((s) => s.factIds)))];
const assetIdsOf = (c: DraftContent) => [...new Set(c.slides.flatMap((s) => (s.photoAssetId ? [s.photoAssetId] : [])))];

export async function buildView(tx: Tx, brandId: string, d: Draft, facts: ApprovedFact[], env: Env): Promise<DraftView> {
  const v = await versionRow(tx, d.id, d.currentVersion);
  const all = await tx.select({ version: studioVersions.version, origin: studioVersions.origin, createdAt: studioVersions.createdAt }).from(studioVersions)
    .where(eq(studioVersions.draftId, d.id)).orderBy(desc(studioVersions.version));
  let item: Awaited<ReturnType<typeof getItem>> | null = null;
  try {
    item = await getItem(tx, brandId, d.planItemId);
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e; // the item was deleted: the draft stays readable
  }
  const planApproved = item ? (await getPlan(tx, brandId, item.weekPlanId)).status === 'approved' : false;
  const channel = item?.channel ?? v.content.channel;
  const findings = checkDraft({
    kind: d.kind, channel, content: v.content, renders: v.renders, version: v.version, facts, prohibited: prohibitedOf(facts),
    assetsWithRights: new Set(env.usable.keys()), kit: env.kit,
  });
  const blocking = findings.filter((f) => f.blocking);
  const cited = new Set(citedIds(v.content));
  return {
    id: d.id, planItemId: d.planItemId, kind: d.kind, status: d.status, currentVersion: d.currentVersion, readyVersion: d.readyVersion, readyAt: d.readyAt, createdAt: d.createdAt,
    channel, day: item?.day ?? d.createdAt.toISOString().slice(0, 10), pillar: item?.pillar ?? null, campaignId: item?.campaignId ?? null,
    content: v.content, leftOut: v.leftOut, findings, renders: v.renders, factIds: [...cited], assetIds: assetIdsOf(v.content),
    version: { version: v.version, origin: v.origin, createdAt: v.createdAt }, versions: all,
    planItem: item && { id: item.id, day: item.day, channel: item.channel, format: item.format, idea: item.idea, cta: item.cta, kind: kindFor(item.format) },
    planApproved, languages: env.languages, missingLanguages: env.languages.filter((l) => !v.content.copies.some((c) => c.language === l)),
    facts: facts.filter((f) => cited.has(f.id)), blockingCount: blocking.length,
    canMarkReady: d.status === 'draft' && !blocking.length,
    cannotMarkReadyReason: d.status === 'ready' ? 'Already marked ready' : blocking.length ? `${blocking.length} blocking ${blocking.length === 1 ? 'issue' : 'issues'}: ${blocking[0]!.message}` : null,
  };
}

export async function getDraft(tx: Tx, brandId: string, draftId: string, facts: ApprovedFact[]): Promise<DraftView> {
  return buildView(tx, brandId, await getDraftRow(tx, brandId, draftId), facts, await loadEnv(tx, brandId));
}

/** The brand's drafts, newest first, each as getDraft shows it. */
export async function listDrafts(tx: Tx, brandId: string, facts: ApprovedFact[], filter?: { status?: 'draft' | 'ready' }): Promise<DraftView[]> {
  const rows = await tx.select().from(studioDrafts)
    .where(and(eq(studioDrafts.brandId, brandId), filter?.status ? eq(studioDrafts.status, filter.status) : undefined))
    .orderBy(desc(studioDrafts.createdAt), asc(studioDrafts.id));
  const env = await loadEnv(tx, brandId);
  const out: DraftView[] = [];
  for (const d of rows) out.push(await buildView(tx, brandId, d, facts, env));
  return out;
}

/** A ready draft goes back to draft the moment its version or its files change. */
export async function invalidateReady(tx: Tx, brandId: string, d: Draft, reason: string): Promise<void> {
  if (d.status !== 'ready') return;
  await tx.update(studioDrafts).set({ status: 'draft', readyVersion: null, readyAt: null }).where(eq(studioDrafts.id, d.id));
  await audit(tx, { brandId, actor: 'operator', action: 'approval_invalidated', objectType: 'studio_draft', objectId: d.id, objectVersion: d.readyVersion ?? d.currentVersion, result: 'ok', reason });
}

export type Edit = Partial<Pick<DraftContent, 'copies' | 'slides' | 'scenes' | 'template' | 'ratios'>> & { baseVersion?: number };

/** An owner edit: a new version with no renders. Copy goes through composeCopy, so an unknown fact id is stripped and an unbacked claim is left out. */
export async function editDraft(tx: Tx, brandId: string, draftId: string, edit: Edit, facts: ApprovedFact[]): Promise<Draft> {
  const d = await getDraftRow(tx, brandId, draftId, true);
  if (edit.baseVersion !== undefined && edit.baseVersion !== d.currentVersion) throw new ConflictError(`This draft is at version ${d.currentVersion}; reload before editing`);
  const env = await loadEnv(tx, brandId);
  const cur = await versionRow(tx, d.id, d.currentVersion);
  const next: DraftContent = structuredClone(cur.content);
  let leftOut = cur.leftOut;

  if (edit.copies) {
    const langs = edit.copies.map((c) => normLang(c.language));
    for (const l of langs) if (!env.languages.includes(l)) throw new ValidationError(`${l} is not one of the brand languages (${env.languages.join(', ')})`);
    if (new Set(langs).size !== langs.length) throw new ValidationError('A language is listed twice');
    leftOut = leftOut.filter((x) => !langs.includes(x.language));
    edit.copies.forEach((c, n) => {
      const language = langs[n]!;
      const r = composeCopy({ facts, sentences: c.sentences });
      leftOut.push(...r.leftOut.map((x) => ({ ...x, language })));
      const copy = { language, sentences: r.sentences, hashtags: [...new Set(c.hashtags.map((h) => h.replace(/^#+/, '').replace(/\s+/g, '')).filter(Boolean))], cta: c.cta };
      const at = next.copies.findIndex((x) => x.language === language);
      if (at >= 0) next.copies[at] = copy;
      else next.copies.push(copy);
    });
  }
  if (edit.slides) {
    if (d.kind !== 'static' && d.kind !== 'carousel') throw new ValidationError(`A ${d.kind} draft has no slides`);
    if (d.kind === 'static' && edit.slides.length > 1) throw new ValidationError('A static draft has one slide');
    if (d.kind === 'carousel' && edit.slides.length < 2) throw new ValidationError('A carousel has 2 to 10 slides');
    for (const s of edit.slides) if (s.photoAssetId && !env.assetIds.has(s.photoAssetId)) throw new NotFoundError('asset', s.photoAssetId);
    next.slides = edit.slides;
  }
  if (edit.scenes) {
    if (d.kind !== 'video') throw new ValidationError(`A ${d.kind} draft has no scenes`);
    if (!edit.scenes.length) throw new ValidationError('A video needs at least one scene');
    next.scenes = edit.scenes;
  }
  if (edit.template) next.template = edit.template;
  if (edit.ratios) next.ratios = [...new Set(edit.ratios)];

  if (JSON.stringify({ c: next, l: leftOut }) === JSON.stringify({ c: cur.content, l: cur.leftOut })) return d;
  const version = d.currentVersion + 1;
  await tx.insert(studioVersions).values({ brandId, draftId: d.id, version, origin: 'owner', content: next, leftOut, renders: [] });
  await tx.update(studioDrafts).set({ currentVersion: version }).where(eq(studioDrafts.id, d.id));
  await invalidateReady(tx, brandId, d, 'draft edited');
  await audit(tx, { brandId, actor: 'operator', action: 'studio.draft.edit', objectType: 'studio_draft', objectId: d.id, objectVersion: version, result: 'ok' });
  return getDraftRow(tx, brandId, d.id);
}

/** Refused with a ConflictError while any blocking finding exists, judged against today's facts and rights. */
export async function markReady(tx: Tx, brandId: string, draftId: string, facts: ApprovedFact[]): Promise<Draft> {
  const d = await getDraftRow(tx, brandId, draftId, true);
  if (d.status === 'ready') return d;
  const v = await buildView(tx, brandId, d, facts, await loadEnv(tx, brandId));
  if (v.blockingCount) throw new ConflictError(v.cannotMarkReadyReason!);
  await tx.update(studioDrafts).set({ status: 'ready', readyVersion: d.currentVersion, readyAt: new Date() }).where(eq(studioDrafts.id, d.id));
  await audit(tx, { brandId, actor: 'operator', action: 'studio.draft.ready', objectType: 'studio_draft', objectId: d.id, objectVersion: d.currentVersion, result: 'ok' });
  return getDraftRow(tx, brandId, d.id);
}

