import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadCorpusManifest, compareCorpusSnapshots, lostMovementPresentations, selectRecord } from '../scripts/replayCorpusInputs.mjs';
import { buildCorpusSnapshot } from '../scripts/replayCorpusSnapshot.mjs';
import { motionFrame } from '../scripts/replayMotionContinuity.mjs';
import { getNodeId } from '../replay/displayIdentity.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { layoutMeasuredScenes, prepareVisualRecord } from './helpers/visualFrames.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { movementPresentations } from './helpers/replayInvariants.mjs';

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

test('every compared frame is the layout the renderer paints, measured text included', () => {
  // The unmeasured reservations place a stage's waiting workspaces differently
  // from the painted plan, so motion the screen shows went unreported there.
  for (const [index, record] of records.entries()) {
    const visual = prepareVisualRecord(record.input), { scenes } = layoutMeasuredScenes(visual, { width: 1600, height: 948 });
    assert.deepEqual(snapshot.records[index].frames.map(frame => frame.points),
      scenes.map(scene => motionFrame(scene.step, scene.nodes, getNodeId).points), record.id);
  }
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

test('a new jump shorter than 20 tree units is reported but does not fail', () => {
  const pulled = distance => {
    const joined = structuredClone(snapshot);
    joined.records[0].frames[0].points[0].x -= distance;
    return compare(joined)[0];
  };
  const small = pulled(19);
  assert.deepEqual(small.motion.new.map(fault => [fault.frame, fault.kind, fault.distance]), [[2, 'attachment-site-motion', 19]]);
  assert.deepEqual(small.motion.tolerated, small.motion.new);
  assert.deepEqual(small.violations, []);
  assert.deepEqual(pulled(20).violations.map(violation => violation.kind), ['new-motion-fault']);
});

test('an approved motion exception covers its fault within its bound, and only in its own record', () => {
  const joined = structuredClone(snapshot);
  joined.records[0].frames[0].points[0].x -= 40;
  const [fault] = compare(joined)[0].motion.new;
  const entry = bound => ({ reason: 'test', record: records[0].id, rule: 'motion', subtype: fault.kind, subject: fault.node,
    at: { '-': { [fault.frame]: bound } } });
  const kinds = (exceptions, list = records) => compareCorpusSnapshots(snapshot, joined, list, { motionExceptions: exceptions })[0]
    .violations.map(violation => violation.kind);
  assert.deepEqual(kinds([entry(40)]), []);
  assert.deepEqual(kinds([entry(38.5)]), [], 'a fault within 5% of its bound is covered');
  assert.deepEqual(kinds([entry(30)]), ['new-motion-fault'], 'a fault beyond its bound is not');
  assert.deepEqual(kinds([{ ...entry(40), record: 'another record' }]), ['new-motion-fault']);
  assert.deepEqual(compareCorpusSnapshots(snapshot, joined, records, { motionExceptions: [entry(40)] })[0].motion.excepted, [fault]);
});

test('a fingerprinted fixture fails on motion, not on a reviewed Replay, plan or final-layout change', async () => {
  const { fixtureRecords } = await import('../scripts/buildCorpusArchiveManifest.mjs');
  const { allow } = fixtureRecords().records[0];
  const changed = structuredClone(snapshot), record = changed.records[0], final = record.frames.at(-1);
  record.replaySha256 = 'changed Replay'; record.planSha256 = 'changed plan';
  final.widths[0].width += 200;
  final.points[0].x += 200;
  record.frames[0].points[0].x -= 40;
  const judged = list => faults(compareCorpusSnapshots(snapshot, changed, list).slice(0, 1));
  assert(!judged([{ ...records[0], allow }]).some(kind => ['replay-change', 'relation-plan-change', 'final-coordinate-change',
    'completed-width-growth'].includes(kind)), 'reviewed through the layout fingerprint');
  assert(judged([{ ...records[0], allow }]).includes('new-motion-fault'), 'a 40-unit joining jump still fails');
  assert.deepEqual(new Set(judged(records)), new Set(['replay-change', 'relation-plan-change', 'final-coordinate-change',
    'completed-width-growth', 'new-motion-fault']), 'a maintained corpus record keeps its strict allow rules');
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

test('a fault the baseline has fails only when it grows by 20 units or 10% of its old distance, whichever is larger', () => {
  const shifted = distance => {
    const copy = structuredClone(snapshot), frames = copy.records[0].frames;
    const at = frames.findIndex((frame, index) => index > 0 && index < frames.length - 1 && frame.points.some(item => item.parent
      && !frame.points.some(other => other.parent === item.id) && frames[index - 1].points.some(other => other.id === item.id)));
    const leaf = frames[at].points.find(item => item.parent && !frames[at].points.some(other => other.parent === item.id)
      && frames[at - 1].points.some(other => other.id === item.id));
    leaf.x += distance;
    return copy;
  };
  const judge = (from, to) => {
    const [result] = compareCorpusSnapshots(shifted(from), shifted(to), records);
    return { worsened: result.motion.worsened.length > 0, kinds: result.violations.map(violation => violation.kind) };
  };
  assert.deepEqual(judge(20, 39), { worsened: true, kinds: [] }, '19 units farther is reported, not failed');
  assert.deepEqual(judge(20, 41).kinds, ['worsened-motion-fault']);
  assert.deepEqual(judge(300, 325), { worsened: true, kinds: [] }, 'under 10% of a long fault is reported, not failed');
  assert.deepEqual(judge(300, 331).kinds, ['worsened-motion-fault']);
});

test('a movement the baseline shows fails when the candidate drops its moment, builds its landing or loses its trajectory', () => {
  const [movement] = snapshot.records[0].evidence.movements;
  assert.deepEqual([movement.landing, movement.relationKey, movement.shown, movement.trajectory], ['i_v', '1:0', true, true]);
  const lost = edit => {
    const candidate = structuredClone(snapshot);
    edit(candidate.records[0].evidence.movements);
    return compare(candidate)[0].violations.filter(violation => violation.kind === 'movement-not-shown').flatMap(violation => violation.faults);
  };
  assert.match(lost(movements => movements.splice(0))[0].reason, /no longer recognizes/);
  assert.match(lost(movements => Object.assign(movements[0], { shown: false, kind: 'micro', operation: 'ExternalMerge', relationKey: null }))[0].reason,
    /arrives at micro ExternalMerge, not at the moment of 1:0/);
  assert.match(lost(movements => { movements[0].trajectory = false; })[0].reason, /1:0 no longer draws its trajectory/);
});

test('a first-stage chain whose landing construction builds is a lost movement, though the baseline draws no trajectory for it', () => {
  // The rejected candidate built booksDP bottom-up before the chain's moment (frame 20 on main).
  const record = loadFixtureAnalyses().records.find(entry => entry.id === 'replay-regressions/receiving-head-material.json#').record;
  const baseline = prepareReplay({ ...structuredClone(record), includePlayback: true });
  const built = { ...baseline, playbackSteps: structuredClone(baseline.playbackSteps) };
  Object.assign(built.playbackSteps[19], { replayKind: 'micro', operation: 'Project', replayRelationIdentity: undefined });
  const before = movementPresentations(baseline, record), after = movementPresentations(built, record);
  assert.deepEqual(lostMovementPresentations(before, before), []);
  assert.deepEqual(lostMovementPresentations(before, after).map(fault => [fault.landing, fault.baseline.trajectory, fault.reason]),
    [['booksDP', false, 'the landing arrives at micro Project, not at the moment of 0:0']]);
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
    for (const rule of ['replay/motionRule.ts', 'replay/cameraCarry.ts'])
      assert(good.harness.sources.some(source => source.filename.endsWith(rule)), `${rule} is fingerprinted`);
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

test('shards merged compare exactly as one run does, fail as it does, and only a complete set merges', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'babel-corpus-shards-'));
  try {
    const original = JSON.parse(await readFile(manifestPath, 'utf8'));
    const chosen = original.records.filter(record => records.some(({ id }) => id === record.id))
      .map(record => ({ ...record, source: path.resolve(path.dirname(manifestPath), record.source) }));
    const manifest = path.join(scratch, 'manifest.json'), out = name => path.join(scratch, name);
    const base = [path.join(root, 'scripts/compareReplayCorpus.mjs'), '--baseline-root', root, '--candidate-root', root,
      '--manifest', manifest, '--jobs', '1'];
    const cli = (...args) => spawnSync(process.execPath, [...base, ...args], { timeout: 60000, encoding: 'utf8' });
    const shardsThenMerge = (name) => {
      for (const shard of [1, 2]) assert.equal(cli('--shard', `${shard}/2`, '--snapshots-out', out(`${name}-${shard}.json`)).status, 0);
      return cli('--output', out(`${name}.json`), '--merge', out(`${name}-1.json`), '--merge', out(`${name}-2.json`));
    };
    await writeFile(manifest, JSON.stringify({ records: chosen }));
    assert.equal(cli('--output', out('one.json')).status, 0);
    assert.equal(shardsThenMerge('merged').status, 0);
    const shards = await Promise.all([1, 2].map(async shard => JSON.parse(await readFile(out(`merged-${shard}.json`), 'utf8'))));
    assert.deepEqual(shards.map(shard => shard.snapshots[0].records.length).sort(), [1, 2]);
    assert.equal(await readFile(out('merged.json'), 'utf8'), await readFile(out('one.json'), 'utf8'));
    chosen.find(record => record.id === 'tier2-witness-persistence').expect.facets[1].present = false;
    await writeFile(manifest, JSON.stringify({ records: chosen }));
    const failed = shardsThenMerge('failed');
    assert.equal(failed.status, 1, failed.stderr);
    assert.equal(JSON.parse(await readFile(out('failed.json'), 'utf8')).records
      .find(record => record.id === 'tier2-witness-persistence').violations[0].kind, 'mechanism-control-failed');
    const refused = (args, pattern) => { const result = cli('--output', out('refused.json'), ...args);
      assert.equal(result.status, 1); assert.match(result.stderr, pattern); };
    refused(['--merge', out('failed-1.json')], /shards 1\/N to N\/N of one N, each once; got 1\/2/);
    refused(['--merge', out('failed-1.json'), '--merge', out('failed-1.json')], /each once; got 1\/2, 1\/2/);
    refused(['--width', '1500', '--merge', out('failed-1.json'), '--merge', out('failed-2.json')], /other records or another layout/);
    await writeFile(manifest, JSON.stringify({ records: chosen.slice(1) }));
    refused(['--merge', out('failed-1.json'), '--merge', out('failed-2.json')], /other records or another layout/);
    assert.match(cli('--shard', '1/2').stderr, /--shard needs --snapshots-out/);
    assert.match(cli('--shard', '3/2', '--snapshots-out', out('x.json')).stderr, /Invalid --shard 3\/2/);
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

test('a fixture the change adds is compared by motion only, never one the base already has', async () => {
  const { allowAddedFixtures } = await import('../scripts/compareReplayCorpus.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const pathModule = await import('node:path');
  const base = mkdtempSync(pathModule.join(tmpdir(), 'corpus-base-')), head = mkdtempSync(pathModule.join(tmpdir(), 'corpus-head-'));
  for (const root of [base, head]) { mkdirSync(pathModule.join(root, 'fixtures'), { recursive: true }); writeFileSync(pathModule.join(root, 'fixtures', 'old.json'), '{}'); }
  writeFileSync(pathModule.join(head, 'fixtures', 'new.json'), '{}');
  const records = allowAddedFixtures([
    { id: 'old', source: pathModule.join(head, 'fixtures', 'old.json'), allow: {} },
    { id: 'new', source: pathModule.join(head, 'fixtures', 'new.json'), allow: {} },
    { id: 'outside', source: pathModule.join(tmpdir(), 'elsewhere.json'), allow: {} }], base, head);
  assert.deepEqual(records.map(record => Boolean(record.allow.replay)), [false, true, false]);
  assert.match(records[1].allow.reason, /new in this change/);
  assert.equal(records[1].allow.completedWidthGrowth, true);
});
