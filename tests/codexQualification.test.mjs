import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Agent } from 'undici';

import { buildCodexQualificationRequest, CODEX_RESPONSES_URL,
  DEFAULT_CODEX_QUALIFICATION_MODEL, readCodexCredentials,
  requestCodexQualification } from '../contractQualification/codexOAuth.js';
import { writeQualificationAttempt } from '../contractQualification/artifacts.js';
import { runQualificationAttempt } from '../contractQualification/run.js';
import { buildSystemInstruction } from '../server/babelParser/systemInstruction.js';
import { buildParseContentsPrompt } from '../server/babelParser/prompts.js';
import { GENERATION_MODEL_IDS } from '../server/babelParser/researchModelCatalog.js';
import { createQualificationTelemetry, qualificationResponseHeaders } from '../contractQualification/telemetry.js';

const credentials = { token: 'dummy-secret-token', accountId: 'dummy-account' };
const request = (overrides = {}) => buildCodexQualificationRequest({
  sentence: '  Which book did John buy?\n', framework: 'minimalism',
  model: 'openai:gpt-6-sol', effort: 'high', ...overrides
});
const event = data => `data: ${JSON.stringify(data)}\n\n`;
const completed = text => ({ type: 'response.completed', response: {
  id: 'response-1', status: 'completed', model: 'gpt-6-sol',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 30, output_tokens: 40 }
} });
const streamFor = text => event({ type: 'response.output_text.delta', delta: text, output_index: 0, content_index: 0 })
  + event(completed(text));
const chunkedResponse = (bytes, { status = 200, failAfterBytes = false } = {}) => {
  let position = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (position === bytes.length) {
      if (failAfterBytes) controller.error(new Error('Disconnected'));
      else controller.close();
      return;
    }
    // Deliberately split multibyte characters and SSE separators across byte boundaries.
    const size = Math.min(position < 256 ? 1 : 503, bytes.length - position);
    controller.enqueue(bytes.subarray(position, position + size));
    position += size;
  } }), { status, headers: { 'content-type': 'text/event-stream', 'x-request-id': 'request-1' } });
};

test('subscription requests contain exactly Babel prompts, without agent instructions or history', () => {
  assert.equal(GENERATION_MODEL_IDS.includes('openai:gpt-6-sol'), true);
  assert.equal(GENERATION_MODEL_IDS.includes('openai:gpt-5.6-sol'), false);
  for (const framework of ['minimalism', 'xbar']) {
    for (const model of ['openai:gpt-6.1-sol', 'openai:gpt-6-sol', 'openai:gpt-6-astra']) {
      const { body } = request({ framework, model });
      assert.deepEqual(body, {
        model: model.slice('openai:'.length),
        instructions: buildSystemInstruction(framework, 'gpt'),
        input: [{ role: 'user', content: [{ type: 'input_text',
          text: buildParseContentsPrompt('  Which book did John buy?\n', framework, 'gpt') }] }],
        reasoning: { effort: 'high' }, store: false, stream: true
      });
    }
  }
  assert.throws(() => request({ model: 'xai:grok-4.6' }), /OpenAI/);
  assert.throws(() => request({ model: 'openai:gpt-5.6-sol' }), /GPT-6/);
  assert.throws(() => request({ effort: 'invented-effort' }), /must be one of/);
});

test('omitting the subscription model selects GPT-6.1 Sol and retains exact Babel prompts', () => {
  const explicit = request({ model: DEFAULT_CODEX_QUALIFICATION_MODEL });
  const implicit = request({ model: undefined, effort: undefined });
  assert.deepEqual(implicit, explicit);
  assert.equal(implicit.selection.catalogId, 'openai:gpt-6.1-sol');
  assert.equal(implicit.body.model, 'gpt-6.1-sol');
  assert.equal(GENERATION_MODEL_IDS.includes(implicit.selection.catalogId), false);
});

