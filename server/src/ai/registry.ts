/** A model the gateway may call, with its list price in USD per million tokens (decimal strings). */
type ModelEntry = { provider: string; modelId: string; inUsdPerM: string; outUsdPerM: string };

const models: Record<string, ModelEntry> = {
  'anthropic:claude-opus-5-5': { provider: 'anthropic', modelId: 'claude-opus-5-5', inUsdPerM: '4', outUsdPerM: '20' },
  // Through OpenRouter's Anthropic-compatible endpoint, with OPENROUTER_API_KEY. The free model is for local testing.
  'openrouter:nvidia/nemotron-3.5-super-vl:free': { provider: 'openrouter', modelId: 'nvidia/nemotron-3.5-super-vl:free', inUsdPerM: '0', outUsdPerM: '0' },
  'openrouter:anthropic/claude-opus-5.5': { provider: 'openrouter', modelId: 'anthropic/claude-opus-5.5', inUsdPerM: '4', outUsdPerM: '20' },
  // AI_MODEL=mock: answers from ai/mock.ts, priced like the default model so budget checks behave the same.
  mock: { provider: 'mock', modelId: 'mock', inUsdPerM: '4', outUsdPerM: '20' },
  // One input "token" is one query: USD 1 per 1,000 queries. Set each endpoint from the account's actual rate (a Maps query may cost more credits).
  'serper:web': { provider: 'serper', modelId: 'web', inUsdPerM: '1000', outUsdPerM: '0' },
  'serper:places': { provider: 'serper', modelId: 'places', inUsdPerM: '1000', outUsdPerM: '0' },
  'mock:web': { provider: 'mock', modelId: 'web', inUsdPerM: '1000', outUsdPerM: '0' },
  'mock:places': { provider: 'mock', modelId: 'places', inUsdPerM: '1000', outUsdPerM: '0' },
};

export function modelEntry(model: string): ModelEntry {
  const entry = models[model];
  if (!entry) throw new Error(`Unknown model "${model}": add it to src/ai/registry.ts`);
  return entry;
}
