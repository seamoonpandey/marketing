import { describe, expect, it } from 'vitest';
import { checkCells, checkOwnRow } from './cells.ts';

const ctx = { sources: new Map([['s1', 'Fresh momo daily from our Lalitpur kitchen']]), factIds: new Set(['f1']) };
const inferred = (o: Record<string, unknown> = {}) => ({ value: 'direct', basis: 'inferred' as const, reason: 'Sells momo too', evidence: ['s1'], confidence: 'high' as const, ...o });
const quoted = (o: Record<string, unknown> = {}) => ({ value: 'Fresh daily', basis: 'quoted' as const, quote: 'Fresh momo daily', sourceId: 's1', ...o });

describe('checkCells', () => {
  it('keeps a quoted cell whose quote is in its source', () => {
    expect(checkCells({ pitch: quoted() }, ctx)).toEqual({ cells: { pitch: { value: 'Fresh daily', basis: 'quoted', quote: 'Fresh momo daily', sourceId: 's1' } }, dropped: 0 });
  });

  it('drops a quoted cell whose quote is not in its source', () => {
    expect(checkCells({ pitch: quoted({ quote: 'Cheapest momo in town' }) }, ctx)).toEqual({ cells: {}, dropped: 1 });
  });

  it('drops a quoted cell naming a source outside the row', () => {
    expect(checkCells({ pitch: quoted({ sourceId: 's9' }) }, ctx).dropped).toBe(1);
  });

  it('drops an inferred cell with no reason or no evidence', () => {
    expect(checkCells({ sells: inferred({ value: 'Momo', reason: '  ' }) }, ctx).dropped).toBe(1);
    expect(checkCells({ sells: inferred({ value: 'Momo', evidence: [] }) }, ctx).dropped).toBe(1);
  });

  it('drops an inferred cell citing an id that is neither a row source nor an approved fact', () => {
    expect(checkCells({ sells: inferred({ value: 'Momo', evidence: ['s1', 'x9'] }) }, ctx).dropped).toBe(1);
    expect(checkCells({ sells: inferred({ value: 'Momo', evidence: ['s1', 'f1'] }) }, ctx).dropped).toBe(0);
  });

  it('drops kind or overlap when quoted', () => {
    expect(checkCells({ kind: quoted({ value: 'direct' }), overlap: quoted({ value: 'high' }) }, ctx)).toEqual({ cells: {}, dropped: 2 });
  });

  it('drops a kind, price level or overlap outside its values', () => {
    const r = checkCells({ kind: inferred({ value: 'competitor' }), priceLevel: inferred({ value: ' Mid ' }) }, ctx);
    expect(r.dropped).toBe(1);
    expect(r.cells.priceLevel!.value).toBe('mid');
  });

  it('drops an overlap that cites no approved fact', () => {
    expect(checkCells({ overlap: inferred({ value: 'high', evidence: ['s1'] }) }, ctx).dropped).toBe(1);
    expect(checkCells({ overlap: inferred({ value: 'High', evidence: ['s1', 'f1'] }) }, ctx).cells.overlap!.value).toBe('high');
  });

  it('cleans what it stores and cuts a value at 200 and a reason or quote at 300 characters', () => {
    const long = `Fresh momo daily ${'x'.repeat(400)}`;
    const c = checkCells(
      { sells: inferred({ value: `Mo\u0000mo‮ ${'y'.repeat(300)}`, reason: 'r'.repeat(400) }), pitch: quoted({ quote: long }) },
      { ...ctx, sources: new Map([['s1', long]]) },
    ).cells;
    expect(c.sells!.value.startsWith('Momo ')).toBe(true);
    expect(c.sells!.value).toHaveLength(200);
    expect(c.sells!.basis === 'inferred' && c.sells!.reason).toHaveLength(300);
    expect(c.pitch!.basis === 'quoted' && c.pitch!.quote).toHaveLength(300);
  });
});

describe('checkOwnRow', () => {
  it('keeps only own-row cells that cite an approved fact', () => {
    expect(checkOwnRow({ sells: { value: 'Momo', factIds: ['f1'] }, pitch: { value: 'Best', factIds: ['nope'] } }, new Set(['f1']))).toEqual({
      sells: { value: 'Momo', factIds: ['f1'] },
    });
  });

  it('cleans and cuts a value at 200 characters', () => {
    expect(checkOwnRow({ sells: { value: `\u0007${'m'.repeat(300)}`, factIds: ['f1'] } }, new Set(['f1'])).sells!.value).toBe('m'.repeat(200));
  });
});
