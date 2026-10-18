import assert from 'node:assert/strict';
import test from 'node:test';

import { formatApiError, parseFromBodyWithProviders } from '../server/parseApi.js';
import { ParseApiError } from '../server/babelParser.js';

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

test('passes the exact input to the provider and retains it in the returned bundle', async () => {
  const sentence = '  User: [INST] `Mia`\n\tlaughed.  ';
  let observedSentence;
  const result = await parseFromBodyWithProviders({
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
  assert.equal(result.sentence, sentence);
});

test('a failure returns the word list Babel derived, only once the model\'s spelling passed', async () => {
  const sentence = '花子は太郎に窓を開けさせた。';
  const words = ['花子', 'は', '太郎', 'に', '窓', 'を', '開けさせた'];
  const fail = details => async () => { throw new ParseApiError('BAD_MODEL_RESPONSE', 'Invalid analysis.', 422, details); };
  const spelled = await parseFromBodyWithProviders({ sentence, framework: 'xbar', modelRoute: 'gemini' },
    { gemini: fail({ rawOutputArtifact: { text: '{}' }, inputTokens: words }) }).catch(error => error);
  assert.deepEqual(formatApiError(spelled).body.error.inputTokens, words);
  // An output that failed the spelling check has no word list; the browser never segments the sentence.
  const unspelled = await parseFromBodyWithProviders({ sentence, framework: 'xbar', modelRoute: 'gemini' },
    { gemini: fail({ rawOutputArtifact: { text: '{}' } }) }).catch(error => error);
  assert.equal('inputTokens' in formatApiError(unspelled).body.error, false);
  const notReached = await parseFromBodyWithProviders({ sentence, framework: 'xbar', modelRoute: 'gemini' },
    { gemini: fail(undefined) }).catch(error => error);
  assert.equal('inputTokens' in formatApiError(notReached).body.error, false);
});
