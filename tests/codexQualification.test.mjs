import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildCodexQualificationRequest, CODEX_RESPONSES_URL,
  readCodexCredentials, requestCodexQualification } from '../contractQualification/codexOAuth.js';
import { writeQualificationAttempt } from '../contractQualification/artifacts.js';
import { runQualificationAttempt } from '../contractQualification/run.js';
import { buildSystemInstruction } from '../server/babelParser/systemInstruction.js';
import { buildParseContentsPrompt } from '../server/babelParser/prompts.js';

const credentials = { token: 'dummy-secret-token', accountId: 'dummy-account' };
const request = (overrides = {}) => buildCodexQualificationRequest({
  sentence: '  Which book did John buy?\n', framework: 'minimalism',
  model: 'openai:gpt-5.6-sol', effort: 'high', ...overrides
});
const event = data => `data: ${JSON.stringify(data)}\n\n`;
const completed = text => ({ type: 'response.completed', response: {
  id: 'response-1', status: 'completed', model: 'gpt-5.6-sol',
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
  for (const framework of ['minimalism', 'xbar']) {
    for (const model of ['openai:gpt-5.6-sol', 'openai:gpt-6-astra']) {
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
  assert.throws(() => request({ effort: 'invented-effort' }), /must be one of/);
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
