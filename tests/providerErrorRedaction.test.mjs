import assert from 'node:assert/strict';
import test from 'node:test';

import { ParseApiError } from '../server/babelParser/error.js';
import { parseModelJsonDetailed } from '../server/babelParser/modelJson.js';
import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';
import { createParseRoutes } from '../server/babelParser/parseRoutes.js';
import { createRawOutputArtifact } from '../server/babelParser/validationErrors.js';
import { describeParseServerFailure, redactProviderLogText } from '../server/parseHttpPolicy.js';

// parseApi.js reads NODE_ENV once at load, so each runtime gets its own module instance.
const loadFormatter = async (nodeEnv) => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  try {
    return (await import(`../server/parseApi.js?node-env=${nodeEnv}`)).formatApiError;
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
};
const production = await loadFormatter('production');
const development = await loadFormatter('development');

const secret = 'org-SECRETORG123';
const keyTail = 'sk-proj-****************WXYZ';
const providerBody = JSON.stringify({ error: {
  message: `Upstream overloaded for organization ${secret}, key ${keyTail}.`, code: 'server_error'
} });
const decode = (artifact) => Buffer.from(artifact.data, 'base64').toString('utf8');

const withProviderKey = (t) => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only-provider-key';
  t.after(() => {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  });
};

const failWith = async (generateOpenAI) => {
  const routes = createParseRoutes({ ParseApiError, normalizeParseBundle, parseModelJsonDetailed, generateOpenAI });
  return routes.parseSentenceWithResearchModel('Mia laughed.', 'xbar', 'openai:gpt-6-sol', { settings: {} })
    .then(() => assert.fail('expected a typed failure'), (error) => error);
};

const providerError = (message, fields) => async () => {
  throw Object.assign(new Error(message), fields);
};

test('production failure bodies carry no provider error text or body', async (t) => {
  withProviderKey(t);
  const cases = [
    ['PROVIDER_QUOTA', 429, { status: 429, responseBody: providerBody }],
    ['API_KEY_INVALID', 500, { status: 401, responseBody: providerBody }],
    ['PROVIDER_UNAVAILABLE', 503, { status: 503, responseBody: providerBody }],
    ['PARSE_FAILED', 500, {}]
  ];
  for (const [code, status, fields] of cases) {
    const error = await failWith(providerError(JSON.parse(providerBody).error.message, fields));
    assert.equal(error.code, code);
    const publicBody = production(error);
    assert.equal(publicBody.status, status);
    const serialized = JSON.stringify(publicBody.body);
    assert.equal(serialized.includes(secret), false, code);
    assert.equal(serialized.includes('WXYZ'), false, code);
    assert.equal(publicBody.body.error.failure.offendingValue, null, code);
    assert.equal('details' in publicBody.body.error, false);
    assert.equal(publicBody.body.error.rawOutput?.byteLength ?? 0, 0, code);
    assert.equal(publicBody.body.error.generationRecord?.rawProviderResponse, undefined, code);

    // Development keeps the provider's own report for diagnosis.
    const local = JSON.stringify(development(error).body);
    assert.equal(local.includes(secret), true, code);

    // The server log keeps a redacted provider message.
    const logged = describeParseServerFailure(error, publicBody);
    assert.match(logged.providerMessage, /org-SECRETORG123/u);
    assert.equal(logged.providerMessage.includes('WXYZ'), false);
  }
});

test('production keeps model output and partial provider responses', async (t) => {
  withProviderKey(t);
  const output = 'This is not Babel JSON.';
  const completed = await failWith(async () => ({ text: output, rawProviderResponse: '{}', status: 'completed',
    candidates: [{ finishReason: 'COMPLETED' }], usageMetadata: {} }));
  assert.equal(completed.code, 'BAD_MODEL_RESPONSE');
  const completedBody = production(completed).body.error;
  assert.equal(decode(completedBody.rawOutput), output);
  assert.equal(completedBody.failure.offendingValue, output);

  const partial = '{"output":[{"type":"message","content":[{"type":"output_text","text":"{\\"derivation';
  const interrupted = await failWith(providerError('socket hang up', {
    code: 'ECONNRESET', status: 200, responseReceived: true, partialProviderResponse: createRawOutputArtifact(partial)
  }));
  assert.equal(interrupted.code, 'PROVIDER_UNAVAILABLE');
  const interruptedBody = production(interrupted).body.error;
  assert.equal(decode(interruptedBody.generationRecord.rawProviderResponse), partial);
  assert.equal(interruptedBody.failure.offendingValue, null);
});

test('production withholds a partial body of an unsuccessful provider response', async (t) => {
  withProviderKey(t);
  const partialError = providerBody.slice(0, -4);
  const error = await failWith(providerError('socket hang up', {
    code: 'ECONNRESET', status: 503, responseReceived: false, partialProviderResponse: createRawOutputArtifact(partialError)
  }));
  const publicBody = production(error);
  const serialized = JSON.stringify(publicBody.body);
  assert.equal(serialized.includes(secret), false);
  assert.equal(publicBody.body.error.generationRecord?.rawProviderResponse, undefined);
  // Development keeps the partial body for diagnosis.
  assert.equal(decode(development(error).body.error.generationRecord.rawProviderResponse), partialError);
});

test('provider log text masks credential-shaped runs', () => {
  assert.equal(redactProviderLogText('Bad key sk-proj-abcdEFGH1234 and Bearer abc.def\n  retry'),
    'Bad key [redacted] and [redacted] retry');
  assert.equal(redactProviderLogText('   '), undefined);
  assert.equal(redactProviderLogText('x'.repeat(500)).length, 220);
});
