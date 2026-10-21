import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildAnthropicQualificationRequest, readAnthropicApiKey, requestAnthropicQualification,
  ANTHROPIC_MESSAGES_URL, DEFAULT_ANTHROPIC_KEYCHAIN_SERVICE } from '../contractQualification/anthropicApi.js';
import { writeQualificationAttempt } from '../contractQualification/artifacts.js';
import { runQualificationAttempt } from '../contractQualification/run.js';
import { estimateApiTokenCost } from '../contractQualification/apiCost.js';
import { createQualificationTelemetry, qualificationResponseHeaders } from '../contractQualification/telemetry.js';
import { buildAnthropicRequestBody } from '../server/babelParser/modelRuntime.js';
import { buildSystemInstruction } from '../server/babelParser/systemInstruction.js';
import { buildParseContentsPrompt } from '../server/babelParser/prompts.js';
import { GENERATION_MODEL_IDS } from '../server/babelParser/researchModelCatalog.js';

const apiKey = 'sk-ant-api03-dummy-secret-key';
const request = (overrides = {}) => buildAnthropicQualificationRequest({
  sentence: '  Which book did John buy?\n', framework: 'minimalism', ...overrides
});
const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const messageStart = sse('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant',
  model: 'claude-opus-5-5', content: [], stop_reason: null,
  usage: { input_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } } });
const thinkingBlock = sse('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } })
  + sse('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'opaque' } })
  + sse('content_block_stop', { index: 0 });
const textBlock = (text, index = 1) => sse('content_block_start', { index, content_block: { type: 'text', text: '' } })
  + [...text].map(character => sse('content_block_delta', { index, delta: { type: 'text_delta', text: character } })).join('')
  + sse('content_block_stop', { index });
const finish = (stopReason = 'end_turn', extra = {}) => sse('message_delta', {
  delta: { stop_reason: stopReason, ...extra }, usage: { output_tokens: 4000 } }) + sse('message_stop', {});
const streamFor = text => messageStart + thinkingBlock + sse('ping', {}) + textBlock(text) + finish();
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
  } }), { status, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_1',
    'anthropic-organization-id': 'org-secret' } });
};

test('qualification requests are Babel\'s Anthropic route body with only streaming added', () => {
  for (const framework of ['minimalism', 'xbar']) {
    const { body, selection } = request({ framework });
    assert.equal(selection.catalogId, 'anthropic:claude-opus-5-5');
    assert.deepEqual(body, {
      ...buildAnthropicRequestBody({ model: 'claude-opus-5-5',
        contents: buildParseContentsPrompt('  Which book did John buy?\n', framework, 'claude'),
        systemInstruction: buildSystemInstruction(framework, 'claude'),
        maxOutputTokens: 128000, effort: 'high', thinking: { type: 'adaptive', display: 'omitted' } }),
      stream: true
    });
    for (const absent of ['fallbacks', 'temperature', 'top_p', 'tools', 'tool_choice']) assert.equal(absent in body, false);
  }
  assert.equal(GENERATION_MODEL_IDS.includes('anthropic:claude-opus-5-5'), false);
  assert.equal(request({ model: 'anthropic:claude-opus-5', effort: 'max' }).body.output_config.effort, 'max');
  assert.throws(() => request({ model: 'openai:gpt-6-sol' }), /Anthropic model/);
  assert.throws(() => request({ effort: 'invented-effort' }), /must be one of/);
  assert.throws(() => request({ framework: 'lfg' }), /xbar or minimalism/);
});

test('the API key is read only from the named Keychain item and never appears in errors', () => {
  const calls = [];
  const run = (file, args) => { calls.push([file, args]); return `${apiKey}\n`; };
  assert.equal(readAnthropicApiKey({ account: 'reader', run }), apiKey);
  assert.deepEqual(calls, [['/usr/bin/security',
    ['find-generic-password', '-a', 'reader', '-s', DEFAULT_ANTHROPIC_KEYCHAIN_SERVICE, '-w']]]);
  assert.throws(() => readAnthropicApiKey({ run: () => { throw new Error(apiKey); } }),
    error => /security add-generic-password/.test(error.message) && !error.message.includes(apiKey));
  assert.throws(() => readAnthropicApiKey({ run: () => 'not-a-key' }), /not an Anthropic API key/);
});

test('streaming preserves received bytes, exact Unicode text blocks and merged usage', async () => {
  for (const newline of ['\n', '\r\n']) {
    const text = '{"statement":"élan → 完成"}';
    const bytes = Buffer.from(streamFor(text).replaceAll('\n', newline));
    const captured = [];
    const result = await requestAnthropicQualification({ body: request().body, apiKey,
      onBytes: chunk => captured.push(chunk),
      fetchImpl: async (url, options) => {
        assert.equal(url, ANTHROPIC_MESSAGES_URL);
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers['x-api-key'], apiKey);
        assert.equal(options.headers['anthropic-version'], '2023-06-01');
        assert.deepEqual(JSON.parse(options.body), request().body);
        return chunkedResponse(bytes);
      }
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.text, text);
    assert.equal(result.responseId, 'msg_1');
    assert.deepEqual(result.response, { id: 'msg_1', model: 'claude-opus-5-5', stop_reason: 'end_turn',
      usage: { input_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 4000 } });
    assert.deepEqual(Buffer.concat(captured), bytes);
    assert.ok(!JSON.stringify(result).includes(apiKey));
  }
});