test('login loading accepts only an unexpired subscription token and leaves the credential file unchanged', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-auth-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const authPath = path.join(directory, 'auth.json');
  const auth = { auth_mode: 'chatgpt', tokens: {
    access_token: `header.${Buffer.from(JSON.stringify({ exp: 2000000000 })).toString('base64url')}.signature`,
    account_id: 'test-account', refresh_token: 'never-use-or-copy'
  } };
  const original = JSON.stringify(auth);
  fs.writeFileSync(authPath, original);
  assert.deepEqual(readCodexCredentials(authPath, 1900000000000), {
    token: auth.tokens.access_token, accountId: 'test-account'
  });
  assert.equal(fs.readFileSync(authPath, 'utf8'), original);
  assert.throws(() => readCodexCredentials(authPath, 2100000000000), /expired/);
  fs.writeFileSync(authPath, JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'never-use' }));
  assert.throws(() => readCodexCredentials(authPath), /API keys are never used/);
});

test('streaming preserves received bytes, exact Unicode output and completion usage', async () => {
  for (const newline of ['\n', '\r\n']) {
    const text = '{"statement":"élan → 完成"}';
    const bytes = Buffer.from(streamFor(text).replaceAll('\n', newline));
    const captured = [];
    const result = await requestCodexQualification({ body: request().body, credentials,
      onBytes: chunk => captured.push(chunk),
      fetchImpl: async (url, options) => {
        assert.equal(url, CODEX_RESPONSES_URL);
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, `Bearer ${credentials.token}`);
        assert.deepEqual(JSON.parse(options.body), request().body);
        return chunkedResponse(bytes);
      }
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.text, text);
    assert.deepEqual(result.response.usage, { input_tokens: 30, output_tokens: 40 });
    assert.deepEqual(Buffer.concat(captured), bytes);
    assert.ok(!JSON.stringify(result).includes(credentials.token));
    assert.ok(!JSON.stringify(result).includes(credentials.accountId));
  }
});

test('telemetry observes split UTF-8 streams without changing usage, output or event order', async () => {
  let clock = 0;
  const trace = createQualificationTelemetry({ now: () => clock++ });
  const text = '本 → élève';
  const terminal = completed(text);
  terminal.response.usage.output_tokens_details = { reasoning_tokens: 11, provider_detail: 3 };
  const data = [
    { type: 'response.output_item.added', item: { type: 'reasoning', encrypted_content: 'private-reasoning' } },
    { type: 'response.output_text.delta', delta: text, sequence_number: 4, output_index: 1 },
    terminal
  ];
  const bytes = Buffer.from(data.map(event).join(''));
  const result = await requestCodexQualification({ body: request().body, credentials,
    fetchImpl: async () => chunkedResponse(bytes),
    onHeaders: () => trace.headers(), onBytes: chunk => trace.bytes(chunk), onEvent: item => trace.event(item) });
  const measured = trace.snapshot();
  assert.equal(result.text, text);
  assert.deepEqual(result.response.usage, terminal.response.usage);
  assert.equal(measured.receivedBytes, bytes.length);
  assert.deepEqual(measured.events.map(e => e.type), data.map(e => e.type));
  assert.ok(measured.headersAtMs < measured.firstByteAtMs);
  assert.ok(measured.firstReasoningEventAtMs < measured.firstOutputTextAtMs);
  assert.ok(measured.firstOutputTextAtMs < measured.terminalAtMs);
  assert.equal(measured.events[1].textBytes, Buffer.byteLength(text));
  assert.equal(measured.events[1].sequenceNumber, 4);
  assert.ok(!JSON.stringify(measured).includes('private-reasoning'));
});

test('telemetry keeps absent phases unavailable on an interrupted stream', async () => {
  const trace = createQualificationTelemetry();
  const result = await requestCodexQualification({ body: request().body, credentials,
    fetchImpl: async () => chunkedResponse(Buffer.from(event({ type: 'response.created' }))),
    onBytes: chunk => trace.bytes(chunk), onEvent: item => trace.event(item) });
  assert.equal(result.status, 'interrupted');
  const measured = trace.snapshot();
  assert.equal(measured.firstOutputTextAtMs, null);
  assert.equal(measured.firstReasoningEventAtMs, null);
  assert.equal(measured.terminalAtMs, null);
  assert.equal(measured.eventCounts['response.created'], 1);
});

