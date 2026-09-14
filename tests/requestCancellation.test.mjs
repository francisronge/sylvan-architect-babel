import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import test from 'node:test';
import { parseFromBodyWithProviders, parseFromRequest } from '../server/parseApi.js';
import { runWithTransportRetries, withTimeout } from '../server/babelParser/modelRuntime.js';
import { createParseRoutes } from '../server/babelParser/parseRoutes.js';
import { ParseApiError } from '../server/babelParser/error.js';

test('HTTP cancellation follows an unfinished response, not a completed request body', async () => {
  const req = Object.assign(new EventEmitter(), { body: { sentence: 'Mia laughed.' } });
  const res = new EventEmitter();
  let signal;
  const pending = parseFromRequest(req, res, async (body, options) => {
    assert.equal(body, req.body);
    signal = options.abortSignal;
    return withTimeout(() => new Promise(() => {}), 0, 'Parse', signal);
  });
  req.emit('close');
  assert.equal(signal.aborted, false);
  res.emit('close');
  await assert.rejects(pending, { name: 'AbortError', message: 'Client disconnected.' });
  assert.equal(signal.aborted, true);
  assert.equal(res.listenerCount('close'), 0);
  assert.equal(getEventListeners(signal, 'abort').length, 0);
});

test('completed, failed and already disconnected HTTP requests clean up without spurious cancellation', async () => {
  for (const fails of [false, true]) {
    const res = new EventEmitter();
    let signal;
    const pending = parseFromRequest({ body: {} }, res, async (_, options) => {
      signal = options.abortSignal;
      res.writableFinished = true;
      res.emit('close');
      assert.equal(signal.aborted, false);
      if (fails) throw new Error('Existing failure');
      return 'done';
    });
    if (fails) await assert.rejects(pending, /Existing failure/);
    else assert.equal(await pending, 'done');
    assert.equal(res.listenerCount('close'), 0);
  }
  for (const state of ['request', 'response']) {
    const req = { body: {}, aborted: state === 'request' };
    const res = Object.assign(new EventEmitter(), { destroyed: state === 'response' });
    await assert.rejects(parseFromRequest(req, res, () => assert.fail('No generation after disconnect')), { name: 'AbortError' });
    assert.equal(res.listenerCount('close'), 0);
  }
});

test('body routing forwards cancellation separately from model-authored input', async () => {
  const controller = new AbortController();
  const provider = async (...args) => args.at(-1).abortSignal;
  const providers = { gemini: provider, gpt: provider, claude: provider, research: provider };
  for (const selection of [{ modelRoute: 'gemini' }, { modelRoute: 'gpt' }, { modelRoute: 'claude' }, { modelId: 'openai:gpt-6-astra' }]) {
    assert.equal(await parseFromBodyWithProviders({ sentence: 'Mia laughed.', ...selection }, providers,
      { abortSignal: controller.signal }), controller.signal);
  }
  controller.abort();
  await assert.rejects(parseFromBodyWithProviders({ sentence: 'Mia laughed.' },
    { gemini: () => assert.fail('No generation after cancellation') }, { abortSignal: controller.signal }), { name: 'AbortError' });
});

test('cancellation stops bounded or unbounded transport even when the transport ignores its signal', async () => {
  for (const timeout of [0, 10000]) {
    const controller = new AbortController();
    let attemptSignal;
    const pending = withTimeout(signal => {
      attemptSignal = signal;
      return new Promise(() => {});
    }, timeout, 'Generation', controller.signal);
    controller.abort();
    await assert.rejects(pending, error => error === controller.signal.reason);
    assert.equal(attemptSignal.reason, controller.signal.reason);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
});

test('finished transport removes its cancellation listener and cancellation prevents later attempts', async () => {
  const controller = new AbortController();
  let attemptSignal;
  assert.equal(await withTimeout(signal => { attemptSignal = signal; return 'done'; }, 10000, 'Generation', controller.signal), 'done');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(getEventListeners(attemptSignal, 'abort').length, 0);
  controller.abort();
  assert.equal(attemptSignal.aborted, false);
  await assert.rejects(withTimeout(() => assert.fail('No transport after cancellation'), 10000, 'Generation', controller.signal),
    error => error === controller.signal.reason);
});

test('disconnect during retry backoff clears the wait and does not submit another generation', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = runWithTransportRetries({
    abortSignal: controller.signal,
    backoffBaseMs: 10000,
    run: async () => {
      calls++;
      // The retry loop schedules its wait before the following task runs.
      setImmediate(() => controller.abort());
      throw Object.assign(new Error('Temporary server failure'), { status: 503 });
    }
  });
  await assert.rejects(pending, error => {
    assert.equal(error.providerAttempts.length, 1);
    assert.equal(error.providerRetryStopReason, 'cancelled');
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('legacy Gemini, OpenAI and Claude routes propagate cancellation without normalizing or retrying', async t => {
  for (const key of ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
    const previous = process.env[key]; process.env[key] = 'test-only';
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(globalThis, 'fetch', () => assert.fail('No network permitted'));
  let calls = 0, attemptSignal;
  const generate = ({ abortSignal }) => { calls++; attemptSignal = abortSignal; return new Promise(() => {}); };
  const unexpected = () => assert.fail('Cancelled work must not be normalized');
  const routes = createParseRoutes({ ParseApiError, normalizeParseBundle: unexpected, parseModelJson: unexpected,
    generateGemini: generate, generateOpenAI: generate, generateClaude: generate });
  for (const [method, route] of [['parseSentenceWithGemini', 'gemini'], ['parseSentenceWithOpenAI', 'gpt'], ['parseSentenceWithClaude', 'claude']]) {
    const controller = new AbortController(), before = calls;
    const pending = routes[method]('Mia laughed.', 'xbar', route, { abortSignal: controller.signal });
    assert.equal(calls, before + 1);
    controller.abort();
    await assert.rejects(pending);
    assert.equal(attemptSignal.aborted, true);
    assert.equal(calls, before + 1);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
});
