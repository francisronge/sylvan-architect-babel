// Counterfactual token cost, not subscription allowance or an account charge.
// Keep dated rates with their primary sources so saved receipts remain reproducible.
// A rate added after the snapshot date carries its own retrieval date.
export const API_PRICE_SNAPSHOT = {
  asOf: '2026-10-11', currency: 'USD', tier: 'standard', geography: 'global',
  sources: {
    openai: 'https://developers.openai.com/api/docs/pricing',
    anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
    xai: 'https://docs.x.ai/developers/pricing'
  },
  perMillion: {
    'gpt-6.1-sol': { provider: 'openai', input: 2, cached: 0.1, write: 2.5, output: 10, long: [4, 0.2, 5, 15] },
    'gpt-6-sol': { provider: 'openai', input: 2, cached: 0.2, write: 2.5, output: 10, long: [4, 0.4, 5, 15] },
    'gpt-6-astra': { provider: 'openai', input: 10, cached: 1, write: 12.5, output: 50, long: [20, 2, 25, 75] },
    'gpt-5.6-sol': { provider: 'openai', input: 4, cached: 0.4, write: 5, output: 20, long: [8, 0.8, 10, 30] },
    'claude-fable-5-1': { provider: 'anthropic', input: 10, cached: 0.25, write: 12.5, write1h: 20, output: 50 },
    'claude-opus-5-5': { provider: 'anthropic', input: 4, cached: 0.2, write: 5, write1h: 8, output: 20, asOf: '2026-10-17' },
    'claude-opus-5': { provider: 'anthropic', input: 5, cached: 0.5, write: 6.25, write1h: 10, output: 25 },
    'grok-4.6': { provider: 'xai', input: 2, cached: 0.5, write: 2, output: 6, long: [4, 1, 4, 12] }
  }
};

const count = value => Number.isSafeInteger(value) && value >= 0;
const usd = value => Math.round(value / 1e6 * 1e9) / 1e9;

export const estimateApiTokenCost = (modelId, usage) => {
  const model = String(modelId ?? '').replace(/^(?:openai|anthropic|xai):/u, '');
  const entry = API_PRICE_SNAPSHOT.perMillion[model];
  const { asOf = API_PRICE_SNAPSHOT.asOf, ...base } = entry ?? {};
  const result = { kind: 'hypothetical-api-token-cost', currency: 'USD', model,
    pricingAsOf: asOf, tier: 'standard', geography: 'global', actualChargeUsd: null };
  const unavailable = reason => ({ ...result, status: 'unavailable', reason, estimatedUsd: null });
  if (!entry) return unavailable('No verified rate for this exact model.');
  if (!count(usage?.input_tokens) || !count(usage?.output_tokens)) return unavailable('Provider input/output usage is missing.');
  let rates = base;
  const longContext = base.provider === 'xai' ? usage.input_tokens >= 200000 : usage.input_tokens > 272000;
  if (base.long && longContext) {
    const [input, cached, write, output] = base.long;
    rates = { ...base, input, cached, write, output };
  }
  let lower, upper, tokens;
  if (base.provider === 'anthropic') {
    const read = usage.cache_read_input_tokens, write = usage.cache_creation_input_tokens;
    if (!count(read) || !count(write)) return unavailable('Anthropic cache counts are required; they are additional to base input.');
    const w5 = usage.cache_creation?.ephemeral_5m_input_tokens;
    const w1 = usage.cache_creation?.ephemeral_1h_input_tokens;
    const cost = usage.input_tokens * rates.input + read * rates.cached + usage.output_tokens * rates.output;
    if (count(w5) && count(w1) && w5 + w1 === write) lower = upper = cost + w5 * rates.write + w1 * rates.write1h;
    else { lower = cost + write * rates.write; upper = cost + write * rates.write1h; }
    tokens = { baseInput: usage.input_tokens, cachedInput: read, cacheWriteInput: write,
      totalInput: usage.input_tokens + read + write, output: usage.output_tokens };
  } else {
    const read = usage.input_tokens_details?.cached_tokens;
    const write = base.provider === 'xai' ? 0 : usage.input_tokens_details?.cache_write_tokens;
    if (count(read) && count(write) && read + write > usage.input_tokens) return unavailable('Cache counts exceed total input.');
    const output = usage.output_tokens * rates.output;
    if (count(read) && count(write)) lower = upper = output
      + (usage.input_tokens - read - write) * rates.input + read * rates.cached + write * rates.write;
    else {
      const knownRead = count(read) ? read : 0, knownWrite = count(write) ? write : 0;
      if (knownRead + knownWrite > usage.input_tokens) return unavailable('Cache counts exceed total input.');
      const remaining = usage.input_tokens - knownRead - knownWrite;
      const fixed = output + knownRead * rates.cached + knownWrite * rates.write;
      lower = fixed + remaining * (count(read) ? rates.input : rates.cached);
      upper = fixed + remaining * (count(write) ? rates.input : rates.write);
    }
    tokens = { totalInput: usage.input_tokens, cachedInput: count(read) ? read : null,
      cacheWriteInput: count(write) ? write : null, output: usage.output_tokens };
  }
  return { ...result, status: lower === upper ? 'estimated' : 'range',
    estimatedUsd: lower === upper ? usd(lower) : null, minimumUsd: usd(lower), maximumUsd: usd(upper),
    tokens, ratesPerMillion: rates, source: API_PRICE_SNAPSHOT.sources[base.provider],
    assumptions: 'Published Standard global token rates on pricingAsOf; no taxes, tools, discounts or speed premiums. Reasoning is already part of output. Historical requests are repriced at this snapshot. Missing cache details produce a range.' };
};
