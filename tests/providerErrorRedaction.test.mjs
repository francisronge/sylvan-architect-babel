import assert from 'node:assert/strict';
import test from 'node:test';

import { ParseApiError } from '../server/babelParser/error.js';
import { parseModelJsonDetailed } from '../server/babelParser/modelJson.js';
import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';
import { createParseRoutes } from '../server/babelParser/parseRoutes.js';
import { createRawOutputArtifact } from '../server/babelParser/validationErrors.js';
import { describeParseServerFailure, redactProviderLogText } from '../server/parseHttpPolicy.js';
import { loadFormatter } from './helpers/parseApiFormatter.mjs';

const production = await loadFormatter('production');
const development = await loadFormatter('development');

const secret = 'org-SECRETORG123';
const keyTail = 'sk-proj-****************WXYZ';
const providerBody = JSON.stringify({ error: {
  message: `Upstream overloaded for organization ${secret}, key ${keyTail}.`, code: 'server_error'
} });
const decode = (artifact) => Buffer.from(artifact.data, 'base64').toString('utf8');
// Artifacts carry their text base64-encoded, so a plain search of the body would miss it.
const decodedText = (body) => JSON.stringify(body, (key, value) => (
  key === 'data' && typeof value === 'string' ? Buffer.from(value, 'base64').toString('utf8') : value));

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
    const serialized = decodedText(publicBody.body);
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
  const serialized = decodedText(publicBody.body);
  assert.equal(serialized.includes(secret), false);
  assert.equal(publicBody.body.error.generationRecord?.rawProviderResponse, undefined);
  // Development keeps the partial body for diagnosis.
  assert.equal(decode(development(error).body.error.generationRecord.rawProviderResponse), partialError);
});

test('production withholds the error envelope of a response the provider marked failed or cancelled', async (t) => {
  withProviderKey(t);
  // OpenAI answers a stopped background response with its own error, not with model output.
  const envelope = (status) => JSON.stringify({ id: 'resp_stopped', object: 'response', status, output: [],
    error: { code: 'rate_limit_exceeded', message: `Rate limit reached for organization ${secret}, key ${keyTail}.` } });
  const replies = [];
  t.mock.method(globalThis, 'fetch', async () => new Response(replies.shift()));
  const routes = createParseRoutes({ ParseApiError, normalizeParseBundle, parseModelJsonDetailed });
  const request = ['Mia laughed.', 'xbar', 'openai:gpt-6-sol', { settings: {} }];
  const failure = (promise) => promise.then(() => assert.fail('expected a typed failure'), (error) => error);
  for (const status of ['failed', 'cancelled']) {
    // One long request: the creation itself answers with the stopped response.
    replies.push(envelope(status));
    const held = await failure(routes.parseSentenceWithResearchModel(...request));
    // One ticket: the creation is queued, and the check finds the response stopped.
    replies.push(JSON.stringify({ id: 'resp_stopped', status: 'queued' }), envelope(status));
    const { ticket } = await routes.startParseTicket(...request);
    const checked = await failure(routes.checkParseTicket(ticket));
    assert.equal(replies.length, 0);
    for (const [path, error] of [['long request', held], ['ticket check', checked]]) {
      const label = `${status} via ${path}`;
      assert.equal(error.code, 'INCOMPLETE_GENERATION', label);
      const publicBody = production(error);
      assert.equal(publicBody.status, 502, label);
      assert.match(publicBody.body.error.message, new RegExp(status, 'iu'), label);
      assert.equal(publicBody.body.error.failure.ruleId, 'GENERATION_COMPLETED_STOP_FAILURE', label);
      const serialized = decodedText(publicBody.body);
      assert.equal(serialized.includes(secret), false, label);
      assert.equal(serialized.includes('WXYZ'), false, label);
      assert.equal(publicBody.body.error.rawOutput, undefined, label);
      assert.equal(publicBody.body.error.generationRecord?.rawProviderResponse, undefined, label);
      assert.equal(publicBody.body.error.generationRecord?.outcome?.finishStatus, 'COMPLETED_STOP_FAILURE', label);
      // Development keeps the envelope, and the server log keeps a redacted provider message.
      assert.equal(decode(development(error).body.error.rawOutput), envelope(status), label);
      assert.match(describeParseServerFailure(error, publicBody).providerMessage, /org-SECRETORG123/u, label);
    }
  }
});

test('provider log text masks credential-shaped runs', () => {
  assert.equal(redactProviderLogText('Bad key sk-proj-abcdEFGH1234 and Bearer abc.def\n  retry'),
    'Bad key [redacted] and [redacted] retry');
  assert.equal(redactProviderLogText('   '), undefined);
  assert.equal(redactProviderLogText('x'.repeat(500)).length, 220);
});
