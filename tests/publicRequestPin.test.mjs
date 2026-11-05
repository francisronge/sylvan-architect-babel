import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { PUBLIC_GENERATION } from '../publicApp/publicGeneration.ts';
import { PUBLIC_PARSE_REQUEST, parseFromBodyWithProviders, readPublicRequestOnly } from '../server/parseApi.js';

const endpoint = 'https://api.openai.com/v1/responses';
// What a visitor's script might send to spend more: another framework, a
// costlier model, the highest effort and the retired route fields.
const costlier = {
  sentence: 'Mia laughed.', framework: 'xbar', modelId: 'anthropic:claude-opus-5',
  settings: { effort: 'max' }, modelRoute: 'gpt', reasoningEffort: 'max'
};

const recording = () => {
  const sent = [];
  const record = kind => async (sentence, framework, modelId, { settings }) => {
    sent.push({ kind, sentence, framework, modelId, settings });
    return kind === 'start' ? { status: 'pending', ticket: 'T' } : { analyses: [] };
  };
  return { sent, providers: { research: record('parse'), start: record('start'), check: async ticket => { sent.push({ kind: 'check', ticket }); return { analyses: [] }; } } };
};

test('the browser and the server name the same public request', () => {
  assert.deepEqual({ ...PUBLIC_PARSE_REQUEST, settings: { ...PUBLIC_PARSE_REQUEST.settings } },
    { ...PUBLIC_GENERATION, settings: { ...PUBLIC_GENERATION.settings } });
});

test('a server that sends only the public request keeps nothing of the browser\'s choice but the sentence', async () => {
  const { sent, providers } = recording();
  const pinned = { publicRequestOnly: true };
  await parseFromBodyWithProviders({ ...costlier, start: true }, providers, pinned);
  await parseFromBodyWithProviders(costlier, providers, pinned);
  await parseFromBodyWithProviders({ ticket: 'T' }, providers, pinned);
  const publicRequest = { framework: 'minimalism', modelId: 'openai:gpt-6.1-sol', settings: { 'reasoning.effort': 'high' } };
  assert.deepEqual(sent, [
    { kind: 'start', sentence: 'Mia laughed.', ...publicRequest },
    { kind: 'parse', sentence: 'Mia laughed.', ...publicRequest },
    { kind: 'check', ticket: 'T' }
  ]);
  // The sentence is still checked, and a body that is no object is still refused.
  await assert.rejects(parseFromBodyWithProviders({ ...costlier, sentence: ' ' }, providers, pinned), { code: 'INVALID_REQUEST' });
  await assert.rejects(parseFromBodyWithProviders([], providers, pinned), { code: 'INVALID_REQUEST' });
  assert.equal(sent.length, 3);
});

test('without the pin the internal app\'s choice still reaches the provider', async () => {
  const { sent, providers } = recording();
  await parseFromBodyWithProviders({ sentence: 'Mia laughed.', framework: 'xbar', modelId: 'openai:gpt-6-astra', settings: { 'reasoning.effort': 'max' } }, providers);
  assert.deepEqual(sent, [{ kind: 'parse', sentence: 'Mia laughed.', framework: 'xbar', modelId: 'openai:gpt-6-astra', settings: { 'reasoning.effort': 'max' } }]);
});

test('deployed servers pin by default, local ones do not, and the setting overrides both', () => {
  assert.equal(readPublicRequestOnly({}, { deployed: true }), true);
  assert.equal(readPublicRequestOnly({}, { deployed: false }), false);
  assert.equal(readPublicRequestOnly({ BABEL_PUBLIC_REQUEST_ONLY: '0' }, { deployed: true }), false);
  assert.equal(readPublicRequestOnly({ BABEL_PUBLIC_REQUEST_ONLY: 'on' }, { deployed: false }), true);
  assert.equal(readPublicRequestOnly({ BABEL_PUBLIC_REQUEST_ONLY: 'maybe' }, { deployed: true }), true, 'an unreadable value keeps the default');
});

for (const entry of ['server/index.js', 'api/parse.js']) {
  test(`${entry} in production asks OpenAI for GPT-6.1 Sol at high effort, whatever the browser named`, { timeout: 30000 }, async t => {
    const child = fork(new URL('./support/backgroundParseServer.mjs', import.meta.url), [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env, NODE_ENV: 'production', PORT: '0', OPENAI_API_KEY: 'test-only-provider-key',
        ANTHROPIC_API_KEY: 'test-only', BABEL_SAVE_PROVIDER_RAW: '0', BABEL_REQUIRE_ORIGIN: '0', BABEL_ALLOW_NO_ORIGIN: '1',
        BABEL_PARSE_API_TOKEN: '', BABEL_TRUST_PROXY: '0', BABEL_ALLOWED_ORIGINS: '',
        BABEL_TEST_SERVERLESS_ENTRY: entry === 'api/parse.js' ? '1' : '0'
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
      const onMessage = result => { if (result.type === type) { child.off('message', onMessage); resolve(result); } };
      child.on('message', onMessage);
      child.once('exit', () => reject(new Error(`Server exited before ${type}: ${output}`)));
    });
    const { port } = await message('ready');
    const configured = message('configured');
    child.send({ type: 'replies', replies: [{ url: endpoint, method: 'POST', body: { id: 'resp_a', status: 'queued' } }] });
    await configured;

    const response = await fetch(`http://127.0.0.1:${port}/api/parse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...costlier, start: true })
    });
    const body = await response.json();
    assert.equal(response.status, 200, output);
    assert.equal(calls.length, 1, 'one call, to OpenAI');
    assert.equal(calls[0].url, endpoint);
    assert.equal(calls[0].request.model, 'gpt-6.1-sol');
    assert.equal(calls[0].request.reasoning.effort, 'high');
    const ticket = JSON.parse(Buffer.from(body.ticket.split('.')[0], 'base64url').toString('utf8'));
    assert.equal(ticket.framework, 'minimalism');
    assert.equal(ticket.modelId, 'openai:gpt-6.1-sol');
    assert.deepEqual(ticket.settings, { 'reasoning.effort': 'high' });
    child.send({ type: 'stop' });
  });
}
