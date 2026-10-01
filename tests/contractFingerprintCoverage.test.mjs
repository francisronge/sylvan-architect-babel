import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const capturePath = 'scripts/captureContractFingerprint.mjs';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('qualification fingerprints include Replay inspection, regression inputs and test helpers', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-fingerprint-coverage-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const currentManifestPath = path.join(temporary, 'current.json');
  execFileSync(process.execPath, [path.join(repoRoot, capturePath), '--allow-working-tree',
    '--out', currentManifestPath], { cwd: repoRoot, stdio: 'pipe' });
  const current = JSON.parse(fs.readFileSync(currentManifestPath, 'utf8'));
  const controls = [
    ['qualificationHarness', 'contractQualification/diagnosticReplay.ts'],
    ['qualificationHarness', 'contractQualification/workspaceInspection.css'],
    ['providerFreeFixtures', 'fixtures/replay-regressions/coordination-and-ellipsis.json'],
    ['providerFreeFixtures', 'fixtures/movement/holdout-transitions.json'],
    ['providerFreeTests', 'tests/helpers/rendererCloseoutFixture.mjs']
  ];
  for (const [section, relativePath] of controls) {
    const receipt = current.sections[section].files.find(file => file.path === relativePath);
    assert.ok(receipt, `${relativePath} must participate in the qualification receipt`);
    assert.equal(receipt.sha256, sha256(fs.readFileSync(path.join(repoRoot, relativePath))));
  }

  // Exercise the committed-source gate in isolation without mutating the real
  // checkout or executing its renderer, provider or helper modules.
  const isolated = path.join(temporary, 'checkout');
  for (const section of Object.values(current.sections)) {
    for (const { path: relativePath } of section.files) {
      const target = path.join(isolated, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, relativePath === capturePath
        ? fs.readFileSync(path.join(repoRoot, capturePath)) : `fixture for ${relativePath}\n`);
    }
  }
  const git = args => execFileSync('git', args, { cwd: isolated, stdio: 'pipe' });
  git(['init', '--quiet']);
  git(['add', '.']);
  git(['-c', 'user.name=Fingerprint test', '-c', 'user.email=fingerprint@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Test fingerprint baseline']);
  const capture = (label, workingTree = false) => {
    const destination = path.join(temporary, `${label}.json`);
    const result = spawnSync(process.execPath, [path.join(isolated, capturePath),
      '--out', destination, ...(workingTree ? ['--allow-working-tree'] : [])],
    { cwd: isolated, encoding: 'utf8' });
    return { ...result, manifest: result.status === 0
      ? JSON.parse(fs.readFileSync(destination, 'utf8')) : null };
  };
  const baseline = capture('baseline');
  assert.equal(baseline.status, 0, baseline.stderr);
  assert.equal(baseline.manifest.auditedSourcesMatchCommit, true);

  for (const [index, [section, relativePath]] of controls.entries()) {
    await t.test(`changed ${relativePath} invalidates the receipt`, () => {
      const target = path.join(isolated, relativePath);
      const original = fs.readFileSync(target);
      try {
        fs.appendFileSync(target, 'changed qualification evidence\n');
        const strict = capture(`strict-${index}`);
        assert.notEqual(strict.status, 0);
        assert.match(strict.stderr, /Contract fingerprint refused/);
        const changed = capture(`working-${index}`, true);
        assert.equal(changed.status, 0, changed.stderr);
        assert.equal(changed.manifest.auditedSourcesMatchCommit, false);
        assert.notEqual(changed.manifest.sections[section].sha256, baseline.manifest.sections[section].sha256);
        assert.notEqual(changed.manifest.overallSha256, baseline.manifest.overallSha256);
      } finally {
        fs.writeFileSync(target, original);
      }
    });
  }
});