test('response telemetry retains technical limits but never unknown or account-linked header values', () => {
  const response = new Response('', { headers: {
    'content-type': 'text/event-stream', 'x-request-id': 'request-2',
    'x-oai-request-id': 'openai-request-2', 'cf-ray': 'edge-request-2',
    'x-ratelimit-remaining-tokens': '1000', 'x-codex-primary-used-percent': '14',
    'x-codex-credits-balance': '25', 'set-cookie': 'cookie-secret',
    'x-codex-plan-account-id': 'account-secret', 'x-unknown': 'unknown-secret'
  } });
  const measured = qualificationResponseHeaders(response);
  assert.equal(measured.headers['x-ratelimit-remaining-tokens'], '1000');
  assert.equal(measured.headers['x-codex-primary-used-percent'], '14');
  assert.equal(measured.headers['x-codex-credits-balance'], '25');
  assert.equal(measured.headers['x-oai-request-id'], 'openai-request-2');
  assert.equal(measured.headers['cf-ray'], 'edge-request-2');
  assert.equal(measured.requestId, 'request-2');
  assert.equal(qualificationResponseHeaders(new Response('', { headers: {
    'x-oai-request-id': 'openai-request-3'
  } })).requestId, 'openai-request-3');
  assert.deepEqual(measured.omittedHeaderNames, ['set-cookie', 'x-codex-plan-account-id', 'x-unknown']);
  assert.ok(!JSON.stringify(measured).includes('secret'));
});

test('partial, failed and inconsistent streams retain evidence without retrying or accepting completion', async () => {
  const delta = event({ type: 'response.output_text.delta', delta: 'partial' });
  const scenarios = [
    { bytes: delta, expected: 'interrupted' },
    { bytes: delta + 'data: [DONE]\n\n', expected: 'interrupted' },
    { bytes: delta, expected: 'interrupted', failAfterBytes: true },
    { bytes: delta + event({ type: 'response.incomplete', response: { status: 'incomplete' } }), expected: 'failed' },
    { bytes: delta + event({ type: 'response.failed', response: { status: 'failed' } }), expected: 'failed' },
    { bytes: delta + 'data: {oops}\n\n', expected: 'failed' },
    { bytes: delta + event(completed('different final output')), expected: 'failed' },
    { bytes: '{"error":"unauthorized"}', expected: 'failed', status: 401 }
  ];
  for (const scenario of scenarios) {
    const captured = [];
    let calls = 0;
    const bytes = Buffer.from(scenario.bytes);
    const result = await requestCodexQualification({ body: request().body, credentials,
      onBytes: chunk => captured.push(chunk), fetchImpl: async () => {
        calls += 1;
        return chunkedResponse(bytes, scenario);
      }
    });
    assert.equal(result.status, scenario.expected);
    assert.equal(calls, 1);
    assert.deepEqual(Buffer.concat(captured), bytes);
    if (!scenario.status) assert.equal(result.text, 'partial');
  }
});

test('an unterminated final terminal response is discarded at EOF, as SSE requires', async () => {
  const text = '{"statement":"x"}';
  for (const cut of ['\n', '\n\n']) {
    const bytes = Buffer.from(streamFor(text).slice(0, -cut.length));
    const leftover = event(completed(text)).slice(0, -cut.length);
    const captured = [], lifecycle = [];
    const result = await requestCodexQualification({ body: request().body, credentials,
      onBytes: chunk => captured.push(chunk), onLifecycle: entry => lifecycle.push(entry),
      fetchImpl: async () => chunkedResponse(bytes) });
    assert.equal(result.status, 'interrupted');
    assert.equal(result.failure.reason, 'eof_without_terminal');
    assert.equal(result.terminalEvent, null);
    assert.equal(lifecycle.find(entry => entry.type === 'stream-eof').bufferedBytes, Buffer.byteLength(leftover));
    assert.deepEqual(Buffer.concat(captured), bytes);
  }
});

