import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { runRecords } from '../scripts/buildCorpusArchiveManifest.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

// On 29 Oct the Sol and Opus held-out batches were both saved as heldout-20261029,
// one under codex-qualification and one under anthropic-qualification. Record ids
// named a batch by its folder alone, so the two batches' analyses shared ids and
// the combined visual and camera audit silently checked 133 of 227 analyses.
const run = promisify(execFile);
const script = name => fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));
const ARCHIVES = ['codex-qualification', 'anthropic-qualification'];
// One analysis with one Replay invariant finding, so the sweep reports its id.
const WITH_FINDING = 'movement/holdout-transitions.json#/1';

function sameNamedBatches(t) {
  const scratch = mkdtempSync(path.join(tmpdir(), 'babel-batch-identity-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const { record } = loadFixtureAnalyses().records.find(entry => entry.id === WITH_FINDING);
  const batches = ARCHIVES.map(archive => path.join(scratch, archive, 'heldout-20261029'));
  for (const batch of batches) {
    const attempt = path.join(batch, 'runs', 'n4-34', 'attempts', 'parse');
    mkdirSync(attempt, { recursive: true });
    writeFileSync(path.join(attempt, 'bundle.json'), JSON.stringify({ request: { sentence: record.sentence },
      response: { sentence: record.sentence, inputTokens: record.inputTokens, analyses: [{ derivationStages: record.derivationStages }] } }));
  }
  return batches;
}

test('run records name the archive as well as the batch', t => {
  const records = sameNamedBatches(t).flatMap(batch => runRecords(path.join(batch, 'runs')));
  assert.deepEqual(records.map(record => record.id), [
    'run:codex-qualification/heldout-20261029/n4-34/parse#0', 'run:anthropic-qualification/heldout-20261029/n4-34/parse#0']);
});

test('the visual audit checks every analysis of two same-named batches and refuses a repeated source', async t => {
  const batches = sameNamedBatches(t), out = path.join(path.dirname(path.dirname(batches[0])), 'visual.json');
  const audit = (...runs) => run(process.execPath, [script('auditReplayVisuals.mjs'), ...runs.flatMap(batch => ['--runs', path.join(batch, 'runs')]),
    '--viewports', 'desktop', '--no-canopy', '--jobs', '1', '--out', out]);
  const { stdout } = await audit(...batches);
  assert.match(stdout, /Loaded 2 analyses; auditing 2 of them\./);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).records, 2);
  await assert.rejects(audit(batches[0], batches[0]), error => /1 of 2 analyses repeat another's id, such as run:codex-qualification\/heldout-20261029\/n4-34\/parse#0/.test(error.stderr));
});

test('the invariant sweep names each batch by its archive, refuses a repeated batch and can fail on findings', async t => {
  const batches = sameNamedBatches(t), out = path.join(path.dirname(path.dirname(batches[0])), 'invariants.json');
  const sweep = (args, ...given) => run(process.execPath, [script('auditReplayInvariants.mjs'), ...given.flatMap(batch => ['--batch', batch]),
    '--out', out, ...args]);
  const { stdout } = await sweep([], ...batches);
  assert.match(stdout, /^2 of 2 loaded analyses/);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).records.map(record => record.id),
    ['codex-qualification/heldout-20261029/n4-34 a1', 'anthropic-qualification/heldout-20261029/n4-34 a1']);
  await assert.rejects(sweep([], batches[0], batches[0]), error => /1 of 2 analyses repeat another's id/.test(error.stderr));
  await assert.rejects(sweep(['--fail-on-findings'], batches[0]), error => error.code === 1 && /--fail-on-findings: 1 analyses with findings/.test(error.stdout));
});
