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
  // An earlier corrected point is only motion: the comparison reviews it but no
  // geometry, final-tree or Replay check fails.
  const corrected = structuredClone(snapshot);
  corrected.records[0].frames[1].points[0].x -= 20;
  const accepted = compare(corrected);
  assert(faults(accepted).every(kind => kind === 'new-motion-fault'), JSON.stringify(faults(accepted)));
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

test('a candidate that drops its planner diagnostics still fails a seeded 500-unit jump', () => {
  const suppressed = structuredClone(snapshot), record = suppressed.records[0];
  record.continuity = [];
  const persists = (frame, id) => frame?.points.some(item => item.id === id && !item.parent);
  const index = record.frames.findIndex((frame, at) => at > 0 && frame.operation === 'LexicalSelect'
    && frame.points.some(item => !item.parent && item.id !== frame.target && persists(record.frames[at - 1], item.id)));
  const frame = record.frames[index];
  const bystander = frame.points.find(item => !item.parent && item.id !== frame.target && persists(record.frames[index - 1], item.id));
  const members = new Set([bystander.id]);
  for (const item of frame.points) if (members.has(item.parent)) members.add(item.id);
  for (const item of frame.points) if (members.has(item.id)) item.x += 500;
  const result = compare(suppressed);
  assert(faults(result).includes('new-motion-fault'));
  assert(result[0].motion.new.some(fault => fault.node === bystander.id && fault.kind === 'unowned-motion' && Math.round(fault.distance) === 500));
});

test('a joining jump the baseline already has fails when the candidate makes it longer', () => {
  const farther = structuredClone(snapshot), record = farther.records[0];
  const [fault] = compare(structuredClone(snapshot))[0].motion.baseline.filter(item => item.kind === 'attachment-site-motion');
  assert(fault, 'the maintained control has a joining jump');
  record.frames[fault.frame - 2].points.find(item => item.id === fault.node).x -= 200;
  const result = compare(farther)[0];
  assert(result.violations.some(violation => violation.kind === 'worsened-motion-fault'
    && violation.faults.some(item => item.node === fault.node && item.distance > fault.distance + 1)));
});

test('faults are matched by step, so an inserted frame neither invents nor hides one', () => {
  const baseline = compare(structuredClone(snapshot))[0].motion.baseline;
  assert(baseline.length, 'the maintained control has a fault');
  const inserted = structuredClone(snapshot), frames = inserted.records[0].frames;
  frames.splice(1, 0, structuredClone(frames[0]));
  const shifted = compare(inserted)[0].motion;
  assert.deepEqual([shifted.new, shifted.worsened], [[], []]);
  assert.deepEqual(shifted.candidate.map(fault => fault.frame), baseline.map(fault => fault.frame + 1));
});

test('a child that moves farther than its moving parent is a worsened fault', () => {
  const [fault] = compare(structuredClone(snapshot))[0].motion.baseline;
  const moved = structuredClone(snapshot), frame = moved.records[0].frames[fault.frame - 1];
  const node = frame.points.find(item => item.id === fault.node);
  const child = frame.points.find(item => item.parent === node.id);
  assert(child, 'the fault has a painted child');
  for (const item of frame.points) if (item.id === child.id || item.parent === child.id) item.x += 300;
  assert(compare(moved)[0].violations.some(violation => ['worsened-motion-fault', 'new-motion-fault'].includes(violation.kind)
    && violation.faults.some(item => item.node === child.id)));
});

test('a deformation the baseline already has fails when the candidate makes it larger', () => {
  const shifted = distance => {
    const copy = structuredClone(snapshot), frames = copy.records[0].frames;
    // A leaf under an unchanged parent, in a frame whose neighbours keep it.
    const at = frames.findIndex((frame, index) => index > 0 && index < frames.length - 1 && frame.points.some(item => item.parent
      && !frame.points.some(other => other.parent === item.id) && frames[index - 1].points.some(other => other.id === item.id)));
    const leaf = frames[at].points.find(item => item.parent && !frames[at].points.some(other => other.parent === item.id)
      && frames[at - 1].points.some(other => other.id === item.id));
    leaf.x += distance;
    return { copy, node: leaf.id };
  };
  const baseline = shifted(20), candidate = shifted(200);
  const [result] = compareCorpusSnapshots(baseline.copy, candidate.copy, records);
  assert(result.violations.some(violation => violation.kind === 'worsened-motion-fault'
    && violation.faults.some(fault => fault.node === candidate.node && fault.kind === 'shape-motion' && Math.round(fault.distance) === 200)));
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
    assert(good.harness.sources.some(source => source.filename.endsWith('components/treeViewport.ts')), 'the camera rule is fingerprinted');
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
