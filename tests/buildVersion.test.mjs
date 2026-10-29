import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildVersionPlugin, readBuildId, readWorktreeDigest } from '../scripts/buildVersionPlugin.mjs';

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
    { tag: 'meta', attrs: { name: 'babel-build', content: '1.2.3+abc123' }, injectTo: 'head' },
    { tag: 'meta', attrs: { name: 'babel-worktree', content: 'unknown' }, injectTo: 'head' }
  ]);
});

test('the worktree digest changes with each uncommitted change, not only the first', t => {
  const root = checkout(t);
  git(root, 'init', '--quiet');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Build test', '-c', 'user.email=build@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Build version baseline');
  assert.equal(readWorktreeDigest({ root }), 'clean');
  const digests = new Set();
  for (const version of ['1.2.4', '1.2.5']) {
    fs.writeFileSync(path.join(root, 'package.json'), `{"version":"${version}"}\n`);
    digests.add(readWorktreeDigest({ root }));
  }
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'new file\n');
  digests.add(readWorktreeDigest({ root }));
  assert.equal(digests.size, 3);
  for (const digest of digests) assert.match(digest, /^[0-9a-f]{64}$/);
});

test('staging a change leaves the worktree digest unchanged', t => {
  const root = checkout(t);
  git(root, 'init', '--quiet');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Build test', '-c', 'user.email=build@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Build version baseline');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.2.4"}\n');
  const modified = readWorktreeDigest({ root });
  git(root, 'add', 'package.json');
  assert.equal(readWorktreeDigest({ root }), modified, 'a staged modification');
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'new file\n');
  const added = readWorktreeDigest({ root });
  assert.notEqual(added, modified);
  git(root, 'add', 'untracked.txt');
  assert.equal(readWorktreeDigest({ root }), added, 'a staged new file');
  git(root, 'mv', 'package.json', 'renamed.json');
  const renamed = readWorktreeDigest({ root });
  git(root, 'reset', '--quiet');
  assert.equal(readWorktreeDigest({ root }), renamed, 'an unstaged rename');
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'edited file\n');
  assert.notEqual(readWorktreeDigest({ root }), renamed, 'an edit to an untracked file');
});
