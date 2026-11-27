import { sql } from 'drizzle-orm';
import { modelEntry } from '../../ai/registry.ts';
import { config } from '../../config.ts';
import type { Money } from '../../contracts/common.ts';
import { costEvents } from '../../db/schema/core.ts';
import type { Tx } from '../../db/tenant.ts';

// Money math in BigInt fixed point: a decimal string becomes an integer scaled by 10^scale.
function units(decimal: string, scale: number): bigint {
  const [whole, frac = ''] = decimal.split('.');
  return BigInt(whole! + frac.padEnd(scale, '0').slice(0, scale));
}

/** Rounds a value held at `scale` to `places` decimals, half up, and formats it. */
function format(v: bigint, scale: number, places: number): string {
  const div = 10n ** BigInt(scale - places);
  const r = (v + div / 2n) / div;
  const s = r.toString().padStart(places + 1, '0');
  return places ? `${s.slice(0, -places)}.${s.slice(-places)}` : s;
}

function price(model: string, inputTokens: number, outputTokens: number) {
  const m = modelEntry(model);
  // rate is USD per 1e6 tokens, so tokens * rate * 1e6 is the cost in USD scaled by 1e12.
  const usd12 = BigInt(inputTokens) * units(m.inUsdPerM, 6) + BigInt(outputTokens) * units(m.outUsdPerM, 6);
  const npr14 = usd12 * units(config.USD_NPR, 2);
  return { m, usd12, npr14 };
}

/** The most a call can cost: its input tokens plus its output cap, at the model's list price. */
export function estimateCost(model: string, inputTokens: number, maxOutputTokens: number): Money {
  const { usd12, npr14 } = price(model, inputTokens, maxOutputTokens);
  return { usd: format(usd12, 12, 4), npr: format(npr14, 14, 2) };
}

/** What the tenant may still spend this calendar month (UTC), across all its brands. Never below zero. */
export async function remainingMonthlyCap(tx: Tx): Promise<Money> {
  const { rows } = await tx.execute<{ npr: string }>(
    sql`select greatest(0, ${config.AI_MONTHLY_CAP_NPR}::numeric - tenant_month_cost_npr())::numeric(14,2)::text as npr`,
  );
  const npr = rows[0]!.npr;
  // usd = npr / rate, both at 2 decimals; scale to 4 decimals and round half up.
  const n = units(npr, 2) * 10n ** 4n;
  const rate = units(config.USD_NPR, 2);
  const usd = (2n * n + rate) / (2n * rate);
  return { npr, usd: format(usd, 4, 4) };
}

export type CostRecord = {
  brandId: string;
  runType: string;
  runId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  ok: boolean;
};

/** Writes one cost_events row with its rate snapshot. Used by ai.extract, not by modules. */
export async function recordCost(tx: Tx, c: CostRecord): Promise<Money> {
  const { m, usd12, npr14 } = price(c.model, c.inputTokens, c.outputTokens);
  await tx.insert(costEvents).values({
    brandId: c.brandId,
    runType: c.runType,
    runId: c.runId,
    provider: m.provider,
    model: m.modelId,
    inputTokens: c.inputTokens,
    outputTokens: c.outputTokens,
    ok: c.ok,
    rateInUsd: m.inUsdPerM,
    rateOutUsd: m.outUsdPerM,
    usdNpr: config.USD_NPR,
    costUsd: format(usd12, 12, 6),
    costNpr: format(npr14, 14, 2),
  });
  return { usd: format(usd12, 12, 4), npr: format(npr14, 14, 2) };
}
