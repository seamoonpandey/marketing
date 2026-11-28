import type { LanguageModel } from 'ai';
import type { AiPart } from './estimate.ts';

const REFUSAL = Symbol('refusal');
const answers: unknown[] = [];

type PromptPart = { type: string; text?: string; mediaType?: string; data?: unknown; filename?: string };
type CallOptions = { prompt: { role: string; content: string | PromptPart[] }[]; tools?: unknown[]; maxOutputTokens?: number };

/**
 * The model behind AI_MODEL=mock. Each call answers with the next queued object (sent as JSON; a
 * string is sent as is), or refuses when mockAi.refusal is queued. Tests only.
 */
export const mockAi = {
  /** Queue the answers of the next calls, in order. */
  queue(...objects: unknown[]): void {
    answers.push(...objects);
  },
  /** Every call the model received: its system prompt, the user parts, its output cap, and any tools. */
  calls: [] as { system: string; parts: AiPart[]; maxOutputTokens?: number; tools?: unknown[] }[],
  /** Queue this to make the model refuse (finish reason content-filter). */
  refusal: REFUSAL as unknown,
  reset(): void {
    answers.length = 0;
    mockAi.calls.length = 0;
  },
};

export const mockModel = {
  specificationVersion: 'v4',
  provider: 'mock',
  modelId: 'mock',
  supportedUrls: {},
  async doGenerate(options: CallOptions) {
    const system = options.prompt.filter((m) => m.role === 'system').map((m) => m.content as string).join('\n');
    const parts = options.prompt
      .filter((m) => m.role === 'user')
      .flatMap((m) => m.content as PromptPart[])
      .map((p): AiPart =>
        p.type === 'text'
          ? { type: 'text', text: p.text! }
          : { type: 'file', mediaType: p.mediaType!, data: p.data as Uint8Array, ...(p.filename ? { filename: p.filename } : {}) },
      );
    mockAi.calls.push({ system, parts, maxOutputTokens: options.maxOutputTokens, ...(options.tools ? { tools: options.tools } : {}) });
    if (!answers.length) throw new Error('mockAi: no answer queued for this call');
    const answer = answers.shift();
    const text = answer === REFUSAL ? '' : typeof answer === 'string' ? answer : JSON.stringify(answer);
    const promptChars = JSON.stringify(options.prompt).length;
    return {
      content: text ? [{ type: 'text', text }] : [],
      finishReason: answer === REFUSAL ? { unified: 'content-filter', raw: 'refusal' } : { unified: 'stop', raw: 'end_turn' },
      usage: {
        inputTokens: { total: Math.ceil(promptChars / 4), noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: Math.ceil(text.length / 4), text: undefined, reasoning: undefined },
      },
      warnings: [],
    };
  },
  async doStream(): Promise<never> {
    throw new Error('mockAi does not stream');
  },
} as unknown as LanguageModel;
