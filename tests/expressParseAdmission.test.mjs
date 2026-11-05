import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { trackProviderCalls, withTimeout } from '../server/babelParser/providerTransport.js';
import { restateAsSpellout } from './helpers/spelloutPayload.mjs';

const anthropic = 'https://api.anthropic.com/v1/messages';
const origin = 'http://app.test';
const token = 'admission-test-token';
const fixture = JSON.parse(readFileSync(new URL('../fixtures/raw/what-did-mia-see.xbar.json', import.meta.url), 'utf8'));
// A model answer that parses: the saved analysis as a live route receives it.
const completedAnswer = { model: 'claude-opus-5', stop_reason: 'end_turn', usage: { input_tokens: 11, output_tokens: 22 },
  content: [{ type: 'text', text: JSON.stringify(restateAsSpellout(fixture.payload, fixture.sentence)) }] };

// Starts the real Express runtime with every provider call scripted.
const startServer = async (t, env) => {
  const child = fork(new URL('./support/backgroundParseServer.mjs', import.meta.url), [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, NODE_ENV: 'production', PORT: '0', ANTHROPIC_API_KEY: 'test-only',
      // Admission is the same for any model; these requests name several to hold slots.
      BABEL_PUBLIC_REQUEST_ONLY: '0',
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
  // An admitted parse whose provider answers at once with an error.
  const admitted = { status: 503, code: 'MODEL_UNAVAILABLE' };
  const scriptRefusal = async () => {
    const configured = message('configured');
    child.send({ type: 'replies', replies: [{ url: anthropic, method: 'POST',
      status: 404, body: { type: 'error', error: { type: 'not_found_error', message: 'Scripted' } } }] });
    await configured;
  };
  const parse = async () => { await scriptRefusal(); return post({ body: generation }); };
  // Retries one scripted parse until a slot is free; a busy refusal makes no provider call.
  const retryWhileBusy = async (body) => {
    let result;
    for (let attempt = 0; attempt < 100; attempt++) {
      result = await post({ body });
      if (result.code !== 'SERVER_BUSY') return result;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return result;
  };
  const waitForFreeSlot = async () => { await scriptRefusal(); return retryWhileBusy(generation); };
  // A parse that succeeds, so it keeps the parse it used (a failed one gives it back).
  const succeed = async () => {
    const configured = message('configured');
    child.send({ type: 'replies', replies: [{ url: anthropic, method: 'POST', body: completedAnswer }] });
    await configured;
    return retryWhileBusy({ ...generation, sentence: fixture.sentence, framework: fixture.framework });
  };
  return { message, post, parse, hold, settle, generation, admitted, waitForFreeSlot, succeed, output: () => output };
};

test('requests refused before admission do not use the daily allowance', { timeout: 30000 }, async t => {
  const server = await startServer(t, { BABEL_PARSE_DAILY_LIMIT_PER_IP: '1' });
  assert.deepEqual(await server.post({ headers: { 'x-babel-api-token': '' } }), { status: 401, code: 'UNAUTHORIZED' });
  assert.deepEqual(await server.post({ headers: { origin: 'http://elsewhere.test' } }), { status: 403, code: 'FORBIDDEN_ORIGIN' });
  assert.deepEqual(await server.post({ headers: { 'content-type': 'text/plain' } }), { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  // A request Babel would refuse uses no allowance: an empty body, or a sentence over the length limit.
  assert.deepEqual(await server.post(), { status: 400, code: 'INVALID_REQUEST' });
  assert.deepEqual(await server.post({ body: { ...server.generation, sentence: 'a'.repeat(601) } }), { status: 400, code: 'INVALID_REQUEST' });
  // A failed parse gives its parse back; a successful one keeps it.
  assert.deepEqual(await server.parse(), server.admitted);
  assert.deepEqual(await server.succeed(), { status: 200, code: undefined }, server.output());
  assert.deepEqual(await server.post({ body: server.generation }), { status: 429, code: 'RATE_LIMITED_DAILY' });
});

test('requests refused while every slot is busy do not use the daily allowance', { timeout: 30000 }, async t => {
  const server = await startServer(t, { BABEL_PARSE_DAILY_LIMIT_PER_IP: '2', BABEL_MAX_IN_FLIGHT_PARSES: '1' });
  await server.hold();
  const called = server.message('provider-call');
  const running = server.post({ body: server.generation });
  await called;
  for (let refused = 0; refused < 3; refused++) {
    assert.deepEqual(await server.post({ body: server.generation }), { status: 503, code: 'SERVER_BUSY' });
  }
  await server.settle();
  assert.notEqual((await running).code, 'SERVER_BUSY');
  assert.deepEqual(await server.waitForFreeSlot(), server.admitted);
  // Both admitted parses failed and gave theirs back, and no busy refusal used one: two remain.
  assert.deepEqual(await server.succeed(), { status: 200, code: undefined }, server.output());
  assert.deepEqual(await server.succeed(), { status: 200, code: undefined }, server.output());
  assert.deepEqual(await server.post({ body: server.generation }), { status: 429, code: 'RATE_LIMITED_DAILY' });
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
    assert.deepEqual(await server.post({ body: server.generation }), { status: 503, code: 'SERVER_BUSY' });
  }
  await server.settle();
  assert.deepEqual(await server.waitForFreeSlot(), server.admitted);
  assert.doesNotMatch(server.output(), /test-only|uncaught|unhandled/i);
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
