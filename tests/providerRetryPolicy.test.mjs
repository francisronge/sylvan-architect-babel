import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';

import { ParseApiError } from '../server/babelParser/error.js';
import {
  assertGenerationComplete,
  buildAnthropicRequestBody,
  buildGrokRequestBody,
  buildKimiRequestBody,
  buildOpenAIRequestBody,
  generateAnthropicStructuredContent,
  generateGrokStructuredContent,
  generateKimiStructuredContent,
  generateOpenAIStructuredContent,
  isRetryableProviderFailure,
  runWithTransportRetries,
  withTimeout
} from '../server/babelParser/modelRuntime.js';

const originalNodeEnv = process.env.NODE_ENV;
before(() => { process.env.NODE_ENV = 'production'; });
after(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});
beforeEach((t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('Unexpected network call'));
});

const failure = (message, fields = {}) => Object.assign(new Error(message), fields);
const completed = (text = '{}', finishReason = 'STOP') => ({
  text, status: 'completed', candidates: [{ finishReason }]
});
const noDelay = async () => assert.fail('Terminal failures must not back off');
const options = {
  apiKey: 'offline-test-key', model: 'offline-model', contents: 'input',
  systemInstruction: 'shared system prompt', reasoningEffort: 'high', effort: 'high',
  maxOutputTokens: 1234, background: false, pollIntervalMs: 0
};
const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), { status });
const stubFetch = (t, responses) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), ...init });
    assert.ok(responses.length, 'Unexpected extra provider request');
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  });
  return calls;
};

test('explicit rate limits override transport/server retry signals', async (t) => {
  for (const [label, error] of [
    ['HTTP 429 with network text', failure('fetch failed', { status: 429 })],
    ['nested HTTP status', failure('network error', { response: { status: 429 } })],
    ['numeric SDK code', failure('network error', { code: 429 })],
    ['message', failure('rate limited', { status: 503 })],
    ['provider error body', failure('request failed', { status: 503, responseBody: '{"type":"rate_limit_error"}' })],
    ['resource exhausted', failure('RESOURCE_EXHAUSTED', { status: 503 })],
    ['quota', failure('quota exceeded', { status: 500 })],
    ['too many requests', failure('Too many requests', { status: 502 })],
    ['non-enumerable cause', new Error('fetch failed', { cause: failure('rate limit', { status: 429 }) })]
  ]) {
    await t.test(label, async () => {
      let calls = 0;
      assert.equal(isRetryableProviderFailure(error), false);
      await assert.rejects(runWithTransportRetries({
        runId: 'rate-limit', delay: noDelay,
        run: async () => { calls += 1; throw error; }
      }), (actual) => {
        assert.equal(actual, error);
        assert.equal(actual.providerRunId, 'rate-limit');
        assert.equal(actual.providerAttempts.length, 1);
        assert.equal(actual.providerAttempts[0].retryReason, 'rate_limit');
        assert.equal(actual.details.providerAttempts, actual.providerAttempts);
        return true;
      });
      assert.equal(calls, 1);
    });
  }
});

test('application errors, completed stops, and permanent failures are terminal', async (t) => {
  for (const error of [
    new ParseApiError('BAD_MODEL_RESPONSE', 'network error in received JSON', 502),
    new ParseApiError('PARSE_ENGINE_FAILED', 'fetch failed during validation', 500),
    new ParseApiError('PROVIDER_UNAVAILABLE', 'route deadline guard', 503),
    Object.assign(new SyntaxError('network error in JSON'), { status: 503 }),
    failure('server error', { status: 502, completedStopState: true }),
    failure('network error', { status: 503, responseReceived: true }),
    Object.assign(new Error('fetch failed', { cause: failure('unauthorized', { status: 401 }) }), { status: 500 }),
    failure('unrecognized application failure'),
    ...[400, 401, 403, 404, 422, 501, 505].map((status) => failure('network error', { status }))
  ]) {
    await t.test(`${error.code || error.name}: ${error.message} (${error.status || 'no status'})`, async () => {
      let calls = 0;
      assert.equal(isRetryableProviderFailure(error), false);
      await assert.rejects(runWithTransportRetries({
        delay: noDelay,
        run: async () => { calls += 1; throw error; }
      }), (actual) => actual === error && actual.providerAttempts.length === 1);
      assert.equal(calls, 1);
    });
  }
});

