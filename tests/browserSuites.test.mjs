import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignBrowserShards, BROWSER_CI_SHARD_COUNT, BROWSER_CI_SHARDS, BROWSER_SPECS, checkBrowserShards, checkShardReceipts,
  requiredTestSummary, selectBrowserSpecs } from '../scripts/browserSuites.mjs';

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
  assert.equal(Object.keys(BROWSER_CI_SHARDS).length, BROWSER_CI_SHARD_COUNT);
  assert.throws(() => selectBrowserSpecs(actual, 'ci:unknown'), /Unknown browser suite: ci:unknown/);
  const withNewSpec = [...BROWSER_SPECS, { file: 'newSpec.test.mjs', owner: 'renderer' }];
  assert.throws(() => selectBrowserSpecs([...actual, 'newSpec.test.mjs'], 'ci:1', withNewSpec), /unsharded: newSpec/);
  const [first, ...others] = Object.values(BROWSER_CI_SHARDS);
  assert.throws(() => checkBrowserShards(BROWSER_SPECS, { ...BROWSER_CI_SHARDS, extra: [first[0]] }), new RegExp(`Repeated: ${first[0]}`));
  assert.throws(() => checkBrowserShards(BROWSER_SPECS, { 1: first.slice(1), ...Object.fromEntries(others.map((files, index) => [index + 2, files])) }),
    new RegExp(`unsharded: ${first[0]}`));
  assert.throws(() => checkBrowserShards(BROWSER_SPECS, { ...BROWSER_CI_SHARDS, extra: [] }), /empty shards: extra/);
});

test('the CI browser split is deterministic and gives a new spec, weighted or not, exactly one shard', () => {
  assert.deepEqual(assignBrowserShards(), BROWSER_CI_SHARDS);
  assert.deepEqual(assignBrowserShards([...BROWSER_SPECS].reverse()), BROWSER_CI_SHARDS);
  for (const added of [{ file: 'newSpec.test.mjs', owner: 'renderer' }, { file: 'newSpec.test.mjs', owner: 'renderer', ciSeconds: 500 }]) {
    const specs = [...BROWSER_SPECS, added], shards = assignBrowserShards(specs);
    assert.doesNotThrow(() => checkBrowserShards(specs, shards));
    assert.equal(Object.values(shards).flat().filter(file => file === added.file).length, 1);
  }
});

const passingReceipt = (shard, specs = selectBrowserSpecs(BROWSER_SPECS.map(spec => spec.file), `ci:${shard}`)) => ({
  suite: `ci:${shard}`, required: specs, exitCode: 0, signal: null, error: null,
  testSummary: { tests: 3, pass: 3, fail: 0, cancelled: 0, skipped: 0, todo: 0 }
});

test('shard receipts pass only when they ran the full gate, each spec once', () => {
  const actual = BROWSER_SPECS.map(spec => spec.file);
  const good = Object.keys(BROWSER_CI_SHARDS).map(shard => passingReceipt(shard));
  assert.deepEqual(checkShardReceipts(actual, good), { shards: BROWSER_CI_SHARD_COUNT, specs: actual.length });
  const [first, last] = [good[0], good.at(-1)], middle = good.slice(1, -1);
  const lastFirstSpec = last.required[0].file;
  assert.throws(() => checkShardReceipts(actual, [first, ...middle]), new RegExp(`no receipt for ${last.suite}[\\s\\S]*not run by any shard: ${lastFirstSpec}`));
  const leftOut = { ...last, required: last.required.slice(1) };
  assert.throws(() => checkShardReceipts(actual, [first, ...middle, leftOut]), new RegExp(`${last.suite} ran[\\s\\S]*not run by any shard: ${lastFirstSpec}`));
  const overlap = { ...last, required: [...last.required, first.required[0]] };
  assert.throws(() => checkShardReceipts(actual, [first, ...middle, overlap]), new RegExp(`run by more than one shard: ${first.required[0].file}`));
  assert.throws(() => checkShardReceipts(actual, [...good, { ...first, suite: 'full' }]), /unexpected receipt for full/);
  assert.throws(() => checkShardReceipts(actual, [first, ...good]), new RegExp(`two receipts for ${first.suite}`));
  for (const broken of [{ exitCode: 1 }, { error: `Error: Browser ${last.suite} failed` },
    { testSummary: { ...last.testSummary, pass: 2, skipped: 1 } }, { testSummary: null }]) {
    assert.throws(() => checkShardReceipts(actual, [first, ...middle, { ...last, ...broken }]), new RegExp(`${last.suite} did not pass`));
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
    const [first, ...others] = Object.keys(BROWSER_CI_SHARDS), last = others.at(-1);
    for (const shard of others.slice(0, -1)) await put(`browser-receipt-${shard}-1`, passingReceipt(shard));
    await put(`browser-receipt-${first}-1`, passingReceipt(first));
    assert.match(run().stderr, new RegExp(`no receipt for ci:${last}`));
    await put(`browser-receipt-${last}-1`, { ...passingReceipt(last), exitCode: 1, error: 'Error: failed' });
    assert.equal(run().status, 1);
    await put(`browser-receipt-${last}-2`, passingReceipt(last));
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`${BROWSER_CI_SHARD_COUNT} shards ran all 16 required browser specs, each exactly once`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