test('Codex completion metadata can omit output when completed message events contain it', async () => {
  const text = '{"statement":"model-authored text"}';
  const terminal = completed(text);
  const item = { ...terminal.response.output[0], status: 'completed' };
  terminal.response.output = [];
  const bytes = Buffer.from(event({ type: 'response.output_text.delta', delta: text })
    + event({ type: 'response.output_item.done', output_index: 0, item }) + event(terminal));
  const result = await requestCodexQualification({ body: request().body, credentials,
    fetchImpl: async () => chunkedResponse(bytes) });
  assert.equal(result.status, 'completed');
  assert.equal(result.text, text);
  assert.deepEqual(result.response.output, []); // Preserve the actual terminal response.
});

test('completed subscription text uses the existing Babel normalization, Replay and review artifact pipeline', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-oauth-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/raw/mia-laughed.xbar.json', import.meta.url), 'utf8'));
  const text = JSON.stringify(fixture.payload);
  const { body, selection } = request({ sentence: fixture.sentence, framework: fixture.framework });
  const transport = await requestCodexQualification({ body, credentials,
    fetchImpl: async () => chunkedResponse(Buffer.from(streamFor(text))) });
  assert.equal(transport.status, 'completed');
  const attempt = { id: 'parse', request: { sentence: fixture.sentence, framework: fixture.framework },
    model: selection, source: { kind: 'raw-text-file', path: 'output.txt' } };
  const rawBytes = Buffer.from(transport.text);
  const expected = runQualificationAttempt({ attempt, rawOutputBytes: rawBytes });
  const { receipt, reviewEntry } = writeQualificationAttempt({ outputPath: directory, attempt, rawBytes });
  assert.equal(receipt.outcome.status, 'valid-pending-review');
  assert.equal(receipt.receiptSha256, expected.receipt.receiptSha256);
  assert.equal(reviewEntry.analyses.length, expected.replayProjections.length);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, reviewEntry.bundle))).response,
    JSON.parse(JSON.stringify(expected.bundle)));
  for (const analysis of reviewEntry.analyses) {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, analysis.replay))),
      JSON.parse(JSON.stringify(expected.replayProjections[analysis.analysisIndex])));
  }
});

test('interrupted runs identify transport, decoding and archive failures without logging secrets or retrying', async () => {
  const secret = credentials.token;
  const scenarios = [
    { phase: 'request', code: 'UND_ERR_CONNECT_TIMEOUT', fetchImpl: async () => {
      throw new TypeError(secret, { cause: Object.assign(new Error(secret), { code: 'UND_ERR_CONNECT_TIMEOUT' }) });
    } },
    { phase: 'read-stream', code: 'ECONNRESET', fetchImpl: async () => new Response(new ReadableStream({
      start(controller) { controller.error(Object.assign(new Error(secret), { code: 'ECONNRESET' })); }
    })) },
    { phase: 'archive-bytes', code: 'ENOSPC', onBytes: () => { throw Object.assign(new Error(secret), { code: 'ENOSPC' }); } },
    { phase: 'decode-stream', code: 'ERR_ENCODING_INVALID_ENCODED_DATA', bytes: Buffer.from([0xff]) }
  ];
  for (const scenario of scenarios) {
    let calls = 0;
    const result = await requestCodexQualification({ body: request().body, credentials,
      onBytes: scenario.onBytes, fetchImpl: async () => {
        calls++;
        return scenario.fetchImpl ? scenario.fetchImpl() : chunkedResponse(scenario.bytes ?? Buffer.from('data: {}\n\n'));
      }
    });
    assert.equal(result.status, 'interrupted');
    assert.equal(result.failure.phase, scenario.phase);
    assert.deepEqual(result.failure.codes, [scenario.code]);
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes(secret));
  }
});