test('only recognized transient failures retry, with one run ID and at most three attempts', async (t) => {
  for (const error of [
    ...[500, 502, 503, 529].map((status) => failure('provider unavailable', { status })),
    ...['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_SOCKET'].map((code) => (
      new Error('fetch failed', { cause: failure('connection failed', { code }) })
    ))
  ]) {
    await t.test(String(error.status || error.cause.code), async () => {
      let calls = 0;
      let clock = 0;
      const delays = [];
      const receipt = await runWithTransportRetries({
        runId: 'transient', maxAttempts: 99, backoffBaseMs: 10,
        now: () => new Date(clock++), delay: async (ms) => { delays.push(ms); },
        run: async ({ runId, attemptNumber }) => {
          assert.equal(runId, 'transient');
          assert.equal(attemptNumber, ++calls);
          if (calls < 3) throw error;
          return completed();
        }
      });
      assert.equal(isRetryableProviderFailure(error), true);
      assert.equal(receipt.runId, 'transient');
      assert.equal(calls, 3);
      assert.deepEqual(delays, [10, 20]);
      assert.deepEqual(receipt.attempts.map(({ outcome }) => outcome), [
        'retryable_transport_failure', 'retryable_transport_failure', 'completed'
      ]);
      assert.equal(receipt.attempts[0].startedAt, new Date(0).toISOString());
      assert.equal(receipt.attempts[2].completedAt, new Date(5).toISOString());
      if (error.cause) {
        assert.equal(receipt.attempts[0].causeCode, error.cause.code);
        assert.equal(receipt.attempts[0].causeMessage, 'connection failed');
      }
    });
  }
});

test('attempt exhaustion preserves the original cause, details, and exact attempt cap', async (t) => {
  for (const [maxAttempts, expected] of [[99, 3], [2, 2], [1, 1], [0, 1], [2.9, 2]]) {
    await t.test(String(maxAttempts), async () => {
      const cause = failure('connection reset', { code: 'ECONNRESET' });
      const error = Object.assign(new Error('fetch failed', { cause }), { details: { retained: true } });
      let calls = 0;
      const delays = [];
      await assert.rejects(runWithTransportRetries({
        maxAttempts, delay: async (ms) => { delays.push(ms); },
        run: async () => { calls += 1; throw error; }
      }), (actual) => {
        assert.equal(actual, error);
        assert.equal(actual.cause, cause);
        assert.equal(actual.details.retained, true);
        assert.equal(actual.providerRetryStopReason, 'attempt_limit');
        assert.equal(actual.providerAttempts.length, expected);
        return true;
      });
      assert.equal(calls, expected);
      assert.equal(delays.length, expected - 1);
    });
  }
});

test('primitive and frozen exceptions retain diagnostics without changing retry policy', async (t) => {
  for (const [label, error, expectedCalls] of [
    ['null', null, 1],
    ['string', 'provider rejected input', 1],
    ['frozen rate limit', Object.freeze(failure('rate limit', { status: 429 })), 1],
    ['frozen transient', Object.freeze(failure('server unavailable', { status: 503 })), 3],
    ['frozen application error', Object.freeze(new ParseApiError('BAD_MODEL_RESPONSE', 'invalid JSON', 502)), 1]
  ]) {
    await t.test(label, async () => {
      let calls = 0;
      await assert.rejects(runWithTransportRetries({
        delay: async () => {}, run: async () => { calls += 1; throw error; }
      }), (actual) => {
        assert.equal(actual.cause, error);
        assert.equal(actual.providerAttempts.length, expectedCalls);
        return true;
      });
      assert.equal(calls, expectedCalls);
    });
  }
});

