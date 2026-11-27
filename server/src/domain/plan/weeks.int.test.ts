import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { F1, F2, facts, fact } from '../../../test/fixtures/plan/facts.ts';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { withBrand, type Tx } from '../../db/tenant.ts';
import { addItem, approveWeek, editItem, getWeek, removeItem } from './weeks.ts';
import { setSettings } from './settings.ts';

let t: TestDb;
beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());

const SUN = '2026-11-29'; // a Sunday
const full = (o: Record<string, unknown> = {}) => ({
  day: SUN, channel: 'facebook' as const, format: 'image' as const, pillar: 'product' as const, funnel: 'unaware' as const, intent: 'teach' as const,
  idea: 'Shawl story', cta: 'Visit', factIds: [F1], ...o,
});
const brandWith = async (channels: { channel: string; postsPerWeek: number }[] = [{ channel: 'facebook', postsPerWeek: 1 }]) => {
  const b = await t.makeBrand();
  await withBrand(b, (tx) => setSettings(tx, b, { channels: channels as never, pillars: [], weekStarts: 0 }));
  return b;
};
const week = (b: string, f = facts, ws = SUN) => withBrand(b, (tx) => getWeek(tx, b, ws, f));
const approved = async (b: string) => {
  await withBrand(b, (tx) => addItem(tx, b, SUN, full()));
  return withBrand(b, (tx) => approveWeek(tx, b, SUN, facts));
};

