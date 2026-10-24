import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { HASHED_ASSET_CACHE_CONTROL, HASHED_ASSET_NAME } from '../server/staticAssets.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const vercel = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));

// Names the build emits into dist/assets, and the licence it copies there unhashed.
const hashed = ['index-B3x_9kQa.js', 'index-Cq8-Lm0Z.css', 'replay.worker-a1B2c3D4.js',
  'quicksand-latin-700-normal-Dk2_x-9Q.woff2'];
const unhashed = ['OFL-1.1.txt'];

// A copy of the server beside a dist/ of its own, so this checkout's build is untouched.
const checkout = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-asset-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const entry of ['server', 'replay', 'scripts', 'types.ts', 'package.json']) {
    fs.cpSync(path.join(repoRoot, entry), path.join(root, entry), { recursive: true });
  }
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(root, 'dist/assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<!doctype html><title>Babel</title>');
  for (const name of [...hashed, ...unhashed]) fs.writeFileSync(path.join(root, 'dist/assets', name), name);
  return root;
};

// Starts the production server on a free loopback port and resolves with its origin.
const start = (t, root) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root, stdio: 'pipe',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', NODE_ENV: 'production',
      BABEL_LISTEN_HOST: '127.0.0.1', BABEL_ALLOWED_ORIGINS: 'https://example.invalid' }
  });
  t.after(() => new Promise(done => {
    if (child.exitCode !== null) return done();
    child.once('exit', done);
    child.kill();
  }));
  let output = '';
  const onData = chunk => {
    output += chunk;
    const origin = /listening on (http:\/\/\S+)/.exec(output)?.[1];
    if (origin) resolve(origin);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.once('exit', code => reject(new Error(`server exited ${code}: ${output}`)));
});

test('npm start lets browsers keep hashed assets and revalidate everything else', async t => {
  const origin = await start(t, checkout(t));
  const cacheControl = async pathname => {
    const response = await fetch(`${origin}${pathname}`);
    assert.equal(response.status, 200, pathname);
    await response.arrayBuffer();
    return response.headers.get('cache-control');
  };
  for (const name of hashed) assert.equal(await cacheControl(`/assets/${name}`), HASHED_ASSET_CACHE_CONTROL, name);
  for (const pathname of [...unhashed.map(name => `/assets/${name}`), '/', '/index.html']) {
    assert.doesNotMatch(String(await cacheControl(pathname)), /immutable|max-age=[1-9]/, pathname);
  }
});

test('Vercel caches the same hashed asset names with the same header', () => {
  const rules = vercel.headers.filter(rule => rule.source.startsWith('/assets/'));
  assert.equal(rules.length, 1, 'one /assets/ header rule');
  const [rule] = rules;
  assert.deepEqual(rule.headers, [{ key: 'Cache-Control', value: HASHED_ASSET_CACHE_CONTROL }]);
  // The source's parenthesised group is a regular expression over the rest of the path.
  const matches = new RegExp(`^${rule.source}$`);
  for (const name of hashed) {
    assert.equal(matches.test(`/assets/${name}`), true, name);
    assert.equal(HASHED_ASSET_NAME.test(name), true, name);
  }
  for (const name of unhashed) {
    assert.equal(matches.test(`/assets/${name}`), false, name);
    assert.equal(HASHED_ASSET_NAME.test(name), false, name);
  }
});