test('backoff rejection retains the attempted transport failure without another generation', async () => {
  const error = failure('backoff interrupted');
  let calls = 0;
  await assert.rejects(runWithTransportRetries({
    delay: async () => { throw error; },
    run: async () => { calls += 1; throw failure('server unavailable', { status: 503 }); }
  }), (actual) => {
    assert.equal(actual, error);
    assert.equal(actual.providerRetryStopReason, 'backoff_failed');
    assert.equal(actual.providerAttempts.length, 1);
    assert.equal(actual.providerAttempts[0].statusCode, 503);
    return true;
  });
  assert.equal(calls, 1);
});

test('nested and cyclic causes cannot hide a timeout or hang classification', () => {
  const timeout = failure('headers stalled', { code: 'UND_ERR_HEADERS_TIMEOUT' });
  const wrapped = new Error('fetch failed', { cause: new Error('wrapper', { cause: timeout }) });
  assert.equal(isRetryableProviderFailure(wrapped), false);
  const cyclic = failure('connection failed', { code: 'ECONNRESET' });
  cyclic.cause = cyclic;
  assert.equal(isRetryableProviderFailure(cyclic), true);
});

test('ambiguous timeout and abort signals never start another generation', async (t) => {
  for (const error of [
    failure('request timed out'), failure('fetch failed', { code: 'ETIMEDOUT' }),
    failure('fetch failed', { status: 408 }), failure('gateway failure', { status: 504 }),
    ...['ABORT_ERR', 'ERR_CANCELED'].map((code) => new Error('fetch failed', { cause: failure('operation stopped', { code }) })),
    new DOMException('operation stopped', 'AbortError'),
    new DOMException('operation stopped', 'TimeoutError'),
    new Error('fetch failed', { cause: failure('body stalled', { code: 'UND_ERR_BODY_TIMEOUT' }) })
  ]) {
    await t.test(`${error.name}: ${error.message} ${error.status || error.code || ''}`, async () => {
      let calls = 0;
      await assert.rejects(runWithTransportRetries({
        delay: noDelay,
        run: async () => { calls += 1; throw error; }
      }), (actual) => actual === error && actual.providerAttempts[0].retryReason === 'uncertain_timeout');
      assert.equal(calls, 1);
    });
  }
});

test('withTimeout aborts a submitted request without replacing a possibly running generation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let signal;
  let finish;
  const result = runWithTransportRetries({
    delay: noDelay,
    run: () => withTimeout((abortSignal) => {
      calls += 1;
      signal = abortSignal;
      return new Promise((resolve) => { finish = resolve; });
    }, 20, 'Submitted generation')
  });
  t.mock.timers.tick(20);
  await assert.rejects(result, (error) => {
    assert.equal(error.code, 'PROVIDER_TIMEOUT');
    assert.equal(error, signal.reason);
    assert.equal(error.providerAttempts.length, 1);
    return true;
  });
  assert.equal(signal.aborted, true);
  finish(completed());
  assert.equal(calls, 1);
});

test('deadline prevents even the first attempt when already expired', async () => {
  await assert.rejects(runWithTransportRetries({
    deadlineAt: 1000, now: () => new Date(1000), delay: noDelay,
    run: async () => assert.fail('No generation may start after its deadline')
  }), (error) => {
    assert.equal(error.code, 'PROVIDER_DEADLINE_EXCEEDED');
    assert.equal(error.providerRetryStopReason, 'deadline_exhausted');
    assert.deepEqual(error.providerAttempts, []);
    return true;
  });
});

test('backoff never starts when it would reach or cross the deadline', async (t) => {
  for (const remaining of [0, 10, 11]) {
    await t.test(String(remaining), async () => {
      let clock = 0;
      let calls = 0;
      const delays = [];
      const error = failure('temporarily unavailable', { status: 503 });
      await assert.rejects(runWithTransportRetries({
        deadlineAt: 100 + remaining, now: () => new Date(clock), backoffBaseMs: 10,
        delay: async (ms) => { delays.push(ms); clock += ms; },
        run: async () => { calls += 1; clock = 100 + (calls - 1) * 10; throw error; }
      }), (actual) => actual === error && actual.providerRetryStopReason === 'deadline_exhausted');
      assert.equal(calls, remaining > 10 ? 2 : 1);
      assert.deepEqual(delays, remaining > 10 ? [10] : []);
    });
  }
});