describe('week plans', () => {
  it('refuses a week start that is not the first day of the week, and accepts the Sunday (review focus 1)', async () => {
    const b = await brandWith();
    await expect(week(b, facts, '2026-11-30')).rejects.toMatchObject({ status: 400 });
    await expect(withBrand(b, (tx) => addItem(tx, b, '2026-11-30', full()))).rejects.toMatchObject({ status: 400 });
    await expect(week(b, facts, 'garbage')).rejects.toMatchObject({ status: 400 });
    expect((await week(b)).plan).toBeNull();
  });

  it('creates a draft on the first item, refuses a day outside the week, and approves a clean week', async () => {
    const b = await brandWith();
    await expect(withBrand(b, (tx) => addItem(tx, b, SUN, full({ day: '2026-12-06' })))).rejects.toMatchObject({ status: 400 });
    await withBrand(b, (tx) => addItem(tx, b, SUN, full()));
    const w = await week(b);
    expect(w.plan).toMatchObject({ status: 'draft', version: 1 });
    expect(w.violations).toEqual([]);
    expect((await withBrand(b, (tx) => approveWeek(tx, b, SUN, facts))).status).toBe('approved');
  });

  it('refuses approval of an empty plan and of a plan with a blocking violation', async () => {
    const b = await brandWith();
    await expect(withBrand(b, (tx) => approveWeek(tx, b, SUN, facts))).rejects.toMatchObject({ status: 409 });
    await withBrand(b, (tx) => addItem(tx, b, SUN, full({ cta: '' })));
    await expect(withBrand(b, (tx) => approveWeek(tx, b, SUN, facts))).rejects.toThrow(/Missing/);
  });

  it('AT-013: editing the cta of an item in an approved week sets the week to draft and audits it', async () => {
    const b = await brandWith();
    await approved(b);
    const [item] = (await week(b)).items;
    await withBrand(b, (tx) => editItem(tx, b, item!.id, { cta: 'Order now' }));
    const w = await week(b);
    expect(w.plan).toMatchObject({ status: 'draft', approvedAt: null });
    expect(w.items[0]!.cta).toBe('Order now');
    expect(await t.adminQuery(`select 1 from audit_events where action = 'approval_invalidated' and brand_id = $1`, [b])).toHaveLength(1);
  });

  it('adding or removing an item of an approved week also sets it back to draft', async () => {
    const b = await brandWith([{ channel: 'facebook', postsPerWeek: 2 }]);
    await approved(b);
    const added = await withBrand(b, (tx) => addItem(tx, b, SUN, full({ day: '2026-11-30', idea: 'Second' })));
    expect((await week(b)).plan!.status).toBe('draft');
    await withBrand(b, (tx) => approveWeek(tx, b, SUN, facts));
    await withBrand(b, (tx) => removeItem(tx, b, added.id));
    expect((await week(b)).plan!.status).toBe('draft');
  });

  it('cannot approve a week citing a fact missing from today\'s facts, and can once that fact is removed from the item', async () => {
    const b = await brandWith();
    await withBrand(b, (tx) => addItem(tx, b, SUN, full({ factIds: [F1, F2] })));
    const only1 = [fact(F1)];
    expect((await week(b, only1)).violations.map((v) => v.rule)).toContain('unknown_fact');
    await expect(withBrand(b, (tx) => approveWeek(tx, b, SUN, only1))).rejects.toThrow(/not approved today/);
    const [item] = (await week(b, only1)).items;
    await withBrand(b, (tx) => editItem(tx, b, item!.id, { factIds: [F1] }));
    expect((await withBrand(b, (tx) => approveWeek(tx, b, SUN, only1))).status).toBe('approved');
  });

  it('uses the approved plans of the four weeks before for repeat_idea', async () => {
    const b = await brandWith();
    const prev = '2026-11-15';
    await withBrand(b, (tx) => addItem(tx, b, prev, full({ day: prev, idea: 'Shawl story' })));
    await withBrand(b, (tx) => approveWeek(tx, b, prev, facts));
    await withBrand(b, (tx) => addItem(tx, b, SUN, full({ idea: 'shawl STORY' })));
    expect((await week(b)).violations.map((v) => v.rule)).toEqual(['repeat_idea']);
  });

  // Two requests at once: one holds its transaction open at `gate` while the other runs.
  const held = <T>(b: string, fn: (tx: Tx) => Promise<T>) => {
    let reached!: () => void;
    let release!: () => void;
    const at = new Promise<void>((r) => (reached = r));
    const gate = new Promise<void>((r) => (release = r));
    const done = withBrand(b, async (tx) => {
      const out = await fn(tx);
      reached();
      await gate;
      return out;
    });
    return { at, release, done };
  };
  const settle = () => new Promise((r) => setTimeout(r, 300));

  it('an item edit made while an approval commits ends that approval', async () => {
    const b = await brandWith();
    const item = await withBrand(b, (tx) => addItem(tx, b, SUN, full()));
    const approving = held(b, (tx) => approveWeek(tx, b, SUN, facts));
    await approving.at;
    const editing = withBrand(b, (tx) => editItem(tx, b, item.id, { cta: '' }));
    await settle();
    approving.release();
    await approving.done;
    await editing;
    const w = await week(b);
    expect(w.items[0]!.cta).toBe('');
    expect(w.plan!.status).toBe('draft');
  });

  it('an approval made while an item edit commits checks the edited item', async () => {
    const b = await brandWith();
    const item = await withBrand(b, (tx) => addItem(tx, b, SUN, full()));
    const editing = held(b, (tx) => editItem(tx, b, item.id, { cta: '' }));
    await editing.at;
    const approving = withBrand(b, (tx) => approveWeek(tx, b, SUN, facts)).catch((e: unknown) => e);
    await settle();
    editing.release();
    await editing.done;
    expect(await approving).toMatchObject({ status: 409 });
    expect((await week(b)).plan!.status).toBe('draft');
  });

  it('does not show or edit another brand\'s items', async () => {
    const a = await brandWith();
    const b = await brandWith();
    const item = await withBrand(b, (tx) => addItem(tx, b, SUN, full()));
    await expect(withBrand(a, (tx) => editItem(tx, a, item.id, { cta: 'x' }))).rejects.toMatchObject({ status: 404 });
    expect((await week(a)).items).toEqual([]);
  });
});
