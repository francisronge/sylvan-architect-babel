import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { generateOpenAIStructuredContent } from '../server/babelParser/modelRuntime.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const originalNodeEnv = process.env.NODE_ENV;

before(() => {
  process.env.NODE_ENV = 'production';
});

after(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

const jsonResponse = (payload, { status = 200 } = {}) =>
  new Response(JSON.stringify(payload), { status });

const generateBackgroundResponse = ({ abortSignal } = {}) => generateOpenAIStructuredContent({
  apiKey: 'test-key',
  model: 'test-model',
  contents: 'test input',
  systemInstruction: 'test instructions',
  background: true,
  pollIntervalMs: 1000,
  abortSignal
});

test('cancels a created OpenAI background response when polling is aborted', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const abortReason = new Error('test polling abort');
  const calls = [];
  let markCreated;
  const created = new Promise((resolve) => {
    markCreated = resolve;
  });

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), ...options });
    if (String(url) === OPENAI_RESPONSES_URL) {
      markCreated();
      return jsonResponse({ id: 'resp_abort', status: 'queued' });
    }
    if (String(url).endsWith('/responses/resp_abort/cancel')) {
      return jsonResponse({ id: 'resp_abort', status: 'cancelled' });
    }
    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const generation = generateBackgroundResponse({ abortSignal: controller.signal });
    await created;
    controller.abort(abortReason);
    await assert.rejects(generation, (error) => error === abortReason);
    await new Promise((resolve) => setImmediate(resolve));

    const cancelCalls = calls.filter(({ url, method }) => (
      method === 'POST' && url.endsWith('/responses/resp_abort/cancel')
    ));
    assert.equal(cancelCalls.length, 1);
    assert.equal(cancelCalls[0].headers.Authorization, 'Bearer test-key');
    assert.equal(cancelCalls[0].headers['Content-Type'], 'application/json');
    assert.ok(cancelCalls[0].signal instanceof AbortSignal);
    assert.notEqual(cancelCalls[0].signal, controller.signal);
    assert.equal(cancelCalls[0].signal.aborted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not cancel a successfully completed OpenAI background response', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method });
    return jsonResponse({
      id: 'resp_complete',
      status: 'completed',
      output_text: '{}',
      usage: {}
    });
  };

  try {
    const result = await generateBackgroundResponse();
    assert.equal(result.text, '{}');
    assert.equal(calls.some(({ url }) => url.endsWith('/cancel')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('preserves the polling error when best-effort cancellation fails', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const abortReason = new Error('original polling failure');
  let cancelCalls = 0;
  let markCreated;
  const created = new Promise((resolve) => {
    markCreated = resolve;
  });

  globalThis.fetch = async (url) => {
    if (String(url) === OPENAI_RESPONSES_URL) {
      markCreated();
      return jsonResponse({ id: 'resp_cancel_failure', status: 'in_progress' });
    }
    if (String(url).endsWith('/responses/resp_cancel_failure/cancel')) {
      cancelCalls += 1;
      throw new Error('cancel transport failed');
    }
    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const generation = generateBackgroundResponse({ abortSignal: controller.signal });
    await created;
    controller.abort(abortReason);
    await assert.rejects(generation, (error) => error === abortReason);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cancelCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