test('deadline is rechecked after an oversleep without recording a phantom attempt', async () => {
  let clock = 0;
  let calls = 0;
  const error = failure('server unavailable', { status: 503 });
  await assert.rejects(runWithTransportRetries({
    deadlineAt: 100, now: () => new Date(clock), backoffBaseMs: 10,
    delay: async () => { clock = 100; },
    run: async () => { calls += 1; throw error; }
  }), (actual) => {
    assert.equal(actual, error);
    assert.equal(actual.providerAttempts.length, 1);
    assert.equal(actual.providerAttempts[0].retryStopReason, 'deadline_exhausted');
    return true;
  });
  assert.equal(calls, 1);
});

test('received answers cannot be replaced by summary, parsing, validation, or stop failures', async (t) => {
  for (const [label, value, consume] of [
    ['summary', { get text() { throw failure('fetch failed', { status: 503 }); } }, () => {}],
    ['JSON parsing', completed('not JSON'), (receipt) => JSON.parse(receipt.value.text)],
    ['validation', completed(), () => { throw new ParseApiError('BAD_MODEL_RESPONSE', 'network error', 502); }],
    ...['MAX_TOKENS', 'SAFETY', 'FAILED', 'CANCELLED'].map((stop) => [
      stop, completed('{}', stop), (receipt) => assertGenerationComplete({
        generation: receipt.value, provider: 'offline', model: 'offline-model',
        runId: receipt.runId, attempts: receipt.attempts
      })
    ])
  ]) {
    await t.test(label, async () => {
      let calls = 0;
      await assert.rejects(async () => {
        const receipt = await runWithTransportRetries({
          delay: noDelay, run: async () => { calls += 1; return value; }
        });
        assert.equal(receipt.attempts.length, 1);
        consume(receipt);
      });
      assert.equal(calls, 1);
    });
  }
});

test('OpenAI background retrieval never recreates a response on polling failure', async (t) => {
  for (const pollFailure of [
    jsonResponse({ error: { message: 'server unavailable' } }, 503),
    jsonResponse({ error: { message: 'rate limit' } }, 429),
    new Error('fetch failed'), failure('request timed out')
  ]) {
    await t.test(String(pollFailure.status || pollFailure.message), async (t) => {
      const calls = stubFetch(t, [
        jsonResponse({ id: 'resp_existing', status: 'queued' }), pollFailure,
        jsonResponse({ status: 'cancelled' })
      ]);
      await assert.rejects(runWithTransportRetries({
        delay: noDelay,
        run: () => generateOpenAIStructuredContent({ ...options, background: true })
      }), (error) => {
        assert.equal(error.providerResponseId, 'resp_existing');
        assert.equal(error.providerAttempts.length, 1);
        assert.equal(error.providerAttempts[0].responseId, 'resp_existing');
        assert.equal(error.providerAttempts[0].retryReason, 'existing_response');
        return true;
      });
      assert.deepEqual(calls.map(({ method, url }) => [method, url]), [
        ['POST', 'https://api.openai.com/v1/responses'],
        ['GET', 'https://api.openai.com/v1/responses/resp_existing'],
        ['POST', 'https://api.openai.com/v1/responses/resp_existing/cancel']
      ]);
    });
  }
});

test('successful OpenAI polling retrieves one response and counts one generation attempt', async (t) => {
  const calls = stubFetch(t, [
    jsonResponse({ id: 'resp_existing', status: 'queued' }),
    jsonResponse({ id: 'resp_existing', status: 'in_progress' }),
    jsonResponse({ id: 'resp_existing', status: 'completed', output_text: '{}' })
  ]);
  const receipt = await runWithTransportRetries({
    delay: noDelay, run: () => generateOpenAIStructuredContent({ ...options, background: true })
  });
  assert.equal(receipt.value.text, '{}');
  assert.equal(receipt.attempts.length, 1);
  assert.deepEqual(calls.map(({ method }) => method), ['POST', 'GET', 'GET']);
  assert.ok(calls.slice(1).every(({ url }) => url.endsWith('/responses/resp_existing')));
});

