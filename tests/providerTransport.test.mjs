import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/raw/what-did-mia-see.xbar.json', import.meta.url)));
const rawOutput = JSON.stringify(fixture.payload);
const endpoints = new Set([
  'https://api.openai.com/v1/responses', 'https://api.anthropic.com/v1/messages',
  'https://api.moonshot.ai/v1/chat/completions', 'https://api.x.ai/v1/responses'
]);

test('native provider transport obeys Babel deadlines instead of unrelated headers/body timers', { timeout: 25000 }, async t => {
  const environment = { NODE_ENV: 'production', BABEL_SAVE_PROVIDER_RAW: '0', BABEL_PROVIDER_MODEL_TIMEOUT_MS: '1200',
    OPENAI_API_KEY: 'offline', ANTHROPIC_API_KEY: 'offline', MOONSHOT_API_KEY: 'offline', XAI_API_KEY: 'offline' };
  for (const [key, value] of Object.entries(environment)) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const { parseFromBody } = await import('../server/parseApi.js');
  const { GENERATION_MODEL_IDS } = await import('../server/babelParser/researchModelCatalog.js');
  const originalDispatcher = getGlobalDispatcher();
  const shortDispatcher = new Agent({ headersTimeout: 30, bodyTimeout: 30 });
  setGlobalDispatcher(shortDispatcher);
  t.after(async () => { setGlobalDispatcher(originalDispatcher); await shortDispatcher.close(); });
  let phase, stalls, calls = 0, payload;
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) { /* Consume the actual outgoing request body. */ }
    const timer = setTimeout(() => res.end(phase === 'body' ? payload.slice(1) : payload), stalls ? 2000 : 100);
    if (phase === 'body') { res.writeHead(200); res.write(payload.slice(0, 1)); }
    res.on('close', () => clearTimeout(timer));
  });
  t.after(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (endpoint, options) => {
    assert.ok(endpoints.has(String(endpoint)), 'unexpected external request blocked');
    calls++;
    const { model } = JSON.parse(options.body);
    payload = JSON.stringify(String(endpoint).includes('anthropic')
      ? { model, stop_reason: 'end_turn', content: [{ type: 'text', text: rawOutput }] }
      : String(endpoint).includes('moonshot')
        ? { model, choices: [{ finish_reason: 'stop', message: { content: rawOutput } }] }
        : { model, status: 'completed', output_text: rawOutput });
    return nativeFetch(url, options);
  });

  for (const modelId of GENERATION_MODEL_IDS) for (phase of ['headers', 'body']) {
    for (stalls of [false, true]) {
      const before = calls;
      const pending = parseFromBody({ sentence: fixture.sentence, framework: fixture.framework, modelId });
      if (stalls) {
        await assert.rejects(pending, error => {
          assert.equal(error.code, 'PROVIDER_TIMEOUT');
          assert.equal(error.details.providerAttempts.length, 1);
          return true;
        });
      } else {
        const bundle = await pending;
        assert.equal(Buffer.from(bundle.rawModelOutput.data, 'base64').toString(), rawOutput);
      }
      assert.equal(calls, before + 1, 'no replacement generation');
    }
  }
});
