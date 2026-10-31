import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ORIGIN = 'https://babel.example';
Object.assign(process.env, {
  NODE_ENV: 'production', BABEL_SAVE_PROVIDER_RAW: '0', BABEL_ALLOWED_ORIGINS: ORIGIN,
  BABEL_PARSE_API_TOKEN: '', BABEL_REQUIRE_ORIGIN: '1', BABEL_ALLOW_NO_ORIGIN: '0',
  OPENAI_API_KEY: 'offline-test-key', BABEL_PROVIDER_MODEL_TIMEOUT_MS: '', BABEL_PROVIDER_REQUEST_BUDGET_MS: ''
});
const {
  default: handler, HOSTED_FUNCTION_MAX_DURATION_MS, HOSTED_PROVIDER_DEADLINE_MS
} = await import('../api/parse.js');
const { parseFromRequest } = await import('../server/parseApi.js');

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

// The Vercel platform's request and response, as far as the handler uses them.
const hostedExchange = () => {
  const res = Object.assign(new EventEmitter(), {
    destroyed: false, writableFinished: false, statusCode: 0, body: undefined,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.writableFinished = true; return this; }
  });
  const req = { method: 'POST', aborted: false,
    headers: { origin: ORIGIN, host: 'babel.example', 'content-type': 'application/json' },
    body: { sentence: 'Mia laughed.', framework: 'xbar', modelId: 'openai:gpt-6-sol' } };
  return { req, res };
};

test('the hosted deadline matches the function limit Vercel enforces, leaving headroom to answer', () => {
  const { maxDuration } = vercel.functions['api/parse.js'];
  assert.ok(maxDuration <= 300, 'Vercel rejects every deployment whose maxDuration exceeds the plan limit of 300 s');
  assert.equal(HOSTED_FUNCTION_MAX_DURATION_MS, maxDuration * 1000);
  assert.ok(HOSTED_PROVIDER_DEADLINE_MS < HOSTED_FUNCTION_MAX_DURATION_MS);
});

test('the hosted function stops waiting for the provider at its deadline and answers with a clean timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let providerCalls = 0;
  let providerAborted = false;
  let providerCalled;
  const called = new Promise(resolve => { providerCalled = resolve; });
  // A provider that never answers until Babel stops waiting.
  t.mock.method(globalThis, 'fetch', (url, options) => {
    providerCalls++;
    providerCalled();
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => {
      providerAborted = true;
      reject(options.signal.reason);
    }, { once: true }));
  });
  const { req, res } = hostedExchange();
  let settled = false;
  const handled = handler(req, res).finally(() => { settled = true; });
  await called;

  // withTimeout keeps 250 ms of the remaining budget for itself.
  t.mock.timers.tick(HOSTED_PROVIDER_DEADLINE_MS - 251);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'the provider call is still running just before the deadline');

  t.mock.timers.tick(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, true, 'the provider call ends at the deadline');
  await handled;
  assert.equal(providerAborted, true);
  assert.equal(providerCalls, 1, 'Babel never retries automatically');
  assert.equal(res.statusCode, 504);
  assert.equal(res.body.error.code, 'PROVIDER_TIMEOUT');
  assert.match(res.body.error.message, /^Generation took too long: OpenAI timed out before a result was received\. You can try again\.$/);
  assert.equal(res.body.error.failure.ruleId, 'PROVIDER_TIMEOUT');
  assert.ok(Date.now() < HOSTED_FUNCTION_MAX_DURATION_MS, 'Babel answers before Vercel would stop the function');
});

test('the local Express runtime and research runners keep their own longer limit', async () => {
  const { req, res } = hostedExchange();
  let received;
  await parseFromRequest(req, res, async (_, options) => { received = options; });
  assert.equal('deadlineAt' in received, false);
});
