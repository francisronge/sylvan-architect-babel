import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();

// A committed copy of the server and what it imports, so `dist/` can be built
// and broken without touching this checkout's own build.
const checkout = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-stale-dist-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const entry of ['server', 'replay', 'scripts', 'types.ts', 'package.json']) {
    fs.cpSync(path.join(repoRoot, entry), path.join(root, entry), { recursive: true });
  }
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\ndist\n');
  git(root, 'init', '--quiet');
  commit(root, 'Server baseline');
  return root;
};

const commit = (root, message) => {
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Stale dist test', '-c', 'user.email=dist@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', message);
};

const writeDist = (root, head = '') => {
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/index.html'), `<!doctype html><html><head>${head}</head><body>Babel</body></html>`);
};

// The tags the build writes, read from the stamp module the Vite build uses.
const currentStamp = async root => {
  const { buildStampTags } = await import(path.join(root, 'scripts/buildVersionPlugin.mjs'));
  return buildStampTags({ root, env: {} })
    .map(({ attrs }) => `<meta name="${attrs.name}" content="${attrs.content}">`).join('');
};

// Resolves when the server listens (then stops it) or exits on its own.
const start = (root, env = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', ...env }, stdio: 'pipe'
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => {
    stdout += chunk;
    if (stdout.includes('listening on')) child.kill();
  });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('exit', code => resolve({ listened: stdout.includes('listening on'), code, stderr }));
});

test('npm start refuses a dist/ without a build stamp and says how to rebuild', async t => {
  const root = checkout(t);
  writeDist(root);
  const result = await start(root);
  assert.equal(result.listened, false, 'an unstamped build must not be served');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no build stamp/);
  assert.match(result.stderr, /npm run build/);
});

test('npm start serves a dist/ built from this checkout and refuses it once the checkout moves on', async t => {
  const root = checkout(t);
  writeDist(root, await currentStamp(root));
  assert.equal((await start(root)).listened, true);

  const edit = line => fs.appendFileSync(path.join(root, 'server/securityHeaders.js'), `// ${line}\n`);
  edit('first local edit');
  const edited = await start(root);
  assert.equal(edited.listened, false, 'an uncommitted source change makes the build stale');
  assert.match(edited.stderr, /npm run build/);

  writeDist(root, await currentStamp(root));
  assert.equal((await start(root)).listened, true, 'a build of the edited checkout is current');
  edit('second local edit');
  assert.equal((await start(root)).listened, false, 'a further edit after that build makes it stale again');
  writeDist(root, await currentStamp(root));
  fs.writeFileSync(path.join(root, 'server/newModule.js'), 'export const added = true;\n');
  assert.equal((await start(root)).listened, false, 'a new untracked file makes the build stale');

  commit(root, 'Later work');
  const later = await start(root);
  assert.equal(later.listened, false, 'a build from an earlier commit is stale');
  assert.match(later.stderr, /was built from .* this checkout is /s);

  writeDist(root, await currentStamp(root));
  assert.equal((await start(root)).listened, true, 'rebuilding restores the server');
});

test('npm start without dist/ still serves the API, and production hosting is not checked against git', async t => {
  const root = checkout(t);
  assert.equal((await start(root)).listened, true);
  writeDist(root);
  const production = await start(root, { NODE_ENV: 'production', BABEL_ALLOWED_ORIGINS: 'https://example.invalid' });
  assert.equal(production.listened, true, production.stderr);
});
