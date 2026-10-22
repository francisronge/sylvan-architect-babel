import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildVersionPlugin, readBuildId } from '../scripts/buildVersionPlugin.mjs';

const checkout = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-build-version-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.2.3"}\n');
  return root;
};

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();

test('a deployed build is stamped with the platform commit', t => {
  const root = checkout(t);
  assert.equal(readBuildId({ root, env: { VERCEL_GIT_COMMIT_SHA: 'abc123' } }), '1.2.3+abc123');
  assert.equal(readBuildId({ root, env: {} }), '1.2.3+unknown');
});

test('a local build is stamped with HEAD and marks uncommitted changes', t => {
  const root = checkout(t);
  git(root, 'init', '--quiet');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Build test', '-c', 'user.email=build@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Build version baseline');
  const head = git(root, 'rev-parse', 'HEAD');
  assert.equal(readBuildId({ root, env: {} }), `1.2.3+${head}`);
  fs.writeFileSync(path.join(root, 'changed.txt'), 'local change\n');
  assert.equal(readBuildId({ root, env: {} }), `1.2.3+${head}.dirty`);
});

test('the build id reaches app code and the page head', t => {
  const plugin = buildVersionPlugin({ root: checkout(t), env: { VERCEL_GIT_COMMIT_SHA: 'abc123' } });
  assert.deepEqual(plugin.config(), { define: { __BABEL_BUILD__: '"1.2.3+abc123"' } });
  assert.deepEqual(plugin.transformIndexHtml(), [
    { tag: 'meta', attrs: { name: 'babel-build', content: '1.2.3+abc123' }, injectTo: 'head' }
  ]);
});
