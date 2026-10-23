import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// Sentences, requests and raw model output are private local data; group and
// other users must not be able to list or read them.
const repoRoot = path.resolve(import.meta.dirname, '..');
const modeOf = file => fs.statSync(file).mode & 0o777;
const directory = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-private-modes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};
const assertPrivateTree = (root, top = root) => {
  assert.equal(modeOf(root), 0o700, `${path.relative(top, root) || 'root'} is owner-only`);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) assertPrivateTree(absolute, top);
    else assert.equal(modeOf(absolute), 0o600, `${path.relative(top, absolute)} is owner-only`);
  }
};
// Children inherit the usual developer umask, which leaves default modes group- and world-readable.
process.umask(0o022);
const node = (args, cwd) => execFileSync(process.execPath, args, {
  cwd, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'development' }
});

test('debug model payloads are written owner-only', t => {
  const cwd = directory(t);
  const runtime = pathToFileURL(path.join(repoRoot, 'server/babelParser/modelRuntime.js')).href;
  const file = node(['--input-type=module', '-e', `
    const { writeDebugModelPayload } = await import(${JSON.stringify(runtime)});
    console.log(writeDebugModelPayload({ stage: 'parse', model: 'm', sentence: 'Mia laughed.', rawText: '{}' }));`], cwd).trim();
  assert.equal(path.dirname(file), path.join(fs.realpathSync(cwd), '.artifacts', 'debug-model-payloads'));
  assertPrivateTree(path.join(cwd, '.artifacts'));
});

for (const runner of ['runCodexQualification.mjs', 'runAnthropicQualification.mjs']) {
  test(`${runner} creates owner-only run directories, parents and files without --run`, t => {
    const root = directory(t);
    const outputPath = path.join(root, 'batch', 'run-1');
    const script = path.join(repoRoot, 'scripts', runner);
    node([script, '--sentence', 'Mia laughed.', '--framework', 'xbar', '--out', outputPath, '--working-tree'], repoRoot);
    const receipt = JSON.parse(fs.readFileSync(path.join(outputPath, 'run-receipt.json'), 'utf8'));
    assert.equal(receipt.providerCallsMade, false);
    assert.ok(fs.existsSync(path.join(outputPath, 'contract.manifest.json')));
    assertPrivateTree(path.join(root, 'batch'));
  });
}
