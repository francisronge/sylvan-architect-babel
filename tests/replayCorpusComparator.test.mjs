import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadCorpusManifest, compareCorpusSnapshots, selectRecord } from '../scripts/replayCorpusInputs.mjs';
import { buildCorpusSnapshot } from '../scripts/replayCorpusSnapshot.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = path.join(root, 'fixtures/replay-corpus/manifest.json');
const corpus = await loadCorpusManifest(manifestPath);
const records = corpus.records.filter(record => ['spanish-head-and-ordinary-wrapper',
  'tier2-witness-persistence', 'malformed-exact-with-independent-verdict'].includes(record.id));
const snapshot = await buildCorpusSnapshot(root, records, { width: 1600, height: 948, direction: 'ltr' });
const compare = candidate => compareCorpusSnapshots(snapshot, candidate, records);
const faults = results => results.flatMap(record => record.violations.map(fault => fault.kind));

test('the maintained fixture controls exercise a real movement, ordinary construction, persistence and malformed exact claim', () => {
  assert(snapshot.identity.sources.some(([name]) => name === 'replay/workspaceComponentLifetime.ts'));
  assert(snapshot.identity.sources.some(([name]) => name === 'package-lock.json'));
  assert.equal(snapshot.records.some(record => record.error), false);
  assert.deepEqual(faults(compare(structuredClone(snapshot))), []);
  assert.equal(snapshot.records[0].evidence.movementMoments, 1,
    'later persisted trajectory links must not be counted as fresh movement moments');
  assert(snapshot.records[0].evidence.merges > 0);
  assert(snapshot.records[1].evidence.planStages[1].facets.includes('identity.occurrences'));
  assert(!snapshot.records[1].evidence.planStages[2].facets.includes('identity.occurrences'));
  assert(snapshot.records[2].evidence.planStages[0].fallbackRelations.includes(0));
  assert(snapshot.records[2].evidence.planStages[0].facets.includes('judgment.verdict'));
});

test('a stretched completed branch and displaced final point fail while an earlier corrected point is reviewable', () => {
  const corrected = structuredClone(snapshot), frames = corrected.records[0].frames;
  // Correct a point that neither its own step nor the next one attaches; moving
  // a daughter that a new parent then joins would be an attachment-site fault.
  const attaches = (frame, id) => frame?.kind === 'micro' && ['ExternalMerge', 'Project'].includes(frame.operation)
    && frame.points.some(point => point.id === id && point.parent === frame.target);
  const index = frames.findIndex((frame, at) => at < frames.length - 1
    && !attaches(frame, frame.points[0].id) && !attaches(frames[at + 1], frame.points[0].id));
  assert(index >= 0);
  frames[index].points[0].x -= 20;
  const accepted = compare(corrected);
  assert.deepEqual(faults(accepted), []);
  assert.equal(accepted[0].changedFrames.length, 1);
  const stretched = structuredClone(snapshot), frame = stretched.records[0].frames.at(-1);
  frame.widths[0].width += 200;
  frame.points[0].x += 200;
  const rejected = compare(stretched);
  assert(faults(rejected).includes('completed-width-growth'));
  assert(faults(rejected).includes('final-coordinate-change'));
  assert.notDeepEqual(rejected[0].finalCoordinates.before, rejected[0].finalCoordinates.after);
});

test('a selected word that its projection pulls back is a new joining jump', () => {
  const joined = structuredClone(snapshot), [selection, projection] = joined.records[0].frames;
  selection.points[0].x -= 20;
  assert.equal(projection.points.find(point => point.id === selection.points[0].id).parent, projection.target);
  const jumped = compare(joined);
  assert.deepEqual(faults(jumped), ['new-motion-fault']);
  assert.deepEqual(jumped[0].motion.new.map(fault => [fault.frame, fault.kind, fault.distance, fault.waiting]),
    [[2, 'attachment-site-motion', 20, true]], 'joining jumps the baseline already has are not new');
});

test('semantic, authored, continuity, finite-geometry and witness-control failures cannot become a clean comparison', () => {
  const bad = structuredClone(snapshot), record = bad.records[0];
  record.replaySha256 = 'changed Replay'; record.planSha256 = 'changed plan';
  record.authoredAfterSha256 = 'mutated authored state'; record.inputSha256 = 'different input';
  record.continuity.push({ index: 1, rootId: 'i_v', kind: 'unowned-component-motion' });
  record.invalid.push({ frame: 2, id: 'i_v', kind: 'nonfinite' });
  record.expectationFailures.push('a required persistent drawing disappeared');
  assert.deepEqual(new Set(faults(compare(bad))), new Set(['input-mismatch', 'authored-mutation', 'replay-change',
    'relation-plan-change', 'new-continuity-fault', 'invalid-geometry', 'mechanism-control-failed']));
});

