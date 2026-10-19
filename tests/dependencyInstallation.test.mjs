import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { verifyDependencyInstallation } from '../scripts/verifyDependencyInstallation.mjs';

const write = async (root, file, value) => {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), JSON.stringify(value));
};

test('Doctor checks real transitive manifests and required closure rather than trusting the hidden lock', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'babel-dependency-doctor-'));
  const parent = { name: 'parent', version: '1.0.0', dependencies: { child: '1.0.0' } };
  const child = { name: 'child', version: '1.0.0' };
  const pkg = { name: 'doctor-control', version: '1.0.0', dependencies: { parent: '1.0.0' }, optionalDependencies: { 'platform-extra': '1.0.0' } };
  const packages = { '': pkg, 'node_modules/parent': parent, 'node_modules/child': child };
  const hidden = { name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { 'node_modules/parent': parent, 'node_modules/child': child } };
  try {
    await write(root, 'package.json', pkg); await write(root, 'package-lock.json', { lockfileVersion: 3, packages });
    await write(root, 'node_modules/.package-lock.json', hidden);
    await write(root, 'node_modules/parent/package.json', parent); await write(root, 'node_modules/child/package.json', child);
    assert.equal((await verifyDependencyInstallation(root)).installedPackages, 2, 'absent optional dependencies remain valid');
    await write(root, 'node_modules/child/package.json', { ...child, version: '9.0.0' });
    await assert.rejects(verifyDependencyInstallation(root), /differs from the lock.*child/);
    await fs.rm(path.join(root, 'node_modules/child'), { recursive: true });
    await assert.rejects(verifyDependencyInstallation(root), /ENOENT.*child/);
    delete hidden.packages['node_modules/child']; await write(root, 'node_modules/.package-lock.json', hidden);
    await assert.rejects(verifyDependencyInstallation(root), /dependency graph is incomplete/);
    await write(root, 'node_modules/child/package.json', child); hidden.packages['node_modules/child'] = child;
    await write(root, 'node_modules/.package-lock.json', hidden);
    assert.equal((await verifyDependencyInstallation(root)).installedPackages, 2, 'repaired dependency closure passes');
    await fs.rm(path.join(root, 'node_modules/child'), { recursive: true });
    delete hidden.packages['node_modules/child'];
    hidden.packages['node_modules/parent'] = { ...parent, dependencies: {} };
    await write(root, 'node_modules/.package-lock.json', hidden);
    await write(root, 'node_modules/parent/package.json', { ...parent, dependencies: {} });
    await assert.rejects(verifyDependencyInstallation(root), /dependency declarations differ.*parent/,
      'an altered manifest cannot conceal the child still required by the canonical lock');
    await write(root, 'node_modules/parent/package.json', parent);
    await write(root, 'node_modules/child/package.json', child);
    hidden.packages['node_modules/child'] = child; hidden.packages['node_modules/parent'] = parent;
    await write(root, 'node_modules/.package-lock.json', hidden);
    await write(root, 'package.json', { ...pkg, dependencies: {} });
    await assert.rejects(verifyDependencyInstallation(root), /dependency declarations differ.*package.json/,
      'the project manifest cannot conceal a required dependency either');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});


test('Doctor writes a receipt when Playwright and installed dependencies are missing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'babel-missing-browser-doctor-'));
  try {
    await fs.mkdir(path.join(root, 'scripts'));
    for (const name of ['verifyBabelEnvironment.mjs', 'browserSuites.mjs', 'replayCorpusInputs.mjs', 'replayMotionContinuity.mjs',
      'verifyDependencyInstallation.mjs']) {
      await fs.copyFile(new URL(`../scripts/${name}`, import.meta.url), path.join(root, 'scripts', name));
    }
    // The corpus inputs load the motion rule, which measures through the camera carry.
    await fs.mkdir(path.join(root, 'components'));
    await fs.copyFile(new URL('../components/treeViewport.ts', import.meta.url), path.join(root, 'components', 'treeViewport.ts'));
    // ...and decides step ownership with the shared motion helper.
    await fs.mkdir(path.join(root, 'tests', 'helpers'), { recursive: true });
    await fs.copyFile(new URL('./helpers/motionOwnership.mjs', import.meta.url), path.join(root, 'tests', 'helpers', 'motionOwnership.mjs'));
    for (const name of ['package.json', 'package-lock.json']) {
      await fs.copyFile(new URL(`../${name}`, import.meta.url), path.join(root, name));
    }
    const output = path.join(root, 'doctor.json');
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/verifyBabelEnvironment.mjs'),
      '--browser', 'chromium', '--out', output], { cwd: root, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const receipt = JSON.parse(await fs.readFile(output, 'utf8'));
    assert.equal(receipt.ok, false);
    assert.equal(receipt.checks.find(check => check.name === 'Dependency identity').passed, false);
    const browser = receipt.checks.find(check => check.name === 'chromium runtime');
    assert.equal(browser.passed, false);
    assert.match(browser.detail, /Cannot find package 'playwright'/);
    assert.match(result.stdout, /FAIL chromium runtime/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
