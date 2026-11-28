import { randomUUID } from 'node:crypto';
import { createAnthropic } from '@ai-sdk/anthropic';
import { APICallError, generateText, type LanguageModel, type ModelMessage } from 'ai';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.ts';
import type { Money } from '../contracts/common.ts';
import { tenantOf, withBrand } from '../db/tenant.ts';
import { estimateCost, recordCost, remainingMonthlyCap } from '../domain/costs/index.ts';
import { BudgetError } from '../http/errors.ts';
import { estimateTokens, type AiPart } from './estimate.ts';
import { mockModel } from './mock.ts';
import { modelEntry } from './registry.ts';

export { estimateTokens, type AiPart } from './estimate.ts';
export { mockAi } from './mock.ts';

export class AiError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'AiError';
    this.retryable = retryable;
  }
}

const DEFAULT_MAX_OUTPUT = 8192;

function languageModel(): LanguageModel {
  if (config.AI_MODEL === 'mock') return mockModel;
  const m = modelEntry(config.AI_MODEL);
  if (m.provider === 'anthropic') return createAnthropic({ apiKey: config.ANTHROPIC_API_KEY })(m.modelId);
  if (m.provider === 'openrouter') return createAnthropic({ baseURL: 'https://openrouter.ai/api/v1', apiKey: config.OPENROUTER_API_KEY })(m.modelId);
  throw new Error(`No provider for ${config.AI_MODEL}`);
}

/** The JSON in a model answer, with or without a code fence. */
function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(body);
}

type Call = { text: string; refused: boolean; inputTokens: number; outputTokens: number };

async function callModel(system: string, messages: ModelMessage[], maxOutputTokens: number): Promise<Call> {
  try {
    // No `tools`: text inside a source can never trigger an action.
    const r = await generateText({ model: languageModel(), system, messages, maxOutputTokens, maxRetries: 2 });
    return {
      text: r.text,
      refused: r.finishReason === 'content-filter',
      inputTokens: r.usage.inputTokens ?? 0,
      outputTokens: r.usage.outputTokens ?? 0,
    };
  } catch (e) {
    const retryable = APICallError.isInstance(e) ? e.isRetryable : true;
    // No cause: the SDK's error holds the whole request (prompt, facts, files), and DBOS stores a step's error with its causes.
    throw new AiError(`The model call failed: ${(e as Error).message}`, retryable);
  }
}

/**
 * One structured extraction: checks the tenant's monthly cap (BudgetError), calls the model with no
 * tools, validates the answer against the schema with one repair attempt, and records a cost_events
 * row for every call, failed or not. Throws AiError { retryable } when it cannot return a valid object.
 */
export async function extract<T>(o: {
  brandId: string;
  runType: string;
  runId: string;
  system: string;
  parts: AiPart[];
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
}): Promise<{ object: T; cost: Money }> {
  const model = config.AI_MODEL;
  const maxOutputTokens = o.maxOutputTokens ?? DEFAULT_MAX_OUTPUT;
  const jsonSchema = JSON.stringify(z.toJSONSchema(o.schema, { unrepresentable: 'any' }));
  const system = `${o.system}\n\nAnswer with one JSON object and nothing else. It must match this JSON Schema:\n${jsonSchema}`;
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: o.parts.map((p) =>
        p.type === 'text' ? p : { type: 'file' as const, mediaType: p.mediaType, data: p.data, filename: p.filename },
      ),
    },
  ];
  const used = { input: 0, output: 0 };

  const attempt = async (): Promise<{ call: Call; parsed?: T; problem?: string }> => {
    const inputTokens = estimateTokens([{ type: 'text', text: system }, ...o.parts]) + used.input;
    const estimate = estimateCost(model, inputTokens, maxOutputTokens);
    const cost = { id: randomUUID(), brandId: o.brandId, runType: o.runType, runId: o.runId, model };
    // The check and a cost row reserving the estimate commit together, one tenant transaction at a
    // time, so concurrent calls cannot each spend the same remainder. The row gets the real usage below.
    await withBrand(o.brandId, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ai-cap:${await tenantOf(tx)}`}, 0))`);
      const remaining = await remainingMonthlyCap(tx);
      if (Number(estimate.npr) > Number(remaining.npr))
        throw new BudgetError(`This call may cost NPR ${estimate.npr}; NPR ${remaining.npr} of this month's AI budget is left`);
      await recordCost(tx, { ...cost, inputTokens, outputTokens: maxOutputTokens, ok: false });
    });

    let call: Call;
    try {
      call = await callModel(system, messages, maxOutputTokens);
    } catch (e) {
      await withBrand(o.brandId, (tx) => recordCost(tx, { ...cost, inputTokens: 0, outputTokens: 0, ok: false }));
      throw e;
    }
    used.input += call.inputTokens;
    used.output += call.outputTokens;
    let parsed: T | undefined;
    let problem: string | undefined;
    if (!call.refused) {
      try {
        const result = o.schema.safeParse(parseJson(call.text));
        if (result.success) parsed = result.data;
        else problem = z.prettifyError(result.error);
      } catch {
        problem = 'The answer was not valid JSON.';
      }
    }
    await withBrand(o.brandId, (tx) =>
      recordCost(tx, { ...cost, inputTokens: call.inputTokens, outputTokens: call.outputTokens, ok: parsed !== undefined }),
    );
    return { call, parsed, problem };
  };

  const done = (object: T) => ({ object, cost: estimateCost(model, used.input, used.output) });

  const first = await attempt();
  if (first.call.refused) throw new AiError('The model declined to answer', false);
  if (first.parsed !== undefined) return done(first.parsed);

  messages.push(
    { role: 'assistant', content: first.call.text },
    {
      role: 'user',
      content: `Your answer did not match the schema:\n${first.problem}\nAnswer again with only the corrected JSON object.`,
    },
  );
  const second = await attempt();
  if (second.call.refused) throw new AiError('The model declined to answer', false);
  if (second.parsed !== undefined) return done(second.parsed);
  throw new AiError(`The model's answer did not match the schema after one repair: ${second.problem}`, false);
}

