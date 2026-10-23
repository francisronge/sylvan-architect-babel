import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { trackProviderCalls, withTimeout } from '../server/babelParser/providerTransport.js';
import { createDailyParseQuota } from '../server/dailyParseQuota.js';

const anthropic = 'https://api.anthropic.com/v1/messages';
const origin = 'http://app.test';
const token = 'admission-test-token';

// Starts the real Express runtime with every provider call scripted.
const startServer = async (t, env) => {
  const child = fork(new URL('./support/backgroundParseServer.mjs', import.meta.url), [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, NODE_ENV: 'production', PORT: '0', ANTHROPIC_API_KEY: 'test-only',
      BABEL_SAVE_PROVIDER_RAW: '0', BABEL_TRUST_PROXY: '0', BABEL_PARSE_RATE_LIMIT_PER_MINUTE: '200',
      BABEL_ALLOWED_ORIGINS: origin, BABEL_PARSE_API_TOKEN: token, ...env }
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const message = (type, timeout = 5000) => new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); child.off('message', receive); child.off('exit', exit); };
    const receive = event => { if (event.type === type) { cleanup(); resolve(event); } };
    const exit = () => { cleanup(); reject(new Error(`Server exited before ${type}: ${output}`)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`No ${type} before ${timeout} ms: ${output}`)); }, timeout);
    child.on('message', receive);
    child.once('exit', exit);
  });
  const { port } = await message('ready', 10000);
  const url = `http://127.0.0.1:${port}/api/parse`;
  const post = async ({ headers = {}, body = {}, signal } = {}) => {
    const response = await fetch(url, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', origin, 'x-babel-api-token': token, ...headers },
      body: JSON.stringify(body)
    });
    return { status: response.status, code: (await response.json()).error?.code };
  };
  const hold = async () => {
    const configured = message('configured');
    child.send({ type: 'replies', replies: [{ url: anthropic, method: 'POST', holdUntilSettled: true,
      status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Scripted' } } }] });
    await configured;
  };
  const settle = async () => {
    const settled = message('settled');
    child.send({ type: 'settle' });
    await settled;
  };
  const generation = { sentence: 'Mia laughed.', framework: 'xbar', modelId: 'anthropic:claude-opus-5' };
  // An empty body is admitted and fails validation before any provider call.
  const admitted = { status: 400, code: 'INVALID_REQUEST' };
  const waitForFreeSlot = async () => {
    let result;
    for (let attempt = 0; attempt < 100; attempt++) {
      result = await post();
      if (result.code !== 'SERVER_BUSY') return result;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return result;
  };
  return { message, post, hold, settle, generation, admitted, waitForFreeSlot, output: () => output };
};

test('requests refused before admission do not use the daily allowance', { timeout: 30000 }, async t => {
  const server = await startServer(t, { BABEL_PARSE_DAILY_LIMIT_PER_IP: '1' });
  assert.deepEqual(await server.post({ headers: { 'x-babel-api-token': '' } }), { status: 401, code: 'UNAUTHORIZED' });
  assert.deepEqual(await server.post({ headers: { origin: 'http://elsewhere.test' } }), { status: 403, code: 'FORBIDDEN_ORIGIN' });
  assert.deepEqual(await server.post({ headers: { 'content-type': 'text/plain' } }), { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  assert.deepEqual(await server.post(), server.admitted);
  assert.deepEqual(await server.post(), { status: 429, code: 'RATE_LIMITED_DAILY' });
});

test('requests refused while every slot is busy do not use the daily allowance', { timeout: 30000 }, async t => {
  const server = await startServer(t, { BABEL_PARSE_DAILY_LIMIT_PER_IP: '2', BABEL_MAX_IN_FLIGHT_PARSES: '1' });
  await server.hold();
  const called = server.message('provider-call');
  const running = server.post({ body: server.generation });
  await called;
  for (let refused = 0; refused < 3; refused++) {
    assert.deepEqual(await server.post(), { status: 503, code: 'SERVER_BUSY' });
  }
  await server.settle();
  assert.notEqual((await running).code, 'SERVER_BUSY');
  assert.deepEqual(await server.waitForFreeSlot(), server.admitted);
  assert.deepEqual(await server.post(), { status: 429, code: 'RATE_LIMITED_DAILY' });
});

test('a disconnected request keeps its slot until its provider call settles', { timeout: 30000 }, async t => {
  const server = await startServer(t, { BABEL_MAX_IN_FLIGHT_PARSES: '1' });
  await server.hold();
  const called = server.message('provider-call');
  const controller = new AbortController();
  const disconnected = assert.rejects(server.post({ body: server.generation, signal: controller.signal }), { name: 'AbortError' });
  await called;
  const abortIgnored = server.message('provider-abort-ignored');
  controller.abort();
  await disconnected;
  await abortIgnored;
  // The request has ended, but the provider is still working on its generation.
  for (let refused = 0; refused < 3; refused++) {
    assert.deepEqual(await server.post(), { status: 503, code: 'SERVER_BUSY' });
  }
  await server.settle();
  assert.deepEqual(await server.waitForFreeSlot(), server.admitted);
  assert.doesNotMatch(server.output(), /test-only|uncaught|unhandled/i);
});

test('the daily quota counts a bounded set of clients and resets each day', () => {
  let clock = Date.UTC(2026, 9, 22, 12);
  const quota = createDailyParseQuota({ limit: 2, maxClients: 100, now: () => clock });
  quota.record('steady');
  quota.record('steady');
  for (let client = 0; client < 50000; client++) {
    quota.record(`client-${client}`);
    if (client % 50 === 0) quota.record('steady');
    assert.ok(quota.size <= 100);
  }
  assert.equal(quota.size, 100);
  // Recently admitted clients are still counted; the oldest were evicted.
  quota.record('client-49999');
  assert.equal(quota.exhausted('client-49999'), true);
  assert.equal(quota.exhausted('client-49998'), false);
  assert.equal(quota.exhausted('client-0'), false);
  assert.equal(quota.exhausted('steady'), true);
  clock += 12 * 3600000;
  assert.equal(quota.exhausted('steady'), false);
  assert.equal(quota.size, 0);
});

test('tracked provider calls settle after the request stops waiting for them', async () => {
  const controller = new AbortController();
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  };
  const [timedOut, cancelled, remoteCancellation] = [deferred(), deferred(), deferred()];
  let settled = false;
  const generation = trackProviderCalls(async () => {
    // A timed-out attempt and a cancelled retry, both ignoring their signals.
    await assert.rejects(withTimeout(() => timedOut.promise, 1, 'Attempt', controller.signal), { code: 'PROVIDER_TIMEOUT' });
    const retry = withTimeout(() => cancelled.promise, 0, 'Retry', controller.signal);
    // A call without the request's signal, like best-effort remote cancellation, is not tracked.
    void withTimeout(() => remoteCancellation.promise, 60000, 'Remote cancellation').catch(() => {});
    controller.abort();
    return retry;
  });
  generation.settled.then(() => { settled = true; });
  await assert.rejects(generation.result, { name: 'AbortError' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  cancelled.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  timedOut.resolve();
  await generation.settled;
  remoteCancellation.resolve();
});