test('empty output deltas do not establish visible text timing', () => {
  let now = 0;
  const trace = createQualificationTelemetry({ now: () => now });
  now = 100; trace.event({ type: 'response.output_text.delta', delta: '' });
  assert.equal(trace.snapshot().firstOutputTextAtMs, null);
  now = 250; trace.event({ type: 'response.output_text.delta', delta: 'A' });
  now = 400; trace.event({ type: 'response.output_text.delta', delta: '' });
  const measured = trace.snapshot();
  assert.equal(measured.firstOutputTextAtMs, 250);
  assert.equal(measured.lastOutputTextAtMs, 250);
  assert.equal(measured.eventCount, 3, 'all observed events remain in the trace');
});

test('socket diagnostics retain a wrapped peer-close cause without arbitrary messages, addresses or credentials', async () => {
  const secret = credentials.token;
  const socket = { bytesRead: 1200, bytesWritten: 500, timeout: 0,
    localAddress: secret, remoteAddress: secret, headers: { Authorization: secret } };
  const inner = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET', socket });
  const wrapped = new TypeError(secret, { cause: new Error(secret, { cause: inner }) });
  const trace = createQualificationTelemetry();
  trace.connection('disconnect', wrapped);
  let delivered = false;
  const result = await requestCodexQualification({ body: request().body, credentials,
    fetchImpl: async () => new Response(new ReadableStream({ pull(controller) {
      if (delivered) controller.error(wrapped);
      else { delivered = true; controller.enqueue(Buffer.from(event({ type: 'response.created',
        response: { id: 'resp_failed_stream', status: 'in_progress' } }))); }
    } }))
  });
  assert.equal(result.responseId, 'resp_failed_stream');
  assert.equal(result.response, null, 'creation metadata must not masquerade as completion');
  assert.equal(result.failure.reason, 'peer_closed');
  assert.deepEqual(result.failure.codes, ['UND_ERR_SOCKET']);
  assert.deepEqual(result.failure.socket, { bytesRead: 1200, bytesWritten: 500, timeout: 0 });
  assert.match(result.error, /remote peer closed/);
  assert.equal(trace.snapshot().connections[0].reason, 'peer_closed');
  assert.ok(!JSON.stringify({ result, telemetry: trace.snapshot() }).includes(secret));
});

test('real HTTP stream termination distinguishes peer close, client timeout and completed response', async t => {
  // A stream error discards data the client has received but not yet read, so
  // the peer closes only after the client has read the first event, and the
  // stalled body times out long after it has.
  let firstEventRead;
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(event({ type: 'response.created', response: { id: 'resp_local', status: 'in_progress' } }));
    if (req.url === '/peer-close') firstEventRead.then(() => res.socket.end()); // No final HTTP chunk or provider completion.
    else if (req.url === '/completed') res.end(streamFor('complete'));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [route, bodyTimeout, expected] of [
    ['/peer-close', 0, 'peer_closed'], ['/stalled', 1000, 'body_timeout'], ['/completed', 0, null]
  ]) {
    let read;
    firstEventRead = new Promise(resolve => { read = resolve; });
    const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout });
    const trace = createQualificationTelemetry();
    dispatcher.on('disconnect', (_origin, _targets, error) => trace.connection('disconnect', error));
    try {
      const result = await requestCodexQualification({ body: request().body, credentials, dispatcher,
        fetchImpl: (_url, options) => fetch(origin + route, options),
        onBytes: chunk => trace.bytes(chunk), onEvent: item => { trace.event(item); read(); }
      });
      assert.equal(result.responseId, route === '/completed' ? 'response-1' : 'resp_local');
      if (expected) {
        assert.equal(result.status, 'interrupted');
        assert.equal(result.failure.phase, 'read-stream');
        assert.equal(result.failure.cancelled, false);
        assert.equal(result.failure.reason, expected);
        assert.equal(trace.snapshot().connections[0].reason, expected);
        assert.equal(trace.snapshot().firstOutputTextAtMs, null);
      } else {
        assert.equal(result.status, 'completed');
        assert.equal(result.text, 'complete');
      }
    } finally { await dispatcher.close(); }
  }
});
