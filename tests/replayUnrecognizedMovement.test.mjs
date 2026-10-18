import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkAttachAtMerge, checkNoEarlyReveal, checkParentAfterChildren, frameStructure } from './helpers/replayInvariants.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/unrecognized-movement.json', import.meta.url), 'utf8'));
const prepared = new Map();
const replay = index => {
  if (!prepared.has(index)) prepared.set(index, prepareReplay({ ...structuredClone(fixture.cases[index]), includePlayback: true }));
  return prepared.get(index);
};
const play = index => replay(index).playbackSteps;
const moment = (steps, stageIndex, relationIndex) => {
  const index = steps.findIndex(step => step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === stageIndex
    && step.replayRelationIdentity.relationIndex === relationIndex);
  assert.ok(index >= 0, `relation ${stageIndex}:${relationIndex} has a moment`);
  return index;
};
const firstShown = (steps, id) => steps.findIndex(step => frameStructure(step).displayed.has(id));
const node = (step, id) => {
  const visit = candidate => candidate.id === id ? candidate : candidate.children?.map(visit).find(Boolean);
  return visit(step.replayCanvasData);
};
const describeStep = (steps, index) => `frame ${index + 1} (${steps[index]?.replayKind} ${steps[index]?.operation} ${steps[index]?.targetNodeId})`;

/** Each displaced occurrence and new parent first appears at its claim's moment. */
const assertIntroducedAt = (steps, at, ids) => ids.forEach(id => assert.equal(firstShown(steps, id), at,
  `${id} first appears at ${describeStep(steps, firstShown(steps, id))}, not its moment ${describeStep(steps, at)}`));
/** An ordinary node first appears at a construction step that builds it. */
const assertBuiltByOwnStep = (steps, id) => {
  const index = firstShown(steps, id), step = steps[index];
  assert.equal(step?.replayKind, 'micro', `${id} first appears at ${describeStep(steps, index)}`);
  assert.ok([id, `${id}::__leaf`].includes(step.targetNodeId), `${id} first appears at ${describeStep(steps, index)}`);
};
const assertStageRecordAddsNothing = (steps, stageIndex) => {
  const record = steps.findLastIndex(step => step.replayFrameIndex === stageIndex);
  assert.equal(steps[record].operation, 'StageRecord');
  const before = frameStructure(steps[record - 1]), after = frameStructure(steps[record]);
  assert.deepEqual([...after.displayed].filter(id => !before.displayed.has(id)), [], `stage ${stageIndex + 1}'s record adds no syntax`);
  assert.deepEqual([...after.displayed].filter(id => before.parent.get(id) !== after.parent.get(id)), [], `stage ${stageIndex + 1}'s record attaches nothing`);
};

test('every case satisfies the construction invariants that flagged it', () => {
  fixture.cases.forEach((_case, index) => {
    const prepared = replay(index);
    assert.deepEqual([...checkNoEarlyReveal(prepared), ...checkAttachAtMerge(prepared), ...checkParentAfterChildren(prepared)]
      .map(violation => `${violation.rule} @${violation.frame}: ${violation.detail}`), [], `case ${index + 1}`);
  });
});

test('a copy related to its earlier occurrence by a claim with unfamiliar names appears at that claim\'s moment', () => {
  const steps = play(0), at = moment(steps, 2, 0);
  assertIntroducedAt(steps, at, ['rSubjectHigh', 'rTP']);
  const before = steps.slice(0, at).filter(step => step.replayFrameIndex === 2);
  assert.deepEqual(before.map(step => `${step.operation} ${step.targetNodeId}`), ['LexicalSelect rT', 'ExternalMerge rTDomain']);
  for (const step of before) assert.notEqual(node(step, 'rSubjectBase').silent, true, 'the earlier occurrence keeps its word until the moment');
  assert.equal(node(steps[at], 'rSubjectBase').silent, true);
  const structure = frameStructure(steps[at]);
  assert.equal(structure.parent.get('rSubjectHigh'), 'rTP');
  assert.equal(structure.parent.get('rTDomain'), 'rTP', 'the new TP attaches the copy above the existing T′');
  assertStageRecordAddsNothing(steps, 2);
});

test('a head complex whose claim lists contained heads appears at its moment, not at an unrelated selection', () => {
  const steps = play(1), at = moment(steps, 8, 1);
  assertIntroducedAt(steps, at, ['mTHeadAtC', 'mvHeadAtC', 'mVAtC', 'mvAtC', 'mTAtC', 'mCHead', 'mCP']);
  assertBuiltByOwnStep(steps, 'mC');
  assertStageRecordAddsNothing(steps, 8);
});

test('a pied-piped phrase appears at its claim\'s moment at each edge', () => {
  const steps = play(2);
  assertIntroducedAt(steps, moment(steps, 3, 0), ['pp1', 'p1', 'wh1', 'vEdge']);
  assertIntroducedAt(steps, moment(steps, 7, 0), ['pp2', 'p2', 'cpRel']);
  // The recognized operator-variable claim owns the operator's own copy.
  assertIntroducedAt(steps, moment(steps, 7, 1), ['wh2']);
  [3, 7].forEach(stage => assertStageRecordAddsNothing(steps, stage));
});

test('a fronted copy outside the rewritten trace appears at its claim\'s moment, not at the Stage Record', () => {
  const steps = play(3), at = moment(steps, 2, 0);
  assertIntroducedAt(steps, at, ['frontedObject', 'frontedObjectDbar', 'frontedObjectD', 'objectTrace']);
  assertStageRecordAddsNothing(steps, 2);
});

test('a shared occurrence appears whole with its new parent, and the other merge stays ordinary', () => {
  const steps = play(4), at = moment(steps, 1, 1);
  assertIntroducedAt(steps, at, ['object-sell', 'the-sell', 'house-sell', 'vp-sell']);
  assertBuiltByOwnStep(steps, 'vp-buy');
  assert.ok(firstShown(steps, 'vp-buy') < at);
  assertStageRecordAddsNothing(steps, 1);
});

test('an occurrence that keeps its id reaches its landing at the rewrite moment, inside a root merged by construction', () => {
  const steps = play(5), at = moment(steps, 1, 1);
  for (const step of steps.slice(0, at).filter(step => step.replayFrameIndex === 1))
    assert.equal(frameStructure(step).parent.get('bObject'), 'bVBar', 'the object stays at its source until the moment');
  assert.equal(frameStructure(steps[at]).parent.get('bObject'), 'bVP');
  assertIntroducedAt(steps, at, ['bObjectTrace']);
  ['bBaBar', 'bBaP'].forEach(id => assertBuiltByOwnStep(steps, id));
  assertStageRecordAddsNothing(steps, 1);
});

test('unanchored construction in a rewrite stage keeps its own steps', () => {
  const applicative = play(6);
  ['aD', 'aNom', 'aBenef'].forEach(id => assertBuiltByOwnStep(applicative, id));
  assertStageRecordAddsNothing(applicative, 1);
  const pseudogapping = play(7);
  ['a_and', 'a_coord_projection', 'a_coordination'].forEach(id => assertBuiltByOwnStep(pseudogapping, id));
  assertStageRecordAddsNothing(pseudogapping, 6);
});
