import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createDevParseMiddleware } from '../server/devParseMiddleware.js';
import { createReviewFileHandler } from '../scripts/reviewFileServer.mjs';

// A page that rebinds its own DNS name to 127.0.0.1 is same-origin with the
// local runtime: the browser sends its name as Host and its origin as Origin.
const REBOUND = 'rebind.attacker.example';
const serverEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/index.js');

const send = (port, { method = 'POST', pathname = '/api/parse', host, origin, body = '{}' }) =>
  new Promise((resolve, reject) => {
    const headers = { host: host ?? `127.0.0.1:${port}`, 'content-type': 'application/json' };
    if (origin) headers.origin = origin;
    const request = http.request({ host: '127.0.0.1', port, method, path: pathname, headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: response.statusCode, code: json?.error?.code, text });
      });
    });
    request.once('error', reject);
    request.end(method === 'POST' ? body : undefined);
  });

const listen = async (t, handler) => {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return server.address().port;
};

const startExpress = async (t, env) => {
  const child = spawn(process.execPath, [serverEntry], {
    env: { PATH: process.env.PATH, PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  });
  let output = '';
  const port = await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      output += chunk;
      const match = output.match(/listening on http:\/\/\S+:(\d+)/);
      if (match) resolve(Number(match[1]));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    exited.then(([code]) => reject(new Error(`server exited ${code}: ${output}`)));
  });
  return port;
};

// An admitted empty body reaches request validation; no provider is called.
const ADMITTED = { status: 400, code: 'INVALID_REQUEST' };
const pick = ({ status, code }) => ({ status, code });

test('a local npm start answers only loopback, address and listed host names', async t => {
  const port = await startExpress(t, { BABEL_DEV_ALLOWED_HOSTS: '.tunnel.example' });
  const rebound = `${REBOUND}:${port}`;
  assert.deepEqual(pick(await send(port, { host: rebound, origin: `http://${rebound}` })),
    { status: 403, code: 'FORBIDDEN_HOST' });
  assert.deepEqual(pick(await send(port, { method: 'GET', pathname: '/healthz', host: rebound })),
    { status: 403, code: 'FORBIDDEN_HOST' });
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `192.168.1.20:${port}`,
    'mac.tunnel.example']) {
    assert.deepEqual(pick(await send(port, { host, origin: `http://${host}` })), ADMITTED, host);
  }
  assert.deepEqual(pick(await send(port, {})), ADMITTED, 'a caller without Origin');
  assert.deepEqual(pick(await send(port, { origin: `http://${rebound}` })),
    { status: 403, code: 'FORBIDDEN_ORIGIN' });
});

test('a production npm start keeps its same-origin policy without a host list', async t => {
  const port = await startExpress(t, { NODE_ENV: 'production', BABEL_LISTEN_HOST: '127.0.0.1' });
  const host = `babel.example:${port}`;
  assert.deepEqual(pick(await send(port, { host, origin: `http://${host}` })), ADMITTED);
  assert.deepEqual(pick(await send(port, { host })), { status: 403, code: 'FORBIDDEN_ORIGIN' });
});

test('the Vite parse middleware answers only the hosts Vite serves', async t => {
  let calls = 0;
  const parse = async () => { calls += 1; return { analyses: [] }; };
  const middleware = createDevParseMiddleware({ env: { BABEL_DEV_ALLOWED_HOSTS: '.tunnel.example' }, parse });
  const port = await listen(t, (req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  const rebound = `${REBOUND}:5177`;
  assert.deepEqual(pick(await send(port, { host: rebound, origin: `http://${rebound}` })),
    { status: 403, code: 'FORBIDDEN_HOST' });
  assert.deepEqual(pick(await send(port, { host: `127.0.0.1:${port}`, origin: `http://${rebound}` })),
    { status: 403, code: 'FORBIDDEN_ORIGIN' });
  assert.equal(calls, 0);
  for (const host of ['127.0.0.1:5177', 'localhost:5177', '[::1]:5177', 'app.localhost:5177',
    '10.0.0.7:5177', 'mac.tunnel.example']) {
    assert.equal((await send(port, { host, origin: `http://${host}` })).status, 200, host);
  }
  // A TLS tunnel reports the browser's https origin for a plain-HTTP local hop.
  assert.equal((await send(port, { host: 'mac.tunnel.example', origin: 'https://mac.tunnel.example' })).status, 200);
  assert.equal((await send(port, { host: '127.0.0.1:5177' })).status, 200, 'a caller without Origin');
  assert.equal(calls, 8);
});

test('a listed origin is still admitted only on an admitted host', async t => {
  const middleware = createDevParseMiddleware({ env: { BABEL_ALLOWED_ORIGINS: 'https://babel.example' },
    parse: async () => ({ analyses: [] }) });
  const port = await listen(t, (req, res) => middleware(req, res, () => {}));
  assert.equal((await send(port, { host: '127.0.0.1:5177', origin: 'https://babel.example' })).status, 200);
  assert.deepEqual(pick(await send(port, { host: `${REBOUND}:5177`, origin: 'https://babel.example' })),
    { status: 403, code: 'FORBIDDEN_HOST' });
  assert.deepEqual(pick(await send(port, { host: '127.0.0.1:5177', origin: 'http://127.0.0.1:5177' })),
    { status: 403, code: 'FORBIDDEN_ORIGIN' });
});

test('the review file server refuses dotfiles and other hosts', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'babel-review-files-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, '.env'), 'OPENAI_API_KEY=secret\n');
  fs.writeFileSync(path.join(root, '.git/config'), '[core]\n');
  fs.writeFileSync(path.join(root, 'docs/review.html'), '<!doctype html>');
  const port = await listen(t, createReviewFileHandler({ root }));
  const get = (pathname, host) => send(port, { method: 'GET', pathname, host });

  assert.equal((await get('/docs/review.html')).status, 200);
  assert.equal((await get('/docs/review.html', `localhost:${port}`)).status, 200);
  assert.equal((await get('/docs/review.html', `${REBOUND}:${port}`)).status, 403);
  for (const pathname of ['/.env', '/.git/config', '/docs/%2e%2e/.env', '/docs/..%2f.env']) {
    const response = await get(pathname);
    assert.equal(response.status, 404, pathname);
    assert.doesNotMatch(response.text, /secret|core/, pathname);
  }
});