test('primitive and frozen polling exceptions cannot prevent cancellation or recreate the response', async (t) => {
  for (const caught of [null, 'fetch failed', Object.freeze(failure('server unavailable', { status: 503 }))]) {
    await t.test(String(caught), async (t) => {
      const calls = [];
      t.mock.method(globalThis, 'fetch', async (url, init) => {
        calls.push({ url: String(url), method: init.method });
        if (String(url).endsWith('/cancel')) return jsonResponse({ status: 'cancelled' });
        if (init.method === 'GET') throw caught;
        return jsonResponse({ id: 'resp_existing', status: 'queued' });
      });
      await assert.rejects(runWithTransportRetries({
        delay: noDelay, run: () => generateOpenAIStructuredContent({ ...options, background: true })
      }), (error) => {
        assert.equal(error.cause, caught);
        assert.equal(error.providerResponseId, 'resp_existing');
        assert.equal(error.providerAttempts.length, 1);
        return true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(calls.map(({ method }) => method), ['POST', 'GET', 'POST']);
      assert.ok(calls.at(-1).url.endsWith('/responses/resp_existing/cancel'));
    });
  }
});

test('background cancellation bounds both fetch and response-body cleanup to five seconds', async (t) => {
  for (const phase of ['fetch', 'body']) {
    await t.test(phase, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const controller = new AbortController();
      const originalError = failure('original generation abort');
      controller.abort(originalError);
      let cancelSignal;
      let cancelCalls = 0;
      let markPending;
      const pendingStarted = new Promise((resolve) => { markPending = resolve; });
      let markStopped;
      const pendingStopped = new Promise((resolve) => { markStopped = resolve; });
      const hangUntilAborted = () => new Promise((_, reject) => {
        cancelSignal.addEventListener('abort', () => {
          markStopped();
          reject(cancelSignal.reason);
        }, { once: true });
        markPending();
      });
      t.mock.method(globalThis, 'fetch', async (url, init) => {
        if (!String(url).endsWith('/cancel')) {
          return jsonResponse({ id: 'resp_existing', status: 'queued' });
        }
        cancelCalls += 1;
        cancelSignal = init.signal;
        return phase === 'fetch' ? hangUntilAborted() : {
          ok: true, body: { cancel: hangUntilAborted }
        };
      });
      await assert.rejects(runWithTransportRetries({
        delay: noDelay,
        run: () => generateOpenAIStructuredContent({
          ...options, background: true, abortSignal: controller.signal
        })
      }), (error) => error === originalError);
      await pendingStarted;
      assert.notEqual(cancelSignal, controller.signal);
      assert.equal(cancelSignal.aborted, false);
      t.mock.timers.tick(4999);
      assert.equal(cancelSignal.aborted, false);
      t.mock.timers.tick(1);
      await pendingStopped;
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(cancelSignal.aborted, true);
      assert.equal(cancelCalls, 1);
      assert.equal(originalError.providerAttempts.length, 1);
    });
  }
});

test('cancellation discards response bodies and clears its timer without replacing the polling error', async (t) => {
  for (const outcome of ['success', 'HTTP failure', 'body cleanup failure']) {
    await t.test(outcome, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const controller = new AbortController();
      const originalError = failure('original polling failure');
      controller.abort(originalError);
      let cancelSignal;
      let discardedBodies = 0;
      t.mock.method(globalThis, 'fetch', async (url, init) => {
        if (!String(url).endsWith('/cancel')) {
          return jsonResponse({ id: 'resp_existing', status: 'queued' });
        }
        cancelSignal = init.signal;
        return {
          ok: outcome !== 'HTTP failure',
          body: { cancel: async () => {
            discardedBodies += 1;
            if (outcome === 'body cleanup failure') throw new Error('body cleanup failed');
          } }
        };
      });
      await assert.rejects(generateOpenAIStructuredContent({
        ...options, background: true, abortSignal: controller.signal
      }), (error) => error === originalError);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(discardedBodies, 1);
      t.mock.timers.tick(5000);
      assert.equal(cancelSignal.aborted, false, 'Completed cancellation must clear its timeout');
    });
  }
});

