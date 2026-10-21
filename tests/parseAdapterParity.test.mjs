import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { createDevParseMiddleware } from '../server/devParseMiddleware.js';

const LISTED_ORIGIN = 'https://babel.example';
const TOKEN = 'parity-test-token';

// The real Express server and the hosted function, each behind its own process
// with every outgoing provider call intercepted.
const startEntry = async (t, entry, env) => {
  const child = fork(new URL('./support/backgroundParseServer.mjs', import.meta.url), [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, NODE_ENV: 'production', PORT: '0', BABEL_TRUST_PROXY: '0',
      BABEL_TEST_SERVERLESS_ENTRY: entry === 'function' ? '1' : '0',
      BABEL_PARSE_RATE_LIMIT_PER_MINUTE: '500', BABEL_SAVE_PROVIDER_RAW: '0',
      BABEL_ALLOWED_ORIGINS: '', BABEL_PARSE_API_TOKEN: '', BABEL_ALLOW_NO_ORIGIN: '0', ...env }
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
  const [{ port }] = await Promise.race([
    once(child, 'message'),
    exited.then(() => { throw new Error(`${entry} exited before listening: ${output}`); })
  ]);
  return {
    port,
    stop: async () => {
      child.send({ type: 'stop' });
      const [code] = await exited;
      assert.equal(code, 0, output);
      assert.deepEqual(events.filter(event => event.type !== 'ready'), [], 'no provider call is made');
    }
  };
};

const startDevMiddleware = async (t, env) => {
  const middleware = createDevParseMiddleware({ env });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { port: server.address().port, stop: async () => {} };
};

const observe = async (port, { method = 'POST', headers = {}, body = '{}' } = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}/api/parse`, {
    method, headers, ...(method === 'POST' ? { body } : {})
  });
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    vary: response.headers.get('vary'),
    body: await response.json()
  };
};

const json = { 'content-type': 'application/json' };

const configurations = [{
  name: 'a configured allow-list is exclusive on every entry point',
  env: { BABEL_ALLOWED_ORIGINS: LISTED_ORIGIN, BABEL_REQUIRE_ORIGIN: '1', BABEL_PARSE_API_TOKEN: TOKEN },
  cases: port => [
    ['non-POST', { method: 'GET' }, 405, 'METHOD_NOT_ALLOWED'],
    ['missing token', { headers: { ...json, origin: LISTED_ORIGIN } }, 401, 'UNAUTHORIZED'],
    // The serving origin, as a forwarding proxy reports it, is not on the list.
    ['serving origin outside the list', { headers: { ...json, origin: `https://127.0.0.1:${port}`,
      'x-forwarded-proto': 'https', 'x-babel-api-token': TOKEN } }, 403, 'FORBIDDEN_ORIGIN'],
    ['missing Origin', { headers: { ...json, 'x-babel-api-token': TOKEN } }, 403, 'FORBIDDEN_ORIGIN'],
    ['non-JSON media type', { headers: { 'content-type': 'text/plain', origin: LISTED_ORIGIN,
      'x-babel-api-token': TOKEN } }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
    ['admitted request reaches validation', { headers: { ...json, origin: LISTED_ORIGIN,
      'x-babel-api-token': TOKEN } }, 400, 'INVALID_REQUEST']
  ]
}, {
  name: 'without an allow-list every entry point admits only the serving origin',
  env: { BABEL_REQUIRE_ORIGIN: '1' },
  cases: port => [
    ['serving origin', { headers: { ...json, origin: `http://127.0.0.1:${port}`, 'x-forwarded-proto': 'http' } },
      400, 'INVALID_REQUEST'],
    ['foreign origin', { headers: { ...json, origin: 'http://elsewhere.example', 'x-forwarded-proto': 'http' } },
      403, 'FORBIDDEN_ORIGIN']
  ]
}];

for (const configuration of configurations) {
  test(`HTTP adapters: ${configuration.name}`, { timeout: 30000 }, async t => {
    const entries = {
      express: await startEntry(t, 'express', configuration.env),
      function: await startEntry(t, 'function', configuration.env),
      vite: await startDevMiddleware(t, configuration.env)
    };
    const observed = {};
    for (const [entry, { port }] of Object.entries(entries)) {
      observed[entry] = [];
      for (const [label, request, status, code] of configuration.cases(port)) {
        const result = await observe(port, request);
        assert.equal(result.status, status, `${entry}: ${label}: ${JSON.stringify(result.body)}`);
        assert.equal(result.body.error.code, code, `${entry}: ${label}`);
        assert.equal(result.cacheControl, 'no-store', `${entry}: ${label}`);
        assert.equal(result.vary, 'Origin', `${entry}: ${label}`);
        // Only the development runtime adds its internal failure details.
        const { details: _details, ...error } = result.body.error;
        observed[entry].push({ label, status: result.status, error });
      }
    }
    assert.deepEqual(observed.function, observed.express);
    assert.deepEqual(observed.vite, observed.express);
    for (const entry of Object.values(entries)) await entry.stop();
  });
}

test('the hosted function answers a malformed body with the shared JSON rejection', async () => {
  process.env.BABEL_REQUIRE_ORIGIN = '0';
  process.env.BABEL_PARSE_API_TOKEN = '';
  const { default: handler } = await import('../api/parse.js');
  const headers = {};
  const res = {
    setHeader: (name, value) => { headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  // The platform's lazy body parser throws when the bytes are not JSON.
  const req = { method: 'POST', headers: { 'content-type': 'application/json' },
    get body() { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); } };
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: { code: 'INVALID_REQUEST', message: 'Malformed JSON request body.' } });
  assert.equal(headers['cache-control'], 'no-store');
});

test('the development middleware cancels generation when the page disconnects', { timeout: 10000 }, async t => {
  let calls = 0;
  let resolveCalled;
  let resolveAborted;
  const called = new Promise(resolve => { resolveCalled = resolve; });
  const aborted = new Promise(resolve => { resolveAborted = resolve; });
  const parse = async (body, { abortSignal }) => {
    calls += 1;
    if (body.sentence === 'complete') return { analyses: [], sentence: body.sentence };
    resolveCalled();
    return new Promise((_, reject) => abortSignal.addEventListener('abort', () => {
      resolveAborted(abortSignal.reason);
      reject(abortSignal.reason);
    }, { once: true }));
  };
  const middleware = createDevParseMiddleware({ env: {}, parse });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/api/parse`;

  const controller = new AbortController();
  const request = fetch(url, { method: 'POST', headers: json, signal: controller.signal,
    body: JSON.stringify({ sentence: 'pending' }) });
  const rejected = assert.rejects(request, { name: 'AbortError' });
  await called;
  controller.abort();
  await rejected;
  const reason = await aborted;
  assert.equal(reason.name, 'AbortError');
  assert.match(reason.message, /Client disconnected/);

  const response = await fetch(url, { method: 'POST', headers: json, body: JSON.stringify({ sentence: 'complete' }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { analyses: [], sentence: 'complete' });
  assert.equal(calls, 2);
});
