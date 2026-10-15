import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { channel } from 'node:diagnostics_channel';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createTransportDiagnostics } from '../contractQualification/transportDiagnostics.js';
import { createQualificationTelemetry } from '../contractQualification/telemetry.js';
import { requestCodexQualification, CODEX_RESPONSES_URL } from '../contractQualification/codexOAuth.js';

const directory = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-diagnostics-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const read = dir => fs.readFileSync(path.join(dir, 'transport-diagnostics.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);

test('live journal correlates request failure, excludes secrets and detaches observers', async t => {
  const dir = directory(t), trace = createQualificationTelemetry();
  const before = process.listenerCount('uncaughtExceptionMonitor');
  const diagnostic = createTransportDiagnostics({ directory: dir, endpoint: CODEX_RESPONSES_URL,
    client: { node: process.version, retries: 0 }, snapshot: () => trace.snapshot() });
  const secret = 'never-record-this-credential';
  const request = { origin: 'https://chatgpt.com', path: '/backend-api/codex/responses', headers: secret };
  channel('undici:request:create').publish({ request });
  channel('undici:request:bodySent').publish({ request });
  const error = new TypeError(secret, { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) });
  channel('undici:request:error').publish({ request, error });
  let delivered = false;
  const result = await requestCodexQualification({ body: {}, credentials: { token: secret, accountId: secret },
    fetchImpl: async () => new Response(new ReadableStream({ pull(c) {
      if (delivered) c.error(error);
      else { delivered = true; c.enqueue(Buffer.from('data: {"type":"response.created","response":{"id":"resp_diagnostic"}}\n\n')); }
    } })), onEvent: e => trace.event(e), onBytes: b => trace.bytes(b), onLifecycle: e => diagnostic.lifecycle(e) });
  const live = read(dir);
  assert(live.some(e => e.type === 'provider-response' && e.responseId === 'resp_diagnostic'));
  assert(live.some(e => e.type === 'request-error' && e.reason === 'peer_closed'));
  assert(live.some(e => e.type === 'transport-result' && e.failure.reason === 'peer_closed'));
  assert.equal(result.failure.reason, 'peer_closed');
  assert(!JSON.stringify(live).includes(secret));
  diagnostic.close();
  assert.equal(process.listenerCount('uncaughtExceptionMonitor'), before);
  const count = read(dir).length;
  channel('undici:request:error').publish({ request, error });
  assert.equal(read(dir).length, count);
});

test('clean premature EOF is classified separately from a socket error', async () => {
  const events = [];
  const result = await requestCodexQualification({ body: {}, credentials: { token: 'test', accountId: 'test' },
    fetchImpl: async () => new Response('data: {"type":"response.in_progress"}\n\n'),
    onLifecycle: e => events.push(e) });
  assert.equal(result.failure.reason, 'eof_without_terminal');
  assert(events.some(e => e.type === 'stream-eof'));
  assert.equal(result.status, 'interrupted');
});

test('journal distinguishes timeout, cancellation and malformed provider events', async t => {
  for (const kind of ['timeout', 'cancelled', 'malformed']) await t.test(kind, async t => {
    const dir = directory(t), trace = createQualificationTelemetry();
    const diagnostic = createTransportDiagnostics({ directory: dir, endpoint: CODEX_RESPONSES_URL,
      client: {}, snapshot: () => trace.snapshot() });
    try {
      const controller = new AbortController();
      if (kind === 'cancelled') controller.abort();
      const result = await requestCodexQualification({ body: {}, credentials: { token: 'test', accountId: 'test' },
        signal: controller.signal,
        fetchImpl: async () => {
          if (kind === 'cancelled') throw controller.signal.reason;
          if (kind === 'timeout') throw Object.assign(new Error('body timeout'), { code: 'UND_ERR_BODY_TIMEOUT' });
          return new Response('data: {broken-json}\n\n');
        }, onLifecycle: e => diagnostic.lifecycle(e) });
      const saved = read(dir).findLast(e => e.type === 'transport-result');
      assert.equal(saved.status, result.status);
      if (kind === 'cancelled') assert.equal(saved.failure.cancelled, true);
      else assert.equal(saved.failure.reason, kind === 'timeout' ? 'body_timeout' : 'invalid_event_json');
    } finally { diagnostic.close(); }
  });
});

test('a forcibly killed runner leaves a readable journal before any completion callback', async t => {
  const dir = directory(t);
  const moduleUrl = new URL('../contractQualification/transportDiagnostics.js', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { createTransportDiagnostics } from ${JSON.stringify(moduleUrl)};
    const d = createTransportDiagnostics({ directory: ${JSON.stringify(dir)}, endpoint: ${JSON.stringify(CODEX_RESPONSES_URL)},
      client: { node: process.version }, snapshot: () => ({ receivedBytes: 27, chunkCount: 1, eventCount: 1,
        lastByteAtMs: 10, events: [{ type: 'response.created' }] }) });
    d.lifecycle({ type: 'provider-response', responseId: 'resp_before_kill' });
    process.stdout.write('ready');
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const exited = once(child, 'exit');
  await once(child.stdout, 'data');
  assert(read(dir).some(e => e.responseId === 'resp_before_kill'));
  child.kill('SIGKILL');
  const [code, signal] = await exited;
  assert.equal(code, null);
  assert.equal(signal, 'SIGKILL');
  assert.equal(read(dir).at(-1).type, 'provider-response');
});
