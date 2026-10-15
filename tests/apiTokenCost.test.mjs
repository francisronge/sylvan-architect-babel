import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateApiTokenCost } from '../contractQualification/apiCost.js';

test('OpenAI cache counts and reasoning subsets do not get billed twice', () => {
  const usage = { input_tokens: 10000, input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 2000 },
    output_tokens: 5000, output_tokens_details: { reasoning_tokens: 3000 } };
  const cost = estimateApiTokenCost('openai:gpt-6.1-sol', usage);
  assert.equal(cost.estimatedUsd, 0.0634);
  assert.equal(cost.actualChargeUsd, null);
  assert.equal(estimateApiTokenCost('gpt-6-astra', usage).estimatedUsd, 0.319);
});

test('Anthropic exclusive cache input and write TTL use their own rates', () => {
  const usage = { input_tokens: 1000, cache_read_input_tokens: 4000, cache_creation_input_tokens: 3000,
    cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 }, output_tokens: 5000 };
  const cost = estimateApiTokenCost('claude-fable-5-1', usage);
  assert.equal(cost.estimatedUsd, 0.3135);
  assert.equal(cost.tokens.totalInput, 8000);
  delete usage.cache_creation;
  const range = estimateApiTokenCost('claude-fable-5-1', usage);
  assert.equal(range.minimumUsd, 0.2985);
  assert.equal(range.maximumUsd, 0.321);
});

test('missing counters stay unknown; long-context boundaries use published model thresholds', () => {
  assert.equal(estimateApiTokenCost('gpt-6.1-sol', null).status, 'unavailable');
  assert.equal(estimateApiTokenCost('invented-model', { input_tokens: 1, output_tokens: 1 }).status, 'unavailable');
  const unknownCache = estimateApiTokenCost('gpt-6.1-sol', { input_tokens: 10000, output_tokens: 5000 });
  assert.equal(unknownCache.estimatedUsd, null);
  assert.equal(unknownCache.minimumUsd, 0.051);
  assert.equal(unknownCache.maximumUsd, 0.075);
  const usage = input_tokens => ({ input_tokens, output_tokens: 1,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } });
  assert.equal(estimateApiTokenCost('gpt-6.1-sol', usage(272000)).ratesPerMillion.input, 2);
  assert.equal(estimateApiTokenCost('gpt-6.1-sol', usage(272001)).ratesPerMillion.input, 4);
  assert.equal(estimateApiTokenCost('grok-4.6', usage(200000)).ratesPerMillion.input, 4);
  assert.equal(estimateApiTokenCost('gpt-6.1-sol', { ...usage(1), input_tokens_details: { cached_tokens: 2 } }).status, 'unavailable');
});
