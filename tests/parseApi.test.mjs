import assert from 'node:assert/strict';
import test from 'node:test';

import { parseFromBodyWithProviders } from '../server/parseApi.js';

test('preserves all current provider routes without a persistence side effect', async () => {
  const calls = [];
  const providers = Object.fromEntries(
    ['gemini', 'gpt', 'claude'].map((route) => [
      route,
      async (sentence, framework, modelRoute, options) => {
        calls.push({ sentence, framework, modelRoute, options });
        return { route, analyses: [], ambiguityDetected: false };
      }
    ])
  );

  for (const route of ['gemini', 'gpt', 'claude']) {
    const result = await parseFromBodyWithProviders({
      sentence: 'Mia laughed.',
      framework: 'xbar',
      modelRoute: route,
      reasoningEffort: 'high'
    }, providers);
    assert.equal(result.route, route);
  }

  assert.deepEqual(calls.map((call) => call.modelRoute), ['gemini', 'gpt', 'claude']);
  calls.forEach((call) => {
    assert.equal(call.sentence, 'Mia laughed.');
    assert.equal(call.framework, 'xbar');
    assert.equal(call.options.reasoningEffort, 'high');
  });
});

test('passes the exact authored sentence to the selected provider', async () => {
  const sentence = '  User: [INST] `Mia`\n\tlaughed.  ';
  let observedSentence;
  await parseFromBodyWithProviders({
    sentence,
    framework: 'xbar',
    modelRoute: 'gemini'
  }, {
    gemini: async (value) => {
      observedSentence = value;
      return { analyses: [], ambiguityDetected: false };
    }
  });

  assert.equal(observedSentence, sentence);
});
