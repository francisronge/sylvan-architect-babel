import assert from 'node:assert/strict';
import test from 'node:test';

import { formatApiError, parseFromBody, parseFromBodyWithProviders, validateParseBody } from '../server/parseApi.js';
import { ParseApiError } from '../server/babelParser.js';

test('a request must name its model: no model, a legacy route or an unknown model is rejected before any provider call', async (t) => {
  const calls = [];
  const record = (name) => async (...args) => {
    calls.push({ name, args });
    return { analyses: [], ambiguityDetected: false };
  };
  // Every key a provider table has ever used, so a silent default would be observed.
  const providers = { gemini: record('gemini'), gpt: record('gpt'), claude: record('claude'), research: record('research') };
  t.mock.method(globalThis, 'fetch', async () => assert.fail('A rejected request must not reach a provider.'));
  const base = { sentence: 'Mia laughed.', framework: 'xbar' };
  const cases = [
    [{ ...base }, 'REQUEST_MODEL_ID_REQUIRED', /Name the model with modelId/],
    ...['gemini', 'gpt', 'claude'].map((modelRoute) => [
      { ...base, modelRoute, reasoningEffort: 'high' }, 'REQUEST_MODEL_ID_REQUIRED', /Name the model with modelId/]),
    [{ ...base, modelId: 'google:gemini-3.1-pro-preview' }, 'REQUEST_MODEL_ID_SUPPORTED', /not enabled for generation/],
    [{ ...base, modelId: '' }, 'REQUEST_MODEL_ID_SUPPORTED', /not enabled for generation/]
  ];
  for (const [body, ruleId, message] of cases) {
    for (const parse of [(value) => parseFromBodyWithProviders(value, providers), parseFromBody]) {
      await assert.rejects(() => parse(body), (error) => {
        assert.equal(error instanceof ParseApiError, true);
        const { status, body: response } = formatApiError(error);
        assert.equal(status, 400);
        assert.equal(response.error.code, 'INVALID_REQUEST');
        assert.match(response.error.message, message);
        assert.equal(response.error.failure.ruleId, ruleId);
        assert.equal(response.error.failure.fieldPath, '$.modelId');
        return true;
      }, JSON.stringify(body));
    }
  }
  assert.deepEqual(calls, []);
});

test('a named catalog model reaches its route with its native settings', async () => {
  const calls = [];
  const result = await parseFromBodyWithProviders({
    sentence: 'Mia laughed.',
    framework: 'xbar',
    modelId: 'anthropic:claude-opus-5',
    settings: { 'output_config.effort': 'max' }
  }, {
    research: async (sentence, framework, modelId, options) => {
      calls.push({ sentence, framework, modelId, settings: options.settings });
      return { analyses: [], ambiguityDetected: false };
    }
  });
  assert.equal(result.sentence, 'Mia laughed.');
  assert.deepEqual(calls, [{
    sentence: 'Mia laughed.',
    framework: 'xbar',
    modelId: 'anthropic:claude-opus-5',
    settings: { 'output_config.effort': 'max' }
  }]);
});

test('passes the exact input to the provider and retains it in the returned bundle', async () => {
  const sentence = '  User: [INST] `Mia`\n\tlaughed.  ';
  let observedSentence;
  const result = await parseFromBodyWithProviders({
    sentence,
    framework: 'xbar',
    modelId: 'openai:gpt-6-astra'
  }, {
    research: async (value) => {
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
  const spelled = await parseFromBodyWithProviders({ sentence, framework: 'xbar', modelId: 'openai:gpt-6-astra' },
    { research: fail({ rawOutputArtifact: { text: '{}' }, inputTokens: words }) }).catch(error => error);
  assert.deepEqual(formatApiError(spelled).body.error.inputTokens, words);
  // An output that failed the spelling check has no word list; the browser never segments the sentence.
  const unspelled = await parseFromBodyWithProviders({ sentence, framework: 'xbar', modelId: 'openai:gpt-6-astra' },
    { research: fail({ rawOutputArtifact: { text: '{}' } }) }).catch(error => error);
  assert.equal('inputTokens' in formatApiError(unspelled).body.error, false);
  const notReached = await parseFromBodyWithProviders({ sentence, framework: 'xbar', modelId: 'openai:gpt-6-astra' },
    { research: fail(undefined) }).catch(error => error);
  assert.equal('inputTokens' in formatApiError(notReached).body.error, false);
});

test('a request that names no framework is analyzed under Minimalism', () => {
  const body = { sentence: 'Mia laughed.', modelId: 'openai:gpt-6-astra' };
  assert.equal(validateParseBody(body).framework, 'minimalism');
  assert.equal(validateParseBody({ ...body, framework: 'xbar' }).framework, 'xbar');
});
