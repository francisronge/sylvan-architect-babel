import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_CI_SHARDS, BROWSER_SPECS, checkBrowserShards, checkShardReceipts, requiredTestSummary,
  selectBrowserSpecs } from '../scripts/browserSuites.mjs';

test('browser ownership keeps the existing fast gate and complete coverage distinct', () => {
  const actual = BROWSER_SPECS.map(spec => spec.file);
  assert.deepEqual(selectBrowserSpecs(actual, 'renderer').map(spec => spec.file), [
    'movementEndpointAttachment.test.mjs', 'trajectoryLabelClearance.test.mjs', 'connectorTextMask.test.mjs',
    'featureComposition.test.mjs', 'plaqueClearance.test.mjs', 'operatorBindingComposition.test.mjs'
  ]);
  assert.deepEqual(selectBrowserSpecs(actual, 'compatibility').map(spec => spec.file), ['reviewCompatibility.test.mjs']);
  assert.equal(selectBrowserSpecs(actual).length, actual.length);
  assert.throws(() => selectBrowserSpecs([...actual, 'new-unowned.test.mjs']), /unowned: new-unowned/);
  assert.throws(() => selectBrowserSpecs(actual.slice(1)), /Missing: movementEndpointAttachment/);
  assert.throws(() => selectBrowserSpecs(actual, 'unknown'), /Unknown browser suite/);
});

test('required browser coverage cannot pass with skipped, todo or unfinished tests', () => {
  const result = '# tests 6\n# pass 6\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  assert.deepEqual(requiredTestSummary(result), { tests: 6, pass: 6, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  assert.throws(() => requiredTestSummary(result.replace('# pass 6', '# pass 5').replace('# skipped 0', '# skipped 1')), /did not execute/);
  assert.throws(() => requiredTestSummary(result.replace('# pass 6', '# pass 5').replace('# todo 0', '# todo 1')), /did not execute/);
  assert.throws(() => requiredTestSummary(result.replace('# pass 6', '# pass 5').replace('# cancelled 0', '# cancelled 1')), /did not execute/);
  assert.throws(() => requiredTestSummary(result.replace('# pass 6\n', '')), /completed test denominator/);
  assert.throws(() => requiredTestSummary(result.replace('# tests 6', '# tests 7')), /completed test denominator/);
  assert.throws(() => requiredTestSummary('TAP version 13\n'), /completed test denominator/);
});

test('CI browser shards together select every required spec exactly once', () => {
  const actual = BROWSER_SPECS.map(spec => spec.file);
  const shards = Object.keys(BROWSER_CI_SHARDS).map(shard => selectBrowserSpecs(actual, `ci:${shard}`).map(spec => spec.file));
  assert.deepEqual(shards.flat().sort(), [...actual].sort());
  assert.equal(new Set(shards.flat()).size, actual.length);
  assert.ok(shards.every(files => files.length > 0));
  assert.throws(() => selectBrowserSpecs(actual, 'ci:unknown'), /Unknown browser suite: ci:unknown/);
  const withNewOwner = [...BROWSER_SPECS, { file: 'newOwner.test.mjs', owner: 'newowner' }];
  assert.throws(() => selectBrowserSpecs([...actual, 'newOwner.test.mjs'], 'ci:renderer', withNewOwner), /unsharded: newowner/);
  assert.throws(() => checkBrowserShards(BROWSER_SPECS, { ...BROWSER_CI_SHARDS, extra: ['atlas'] }), /Repeated: atlas/);
  assert.throws(() => checkBrowserShards(BROWSER_SPECS, { renderer: ['renderer', 'compatibility'], application: ['application', 'atlas'] }), /unsharded: capture/);
});

const passingReceipt = (shard, specs = selectBrowserSpecs(BROWSER_SPECS.map(spec => spec.file), `ci:${shard}`)) => ({
  suite: `ci:${shard}`, required: specs, exitCode: 0, signal: null, error: null,
  testSummary: { tests: 3, pass: 3, fail: 0, cancelled: 0, skipped: 0, todo: 0 }
});

test('shard receipts pass only when they ran the full gate, each spec once', () => {
  const actual = BROWSER_SPECS.map(spec => spec.file);
  const good = Object.keys(BROWSER_CI_SHARDS).map(shard => passingReceipt(shard));
  assert.deepEqual(checkShardReceipts(actual, good), { shards: 2, specs: actual.length });
  const [renderer, application] = good;
  assert.throws(() => checkShardReceipts(actual, [renderer]), /no receipt for ci:application[\s\S]*not run by any shard: tier2ProductionRecipes[^\n]*appWorkflow/);
  const leftOut = { ...application, required: application.required.slice(1) };
  assert.throws(() => checkShardReceipts(actual, [renderer, leftOut]), /ci:application ran[\s\S]*not run by any shard: tier2ProductionRecipes/);
  const overlap = { ...application, required: [...application.required, renderer.required[0]] };
  assert.throws(() => checkShardReceipts(actual, [renderer, overlap]), /run by more than one shard: movementEndpointAttachment/);
  assert.throws(() => checkShardReceipts(actual, [renderer, application, { ...renderer, suite: 'full' }]), /unexpected receipt for full/);
  assert.throws(() => checkShardReceipts(actual, [renderer, renderer, application]), /two receipts for ci:renderer/);
  for (const broken of [{ exitCode: 1 }, { error: 'Error: Browser ci:application failed' },
    { testSummary: { ...application.testSummary, pass: 2, skipped: 1 } }, { testSummary: null }]) {
    assert.throws(() => checkShardReceipts(actual, [renderer, { ...application, ...broken }]), /ci:application did not pass/);
  }
});

test('the receipt check reads the latest attempt of each shard and fails on a missing shard', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'babel-shard-receipts-'));
  const script = fileURLToPath(new URL('../scripts/checkBrowserShardReceipts.mjs', import.meta.url));
  const put = async (name, receipt) => {
    await mkdir(path.join(dir, name));
    await writeFile(path.join(dir, name, 'receipt.json'), JSON.stringify(receipt));
  };
  const run = () => spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
  try {
    await put('browser-receipt-renderer-1', passingReceipt('renderer'));
    assert.match(run().stderr, /no receipt for ci:application/);
    await put('browser-receipt-application-1', { ...passingReceipt('application'), exitCode: 1, error: 'Error: failed' });
    assert.equal(run().status, 1);
    await put('browser-receipt-application-2', passingReceipt('application'));
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /2 shards ran all 16 required browser specs, each exactly once/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
