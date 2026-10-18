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
    ['run:batch/a/1#0', '/response/analyses/0'], ['run:batch/a/1#1', '/response/analyses/1'], ['run:batch/b/1#0', '/response/analyses/0']]);
  const manifestPath = path.join(scratch, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, records }));
  assert.deepEqual((await loadCorpusManifest(manifestPath)).records.map(record => record.input.sentence), ['Mia', 'Mia', 'Mia']);
}));