test('incomplete, refused and failed streams retain evidence without retrying or accepting completion', async () => {
  const partial = messageStart + textBlock('partial', 0);
  const scenarios = [
    { bytes: partial, expected: 'interrupted', reason: 'eof_without_terminal' },
    { bytes: partial, expected: 'interrupted', failAfterBytes: true },
    { bytes: partial + finish('max_tokens'), expected: 'failed', reason: 'max_tokens' },
    { bytes: partial + finish('refusal', { stop_details: { type: 'refusal', category: 'bio' } }), expected: 'failed', reason: 'refusal' },
    { bytes: partial + finish('pause_turn'), expected: 'failed', reason: 'unexpected_stop_reason' },
    { bytes: partial + sse('error', { error: { type: 'overloaded_error', message: 'Overloaded' } }), expected: 'failed', reason: 'provider_error' },
    { bytes: partial + 'event: message_delta\ndata: {oops}\n\n', expected: 'failed', reason: 'invalid_event' },
    { bytes: messageStart + textBlock('', 0) + finish(), expected: 'failed', reason: 'missing_assistant_text' },
    { bytes: '{"type":"error","error":{"type":"authentication_error"}}', expected: 'failed', reason: 'http_error', status: 401 }
  ];
  for (const scenario of scenarios) {
    const captured = [];
    let calls = 0;
    const bytes = Buffer.from(scenario.bytes);
    const result = await requestAnthropicQualification({ body: request().body, apiKey,
      onBytes: chunk => captured.push(chunk), fetchImpl: async () => {
        calls += 1;
        return chunkedResponse(bytes, scenario);
      }
    });
    assert.equal(result.status, scenario.expected, scenario.reason);
    if (scenario.reason) assert.equal(result.failure.reason, scenario.reason);
    assert.equal(calls, 1);
    assert.deepEqual(Buffer.concat(captured), bytes);
    if (!scenario.status && scenario.reason !== 'missing_assistant_text') assert.equal(result.text, 'partial');
  }
});

test('an unterminated final message_stop is discarded at EOF, as SSE requires', async () => {
  const complete = streamFor('{"statement":"x"}');
  for (const cut of ['\n', '\n\n']) {
    const bytes = Buffer.from(complete.slice(0, -cut.length));
    const leftover = sse('message_stop', {}).slice(0, -cut.length);
    const captured = [], lifecycle = [];
    const result = await requestAnthropicQualification({ body: request().body, apiKey,
      onBytes: chunk => captured.push(chunk), onLifecycle: entry => lifecycle.push(entry),
      fetchImpl: async () => chunkedResponse(bytes) });
    assert.equal(result.status, 'interrupted');
    assert.equal(result.failure.reason, 'eof_without_terminal');
    assert.equal(result.terminalEvent, null);
    assert.equal(lifecycle.find(entry => entry.type === 'stream-eof').bufferedBytes, Buffer.byteLength(leftover));
    assert.deepEqual(Buffer.concat(captured), bytes);
  }
});

test('completed API text uses the existing Babel normalization, Replay and review artifact pipeline', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-anthropic-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/raw/mia-laughed.xbar.json', import.meta.url), 'utf8'));
  const text = JSON.stringify(fixture.payload);
  const { body, selection } = request({ sentence: fixture.sentence, framework: fixture.framework });
  const transport = await requestAnthropicQualification({ body, apiKey,
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
});

test('telemetry times Anthropic thinking, visible text and message_stop', () => {
  let clock = 0;
  const telemetry = createQualificationTelemetry({ now: () => clock });
  const events = streamFor('ok').split('\n\n').filter(Boolean)
    .map(block => JSON.parse(block.split('\n').find(line => line.startsWith('data:')).slice(5)));
  for (const event of events) { clock += 10; telemetry.event(event); }
  const snapshot = telemetry.snapshot();
  const at = predicate => (events.findIndex(predicate) + 1) * 10;
  assert.equal(snapshot.firstReasoningEventAtMs, at(e => e.content_block?.type === 'thinking'));
  assert.equal(snapshot.firstOutputTextAtMs, at(e => e.delta?.type === 'text_delta'));
  assert.equal(snapshot.terminalAtMs, at(e => e.type === 'message_stop'));
});

test('Opus 5.5 usage is priced at its own dated rate and response headers drop account identifiers', () => {
  const cost = estimateApiTokenCost('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000,
    cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  assert.equal(cost.estimatedUsd, 24);
  assert.equal(cost.pricingAsOf, '2026-10-17');
  assert.equal('asOf' in cost.ratesPerMillion, false);
  assert.equal(estimateApiTokenCost('claude-opus-5', { input_tokens: 0, output_tokens: 0,
    cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }).pricingAsOf, '2026-10-11');
  const headers = qualificationResponseHeaders(chunkedResponse(Buffer.from('')));
  assert.equal(headers.requestId, 'req_1');
  assert.equal(JSON.stringify(headers.headers).includes('org-secret'), false);
  assert.ok(headers.omittedHeaderNames.includes('anthropic-organization-id'));
});
