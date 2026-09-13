import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildReplaySnapshotProjection } from '../replay/replaySnapshot.ts';
import { createTreeBankBundleSnapshot, loadTreeBankBundleSnapshot } from '../treeBankSnapshot.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/raw/what-did-mia-see.xbar.json', import.meta.url), 'utf8'));
const rawOutput = JSON.stringify(fixture.payload);
const endpoint = 'https://api.openai.com/v1/responses';
const decode = artifact => Buffer.from(artifact.data, 'base64').toString('utf8');

test('public HTTP parse route completes queued responses and preserves terminal failures without regenerating', { timeout: 30000 }, async t => {
  const child = fork(new URL('./support/backgroundParseServer.mjs', import.meta.url), [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env, NODE_ENV: 'production', PORT: '0', OPENAI_API_KEY: 'test-only-provider-key',
      OPENAI_BACKGROUND_POLL_INTERVAL_MS: '1000', BABEL_SAVE_PROVIDER_RAW: '0',
      BABEL_REQUIRE_ORIGIN: '0', BABEL_ALLOW_NO_ORIGIN: '1', BABEL_PARSE_API_TOKEN: '',
      BABEL_TRUST_PROXY: '0', BABEL_MAX_IN_FLIGHT_PARSES: '1'
    }
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const calls = [];
  child.on('message', message => { if (message.type === 'provider-call') calls.push(message); });
  const message = type => new Promise((resolve, reject) => {
    const cleanup = () => {
      child.off('message', onMessage);
      child.off('exit', onExit);
    };
    const onMessage = result => {
      if (result.type !== type) return;
      cleanup();
      resolve(result);
    };
    const onExit = () => { cleanup(); reject(new Error(`Server exited before ${type}: ${output}`)); };
    child.on('message', onMessage);
    child.once('exit', onExit);
  });
  const { port } = await message('ready');
  const completed = id => ({ id, status: 'completed', model: 'gpt-6-astra',
    output: [{ type: 'message', content: [{ type: 'output_text', text: rawOutput }] }],
    usage: { input_tokens: 11, output_tokens: 22, total_tokens: 33 } });

  for (const status of ['completed', 'failed', 'cancelled', 'incomplete', 'completed']) {
    const id = `resp_${calls.length}`;
    const terminal = status === 'completed' ? completed(id) : {
      id, status, model: 'gpt-6-astra', output: [],
      ...(status === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } }
        : { error: { message: `Scripted ${status}` } })
    };
    const replies = [
      { url: endpoint, method: 'POST', body: { id, status: 'queued' } },
      { url: `${endpoint}/${id}`, method: 'GET', body: { id, status: 'in_progress' } },
      { url: `${endpoint}/${id}`, method: 'GET', body: terminal }
    ];
    const configured = message('configured');
    child.send({ type: 'replies', replies });
    await configured;
    const before = calls.length;
    const response = await fetch(`http://127.0.0.1:${port}/api/parse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentence: fixture.sentence, framework: fixture.framework,
        modelId: 'openai:gpt-6-astra', settings: { 'reasoning.effort': 'high' } })
    });
    const body = await response.json();
    assert.deepEqual(calls.slice(before).map(call => [call.method, call.url]), replies.map(reply => [reply.method, reply.url]));
    assert.equal(calls[before].request.background, true);
    assert.equal(calls[before].request.store, true);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (status === 'completed') {
      assert.equal(response.status, 200, output);
      assert.equal(decode(body.rawModelOutput), rawOutput);
      assert.equal(decode(body.generationRecord.rawProviderResponse), JSON.stringify(terminal));
      const projection = buildReplaySnapshotProjection(body);
      assert.ok(projection.stepCount > 1);
      const restored = loadTreeBankBundleSnapshot(createTreeBankBundleSnapshot(body));
      assert.deepEqual(buildReplaySnapshotProjection(restored), projection);
      assert.deepEqual(restored.generationRecord, body.generationRecord);
    } else {
      assert.ok(response.status >= 400, `${status}: ${JSON.stringify(body)}`);
      assert.ok(body.error?.code);
      assert.equal(body.analyses, undefined);
      assert.ok(JSON.stringify(body).toLowerCase().includes(status));
    }
    assert.doesNotMatch(JSON.stringify(body), /test-only-provider-key/);
  }
  child.send({ type: 'stop' });
  const [code, signal] = await exited;
  assert.equal(code, 0, output);
  assert.equal(signal, null);
});