test('JSON pointers and legacy private-index paths resolve exactly without evaluating selectors', () => {
  const document = { attempts: [{ normalizedRecord: { response: { analyses: [{ value: 'selected' }] } } }], 'a/b': { '~key': 3 } };
  assert.equal(selectRecord(document, 'attempts[0].normalizedRecord.response.analyses[0]').value, 'selected');
  assert.equal(selectRecord(document, '/a~1b/~0key'), 3);
  assert.throws(() => selectRecord(document, 'attempts[0];process.exit()'), /Invalid selector/);
  assert.throws(() => selectRecord(document, '/attempts/9'), /does not resolve/);
});

test('the actual CLI retains evidence and exits nonzero when a required control fails', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'babel-corpus-test-'));
  try {
    const original = JSON.parse(await readFile(manifestPath, 'utf8'));
    const record = original.records.find(record => record.id === 'tier2-witness-persistence');
    record.source = path.resolve(path.dirname(manifestPath), record.source);
    const manifest = path.join(scratch, 'manifest.json'), output = path.join(scratch, 'report.json');
    await writeFile(manifest, JSON.stringify({ records: [record] }));
    const args = [path.join(root, 'scripts/compareReplayCorpus.mjs'), '--baseline-root', root, '--candidate-root', root,
      '--manifest', manifest, '--output', output];
    execFileSync(process.execPath, args, { timeout: 30000, stdio: 'pipe' });
    const good = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(good.ok, true); assert.equal(good.summary.analyses, 1);
    assert.equal(good.baseline.sha256, good.candidate.sha256);
    assert.equal(good.records[0].rawSha256, records[1].rawSha256);
    record.expect.facets[1].present = false;
    await writeFile(manifest, JSON.stringify({ records: [record] }));
    const failed = spawnSync(process.execPath, args, { timeout: 30000, encoding: 'utf8' });
    assert.equal(failed.status, 1, failed.stderr);
    const bad = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(bad.ok, false);
    assert.equal(bad.records[0].violations[0].kind, 'mechanism-control-failed');
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

// A candidate checkout whose prepareReplay passes its result through a hook, so a
// test can seed one change beneath the compared hashes and require the
// comparator to report it.
async function seededCandidate(scratch) {
  // Top-level dot entries are skipped so local credentials such as .env are never copied.
  const skipped = new Set(['node_modules', 'bench', 'docs', 'fixtures', 'public', 'test', 'tests', 'dist']);
  const candidate = path.join(scratch, 'candidate');
  await cp(root, candidate, { recursive: true, filter: source => {
    const [top] = path.relative(root, source).split(path.sep);
    return !top || !top.startsWith('.') && !skipped.has(top);
  } });
  await symlink(path.join(root, 'node_modules'), path.join(candidate, 'node_modules'), 'dir');
  await rename(path.join(candidate, 'replay/prepareReplay.ts'), path.join(candidate, 'replay/prepareReplay.unseeded.ts'));
  await writeFile(path.join(candidate, 'replay/prepareReplay.ts'), [
    "import { prepareReplay as prepareUnseeded } from './prepareReplay.unseeded.ts';",
    'export const prepareReplay = (input: Parameters<typeof prepareUnseeded>[0]) => {',
    '  const prepared = prepareUnseeded(input);',
    '  (globalThis as { babelSeededChange?: (value: typeof prepared) => void }).babelSeededChange?.(prepared);',
    '  return prepared;',
    '};', ''].join('\n'));
  return candidate;
}

test('a seeded change to one Replay step or one relation-plan field is reported for its record', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'babel-corpus-seed-'));
  try {
    const candidate = await seededCandidate(scratch);
    // Seeds only the second record, so the others prove the report stays per record.
    const seeded = async change => {
      const measured = [];
      for (const [index, record] of records.entries()) {
        globalThis.babelSeededChange = index === 1 ? change : undefined;
        measured.push(...(await buildCorpusSnapshot(candidate, [record], { width: 1600, height: 948, direction: 'ltr' })).records);
      }
      delete globalThis.babelSeededChange;
      return compare({ records: measured }).map(result => result.violations.map(fault => fault.kind));
    };
    const micro = prepared => prepared.playbackSteps.find(step => step.replayKind === 'micro' && step.replayVisibleNodeIds.length > 2);
    assert.deepEqual(await seeded(() => {}), [[], [], []], 'an unseeded candidate is clean');
    assert.deepEqual((await seeded(prepared => { micro(prepared).operation = 'InternalMerge'; }))[1], ['replay-change']);
    assert.deepEqual((await seeded(prepared => { micro(prepared).targetNodeId += '-seeded'; }))[1], ['replay-change']);
    assert.deepEqual((await seeded(prepared => { micro(prepared).replayVisibleNodeIds.pop(); }))[1], ['replay-change'],
      'visibility alone is compared');
    assert.deepEqual(await seeded(prepared => {
      const item = prepared.relationRenderPlan.frames.find(frame => frame.items.length).items[0];
      item.backward = !item.backward;
    }), [[], ['relation-plan-change'], []]);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
