import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GENERATION_MODEL_IDS, getResearchModel } from '../server/babelParser/researchModelCatalog.js';

const endpoints = {
  openai: 'https://api.openai.com/v1/responses',
  anthropic: 'https://api.anthropic.com/v1/messages',
  moonshot: 'https://api.moonshot.ai/v1/chat/completions',
  xai: 'https://api.x.ai/v1/responses'
};
const fixture = JSON.parse(readFileSync(new URL('../fixtures/raw/what-did-mia-see.xbar.json', import.meta.url), 'utf8'));
const normalized = JSON.parse(readFileSync(new URL('../fixtures/normalized/what-did-mia-see.xbar.json', import.meta.url), 'utf8'));

for (const entry of ['express', 'function']) {
  test(`${entry}: disconnected public requests stop transport and leave subsequent requests usable`, { timeout: 45000 }, async t => {
    const child = fork(new URL('./support/backgroundParseServer.mjs', import.meta.url), [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, NODE_ENV: 'production', PORT: '0',
        OPENAI_API_KEY: 'test-only', ANTHROPIC_API_KEY: 'test-only', MOONSHOT_API_KEY: 'test-only', XAI_API_KEY: 'test-only',
        BABEL_TEST_SERVERLESS_ENTRY: entry === 'function' ? '1' : '0',
        OPENAI_BACKGROUND_POLL_INTERVAL_MS: '1000', BABEL_PROVIDER_MODEL_TIMEOUT_MS: '30000',
        BABEL_SAVE_PROVIDER_RAW: '0', BABEL_REQUIRE_ORIGIN: '0', BABEL_ALLOW_NO_ORIGIN: '1', BABEL_PARSE_API_TOKEN: '',
        BABEL_TRUST_PROXY: '0', BABEL_MAX_IN_FLIGHT_PARSES: '1', BABEL_PARSE_RATE_LIMIT_PER_MINUTE: '200' }
    });
    const exited = once(child, 'exit');
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const events = [];
    child.on('message', event => events.push(event));
    const message = (type, matches = () => true, timeout = 2000) => new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); child.off('message', receive); child.off('exit', exit); };
      const receive = event => { if (event.type === type && matches(event)) { cleanup(); resolve(event); } };
      const exit = () => { cleanup(); reject(new Error(`Server exited before ${type}: ${output}`)); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`No ${type} before ${timeout} ms: ${output}`)); }, timeout);
      child.on('message', receive);
      child.once('exit', exit);
    });
    const { port } = await message('ready', undefined, 10000);
    const url = `http://127.0.0.1:${port}/api/parse`;
    const configure = async replies => {
      const ready = message('configured'); child.send({ type: 'replies', replies }); await ready;
    };
    const request = (modelId = GENERATION_MODEL_IDS[0], signal) => fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal,
      body: JSON.stringify({ sentence: fixture.sentence, framework: fixture.framework, modelId })
    });
    const assertReleased = async () => {
      let body;
      for (let i = 0; i < 50; i++) {
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        body = await response.json();
        if (body.error.code !== 'SERVER_BUSY') break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(body.error.code, 'INVALID_REQUEST');
    };

    // Real HTTP request completion must not cancel a still-running response.
    // Interrupt every enabled model both before headers and while reading its body.
    for (const modelId of GENERATION_MODEL_IDS) for (const phase of ['waitForAbort', 'waitInBody']) {
      const endpoint = endpoints[getResearchModel(modelId).provider];
      await configure([{ url: endpoint, method: 'POST', [phase]: true }]);
      const called = message('provider-call');
      const controller = new AbortController();
      const rejected = assert.rejects(request(modelId, controller.signal), { name: 'AbortError' });
      await called;
      const aborted = message('provider-aborted');
      controller.abort();
      await rejected;
      await aborted;
      await assertReleased();
    }

    for (const phase of ['between-polls', 'waitForAbort', 'waitInBody']) {
      const endpoint = endpoints.openai;
      const id = `resp_${phase}`, poll = `${endpoint}/${id}`, cancel = `${poll}/cancel`;
      const replies = [{ url: endpoint, method: 'POST', body: { id, status: 'queued' } }];
      if (phase !== 'between-polls') replies.push({ url: poll, method: 'GET', [phase]: true });
      replies.push({ url: cancel, method: 'POST', status: 503, body: { error: 'Scripted cancellation failure' } });
      await configure(replies);
      const before = events.length;
      const called = message('provider-call', event => event.url === (phase === 'between-polls' ? endpoint : poll));
      const controller = new AbortController();
      const rejected = assert.rejects(request('openai:gpt-6-astra', controller.signal), { name: 'AbortError' });
      await called;
      const cancelled = message('provider-call', event => event.url === cancel);
      controller.abort();
      await rejected;
      await cancelled;
      await assertReleased();
      assert.deepEqual(events.slice(before).filter(event => event.type === 'provider-call').map(event => event.url), replies.map(reply => reply.url));
    }

    // A stuck best-effort remote cancellation is separately bounded. It must
    // neither keep the public slot nor interfere with the next successful parse.
    const id = 'resp_stuck_cancel', cancel = `${endpoints.openai}/${id}/cancel`;
    await configure([
      { url: endpoints.openai, method: 'POST', body: { id, status: 'queued' } },
      { url: cancel, method: 'POST', waitForAbort: true }
    ]);
    const called = message('provider-call');
    const controller = new AbortController();
    const rejected = assert.rejects(request('openai:gpt-6-astra', controller.signal), { name: 'AbortError' });
    await called;
    const cancelled = message('provider-call', event => event.url === cancel);
    const cancellationTimedOut = message('provider-aborted', event => event.url === cancel, 7000);
    controller.abort();
    await rejected;
    await cancelled;
    await assertReleased();
    const complete = { id: 'resp_success', status: 'completed', model: 'gpt-6-astra',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(fixture.payload) }] }] };
    await configure([{ url: endpoints.openai, method: 'POST', body: complete }]);
    const response = await request('openai:gpt-6-astra');
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(body.analyses[0].derivationStages, normalized.analyses[0].derivationStages);
    await cancellationTimedOut;
    assert.equal(events.filter(event => event.type === 'unexpected-provider-call').length, 0);
    assert.doesNotMatch(output, /test-only|uncaught|unhandled/i);
    child.send({ type: 'stop' });
    const [code, signal] = await exited;
    assert.equal(code, 0, output);
    assert.equal(signal, null);
  });
}
