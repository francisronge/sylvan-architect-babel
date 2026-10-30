import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkStableConstruction, frameStructure } from './helpers/replayInvariants.mjs';
import { canonicalId } from './helpers/canonicalIds.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/kept-id-landing.json', import.meta.url), 'utf8'));

const stageSteps = (steps, stageIndex) => steps.map((step, index) => ({ step, index })).filter(({ step }) => step.replayFrameIndex === stageIndex);

// The fixture's landings keep 太郎's id (a-taro-np); Replay gives that id to the
// lower occurrence and the authored trace's id to the landing.
const assertSourceUntilMoment = (replay, { stageIndex, relationIndex, source, landingParent, trace }) => {
  const steps = replay.playbackSteps, stage = stageSteps(steps, stageIndex);
  const prior = canonicalId(replay, 'a-taro-np', stageIndex - 1), landing = canonicalId(replay, 'a-taro-np', stageIndex);
  const lower = canonicalId(replay, trace, stageIndex), fresh = landing === prior ? lower : landing;
  const moment = stage.find(({ step }) => step.replayKind === 'relation' && step.replayRelationIdentity?.relationIndex === relationIndex);
  assert.ok(moment, `stage ${stageIndex + 1} has its rewrite moment`);
  const before = stage.filter(({ index }) => index < moment.index);
  assert.ok(before.length > 0, 'construction precedes the moment');
  for (const { step, index } of before) {
    const frame = frameStructure(step);
    assert.equal(frame.parent.get(prior), source, `frame ${index + 1}: 太郎 stays at its source`);
    assert.equal(frame.displayed.has(fresh), false, `frame ${index + 1}: the new occurrence waits for the moment`);
  }
  const at = frameStructure(moment.step);
  assert.equal(at.parent.get(landing), landingParent, 'the moment places the landing under its new parent');
  assert.equal(at.parent.get(lower), source, 'the moment leaves the trace at the source');
  const rootOf = id => { while (at.parent.get(id)) id = at.parent.get(id); return id; };
  assert.equal(rootOf(landing), rootOf(source), 'the moment attaches the landing to the syntax that held its source');
  return { before, at };
};

const assertNoTimingConflict = steps => assert.deepEqual(steps.flatMap(step => (step.movementDiagnostics ?? [])
  .filter(diagnostic => diagnostic.startsWith('RELATION_TIMING_CONFLICT'))), []);

test('an occurrence that keeps its id at the landing stays at its source until its rewrite moment', () => {
  const replay = prepareReplay({ ...structuredClone(fixture), includePlayback: true });
  const raising = assertSourceUntilMoment(replay,
    { stageIndex: 2, relationIndex: 0, source: 'a-upper-vp', landingParent: 'a-ip', trace: 'a-subject-trace' });
  // The new IP attaches the landing above I′, so it appears with the landing.
  assert.equal(raising.before.some(({ step }) => frameStructure(step).displayed.has('a-ip')), false);
  assert.equal(raising.at.parent.get('a-ibar'), 'a-ip');
  const topicalization = assertSourceUntilMoment(replay,
    { stageIndex: 4, relationIndex: 0, source: 'a-ip', landingParent: 'a-topic-kp', trace: 'a-topic-trace' });
  // The topic KP and the CP that attaches it above C′ appear with the landing.
  for (const parent of ['a-topic-kp', 'a-cp'])
    assert.equal(topicalization.before.some(({ step }) => frameStructure(step).displayed.has(parent)), false, `${parent} waits for the moment`);
  assert.equal(topicalization.at.parent.get('a-cbar'), 'a-cp');
  assertNoTimingConflict(replay.playbackSteps);
  assert.deepEqual(checkStableConstruction(replay), []);
});

test('the moment introduces every new parent between a kept-id landing and its source workspace', () => {
  const record = structuredClone(fixture);
  record.derivationStages = record.derivationStages.slice(0, 3);
  const ip = record.derivationStages[2].workspaceForest[0];
  ip.children[0] = { id: 'a-subject-shell', label: 'NP', children: [ip.children[0]] };
  const replay = prepareReplay({ ...record, includePlayback: true });
  const { before } = assertSourceUntilMoment(replay,
    { stageIndex: 2, relationIndex: 0, source: 'a-upper-vp', landingParent: 'a-subject-shell', trace: 'a-subject-trace' });
  assert.equal(before.some(({ step }) => ['a-subject-shell', 'a-ip'].some(id => frameStructure(step).displayed.has(id))), false);
  assertNoTimingConflict(replay.playbackSteps);
  assert.deepEqual(checkStableConstruction(replay), []);
});

test('a kept-id occurrence stays at its source even when an earlier claim needs its new parent first', () => {
  const record = structuredClone(fixture);
  record.derivationStages[2].relations.unshift({ relation: 'clause typing', anchors: { clause: 'a-ip' }, values: { type: 'declarative' } });
  const replay = prepareReplay({ ...record, includePlayback: true });
  assertSourceUntilMoment(replay, { stageIndex: 2, relationIndex: 1, source: 'a-upper-vp', landingParent: 'a-ip', trace: 'a-subject-trace' });
  assert.deepEqual(checkStableConstruction(replay), []);
});