test('OpenAI completed failure and cancellation never trigger replacement generations', async (t) => {
  for (const status of ['failed', 'cancelled']) {
    await t.test(status, async (t) => {
      const calls = stubFetch(t, [jsonResponse({ id: 'resp_stopped', status })]);
      await assert.rejects(runWithTransportRetries({
        delay: noDelay, run: () => generateOpenAIStructuredContent(options)
      }), (error) => error.completedStopState && error.providerAttempts[0].retryReason === 'completed_stop');
      assert.equal(calls.length, 1);
    });
  }
});

test('received HTTP bodies and explicit HTTP errors keep their retry classification on read failure', async (t) => {
  for (const generate of [
    generateOpenAIStructuredContent, generateAnthropicStructuredContent,
    generateKimiStructuredContent, generateGrokStructuredContent
  ]) {
    for (const status of [200, 429]) {
      await t.test(`${generate.name} ${status}`, async (t) => {
        const error = failure('socket hang up', { code: 'ECONNRESET' });
        const calls = stubFetch(t, [new Response(new ReadableStream({
          start(controller) { controller.error(error); }
        }), { status })]);
        await assert.rejects(runWithTransportRetries({
          delay: noDelay, run: () => generate(options)
        }), (actual) => actual === error && actual.providerAttempts.length === 1);
        assert.equal(calls.length, 1);
        assert.equal(error.status, status);
      });
    }
  }
});

test('a frozen response-read exception preserves the received-answer guard', async (t) => {
  const caught = Object.freeze(failure('socket hang up', { code: 'ECONNRESET' }));
  const calls = stubFetch(t, [new Response(new ReadableStream({
    start(controller) { controller.error(caught); }
  }))]);
  await assert.rejects(runWithTransportRetries({
    delay: noDelay, run: () => generateOpenAIStructuredContent(options)
  }), (error) => {
    assert.equal(error.cause, caught);
    assert.equal(error.providerAttempts[0].retryReason, 'received_answer');
    assert.equal(error.providerAttempts[0].causeCode, 'ECONNRESET');
    return true;
  });
  assert.equal(calls.length, 1);
});

test('active provider builders use the shared prompt and ordinary text without changing request settings', () => {
  assert.deepEqual(buildOpenAIRequestBody({ ...options, background: true }), {
    model: options.model, instructions: options.systemInstruction, input: options.contents,
    reasoning: { effort: 'high' }, background: true, store: true, max_output_tokens: 1234
  });
  assert.deepEqual(buildOpenAIRequestBody(options), {
    model: options.model, instructions: options.systemInstruction, input: options.contents,
    reasoning: { effort: 'high' }, max_output_tokens: 1234
  });
  assert.deepEqual(buildGrokRequestBody(options), {
    model: options.model,
    input: [
      { role: 'system', content: options.systemInstruction },
      { role: 'user', content: options.contents }
    ],
    reasoning: { effort: 'high' }, max_output_tokens: 1234, store: false
  });
  assert.deepEqual(buildKimiRequestBody(options), {
    model: options.model,
    messages: [
      { role: 'system', content: options.systemInstruction },
      { role: 'user', content: options.contents }
    ],
    reasoning_effort: 'high', max_completion_tokens: 1234
  });
  assert.deepEqual(buildAnthropicRequestBody({ ...options, thinking: { type: 'adaptive' } }), {
    model: options.model, system: options.systemInstruction,
    messages: [{ role: 'user', content: options.contents }],
    thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, max_tokens: 1234
  });
});
