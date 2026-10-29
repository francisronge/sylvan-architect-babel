import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { fixtureRecords, runRecords } from '../scripts/buildCorpusArchiveManifest.mjs';
import { loadCorpusManifest } from '../scripts/replayCorpusInputs.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

const withScratch = async use => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'babel-archive-manifest-'));
  try { return await use(scratch); } finally { await rm(scratch, { recursive: true, force: true }); }
};

test('the archive manifest names every committed fixture analysis that has a saved sentence', () => withScratch(async scratch => {
  const { records, skipped } = fixtureRecords();
  const corpus = loadFixtureAnalyses();
  const saved = new Map(corpus.records.filter(record => record.sentenceSource === 'saved').map(record => [record.id, record.record]));
  assert.equal(records.length, saved.size);
  assert.deepEqual(skipped.map(item => item.id.replace(/^fixture:/, '')).sort(),
    corpus.records.filter(record => record.sentenceSource !== 'saved').map(record => record.id).sort());
  const manifestPath = path.join(scratch, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, records }));
  for (const record of (await loadCorpusManifest(manifestPath)).records) {
    const expected = saved.get(record.id.replace(/^fixture:/, ''));
    assert.ok(expected, record.id);
    assert.equal(record.input.sentence, expected.sentence, record.id);
    assert.deepEqual(record.input.derivationStages, expected.derivationStages, record.id);
  }
}));

test('fixture records the layout fingerprint covers are judged by motion, not by their Replay; others stay strict', () => withScratch(async scratch => {
  const fixtures = path.join(scratch, 'fixtures'), stage = { statement: 'S', stageRecord: 'R', relations: [],
    workspaceForest: [{ id: 'n', label: 'N', word: 'Mia' }] };
  await mkdir(path.join(fixtures, 'replay-snapshots'), { recursive: true });
  await writeFile(path.join(fixtures, 'reviewed.json'), JSON.stringify({ sentence: 'Mia', derivationStages: [stage] }));
  await writeFile(path.join(fixtures, 'unreviewed.json'), JSON.stringify({ sentence: 'Mia', derivationStages: [stage] }));
  await writeFile(path.join(fixtures, 'replay-snapshots', 'fixture-layout.json'), JSON.stringify({ records: { 'reviewed.json#': {} } }));
  const { records } = fixtureRecords(fixtures);
  assert.deepEqual(records.map(record => [path.basename(record.source), record.allow && Object.keys(record.allow).filter(key => record.allow[key] === true)]),
    [['reviewed.json', ['replay', 'plan', 'finalCoordinates', 'completedWidthGrowth']], ['unreviewed.json', undefined]]);
  assert.match(records[0].allow.reason, /fixture-layout\.json/);
  assert(fixtureRecords().records.every(record => record.allow?.replay), 'every committed fixture record is fingerprinted');
}));

test('run records name every analysis of each saved attempt and skip runs without one', () => withScratch(async scratch => {
  const runs = path.join(scratch, 'batch', 'runs');
  const stage = { statement: 'S', stageRecord: 'R', relations: [], workspaceForest: [{ id: 'n', label: 'N', word: 'Mia' }] };
  const bundle = analyses => ({ request: { sentence: 'Mia' }, response: { sentence: 'Mia', analyses } });
  for (const [run, attempt, analyses] of [['a', '1', [{ derivationStages: [stage] }, { derivationStages: [stage] }]], ['b', '1', [{ derivationStages: [stage] }]]]) {
    await mkdir(path.join(runs, run, 'attempts', attempt), { recursive: true });
    await writeFile(path.join(runs, run, 'attempts', attempt, 'bundle.json'), JSON.stringify(bundle(analyses)));
  }
  await mkdir(path.join(runs, 'transport-failure'), { recursive: true });
  const records = runRecords(runs);
  assert.deepEqual(records.map(record => [record.id, record.selector]), [
    ...[['a/1#0', 0], ['a/1#1', 1], ['b/1#0', 0]].map(([id, index]) => [`run:${path.basename(scratch)}/batch/${id}`, `/response/analyses/${index}`])]);
  const manifestPath = path.join(scratch, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, records }));
  assert.deepEqual((await loadCorpusManifest(manifestPath)).records.map(record => record.input.sentence), ['Mia', 'Mia', 'Mia']);
}));
