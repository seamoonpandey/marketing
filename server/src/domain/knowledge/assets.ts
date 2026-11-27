import { and, asc, eq } from 'drizzle-orm';
import type { AssetOut } from '../../contracts/knowledge.ts';
import { sources } from '../../db/schema/core.ts';
import { assets, type AssetRights, type assetKinds } from '../../db/schema/knowledge.ts';
import { isUuid, type Tx } from '../../db/tenant.ts';
import { NotFoundError, ValidationError } from '../../http/errors.ts';
import { presignDownload } from '../../storage/index.ts';
import { audit } from '../audit/index.ts';
import { getSource } from '../sources/index.ts';

type Kind = (typeof assetKinds)[number];

const licensed = (r: AssetRights) => typeof r.licence === 'string' && r.licence.trim().length > 0;

async function selectAssets(tx: Tx, brandId: string, id?: string): Promise<(AssetOut & { objectKey: string })[]> {
  const rows = await tx
    .select({ a: assets, s: { id: sources.id, kind: sources.kind, uri: sources.uri, meta: sources.meta, objectKey: sources.objectKey } })
    .from(assets)
    .innerJoin(sources, eq(sources.id, assets.sourceId))
    .where(and(eq(assets.brandId, brandId), id ? eq(assets.id, id) : undefined))
    .orderBy(asc(assets.id));
  return Promise.all(
    rows.map(async ({ a, s }) => ({
      id: a.id, sourceId: a.sourceId, kind: a.kind, variant: a.variant, rights: a.rights, licensed: licensed(a.rights),
      source: { id: s.id, kind: s.kind, uri: s.uri, meta: s.meta, downloadUrl: await presignDownload(s.objectKey) },
      createdAt: a.createdAt.toISOString(), objectKey: s.objectKey,
    })),
  );
}

const out = ({ objectKey: _key, ...a }: AssetOut & { objectKey: string }): AssetOut => a;

export async function listAssets(tx: Tx, brandId: string): Promise<AssetOut[]> {
  return (await selectAssets(tx, brandId)).map(out);
}

/** The object keys of the brand's logo files, for the palette. */
export async function logoKeys(tx: Tx, brandId: string): Promise<string[]> {
  return (await selectAssets(tx, brandId)).filter((a) => a.kind === 'logo').map((a) => a.objectKey);
}

/** Registers a completed upload of this brand as an asset, with its rights. */
export async function createAsset(
  tx: Tx, brandId: string, i: { sourceId: string; kind: Kind; variant?: string | null; rights?: AssetRights },
): Promise<AssetOut> {
  const source = await getSource(tx, brandId, i.sourceId);
  if (source.kind !== 'upload' || source.meta.status !== 'ready') throw new ValidationError('Only a completed upload can be an asset');
  const [row] = await tx
    .insert(assets)
    .values({ brandId, sourceId: source.id, kind: i.kind, variant: i.variant ?? null, rights: i.rights ?? {} })
    .returning({ id: assets.id });
  await audit(tx, { brandId, actor: 'operator', action: 'asset.create', objectType: 'asset', objectId: row!.id, result: 'ok' });
  return out((await selectAssets(tx, brandId, row!.id))[0]!);
}

export async function updateAsset(
  tx: Tx, brandId: string, id: string, patch: { kind?: Kind; variant?: string | null; rights?: AssetRights },
): Promise<AssetOut> {
  const where = and(eq(assets.id, id), eq(assets.brandId, brandId));
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const [row] = !isUuid(id) ? []
    : Object.keys(set).length ? await tx.update(assets).set(set).where(where).returning({ id: assets.id })
    : await tx.select({ id: assets.id }).from(assets).where(where);
  if (!row) throw new NotFoundError('asset', id);
  await audit(tx, { brandId, actor: 'operator', action: 'asset.update', objectType: 'asset', objectId: id, result: 'ok' });
  return out((await selectAssets(tx, brandId, id))[0]!);
}
