/** A model the gateway may call, with its list price in USD per million tokens (decimal strings). */
export type ModelEntry = { provider: string; modelId: string; inUsdPerM: string; outUsdPerM: string };

export const models: Record<string, ModelEntry> = {
  'anthropic:claude-opus-5-5': { provider: 'anthropic', modelId: 'claude-opus-5-5', inUsdPerM: '4', outUsdPerM: '20' },
  // AI_MODEL=mock: answers from ai/mock.ts, priced like the default model so budget checks behave the same.
  mock: { provider: 'mock', modelId: 'mock', inUsdPerM: '4', outUsdPerM: '20' },
};

export function modelEntry(model: string): ModelEntry {
  const entry = models[model];
  if (!entry) throw new Error(`Unknown model "${model}": add it to src/ai/registry.ts`);
  return entry;
}
