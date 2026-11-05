import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

// The hosted function with no shared counter store configured.
const ORIGIN = 'https://babel.example';
Object.assign(process.env, {
  NODE_ENV: 'production', BABEL_SAVE_PROVIDER_RAW: '0', BABEL_ALLOWED_ORIGINS: ORIGIN,
  BABEL_PARSE_API_TOKEN: '', BABEL_REQUIRE_ORIGIN: '1', BABEL_ALLOW_NO_ORIGIN: '0', OPENAI_API_KEY: 'offline-test-key'
});
for (const name of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'BABEL_PARSE_COUNTER']) {
  delete process.env[name];
}
const { default: handler } = await import('../api/parse.js');

const exchange = (body, headers = {}) => {
  const res = Object.assign(new EventEmitter(), {
    destroyed: false, writableFinished: false, statusCode: 0, body: undefined,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; this.writableFinished = true; return this; }
  });
  const req = { method: 'POST', aborted: false, body,
    headers: { origin: ORIGIN, host: 'babel.example', 'content-type': 'application/json', ...headers } };
  return { req, res };
};

test('without a shared counter the hosted function starts no parse and calls no provider', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('no provider call is permitted'); });
  const errors = t.mock.method(console, 'error', () => {});
  for (const body of [{ sentence: 'Mia laughed.', start: true }, { sentence: 'Mia laughed.' }]) {
    const { req, res } = exchange(body, { 'x-forwarded-for': '203.0.113.7' });
    await handler(req, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error.code, 'LIMITS_UNAVAILABLE');
  }
  assert.equal(fetch.mock.callCount(), 0);
  assert.match(String(errors.mock.calls[0]?.arguments[0]), /no shared counter store/);
});

test('without a shared counter a check is still answered, since it starts nothing', async () => {
  const { req, res } = exchange({ ticket: 'not-a-ticket' });
  await handler(req, res);
  assert.notEqual(res.body?.error?.code, 'LIMITS_UNAVAILABLE');
});
