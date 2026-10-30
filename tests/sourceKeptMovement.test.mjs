// A movement hop whose lower occurrence keeps the continuing id (the form
// Babel gives every hop) plays like one whose landing keeps it: the trace the
// movement leaves is the movement's own change, and a pending movement still
// restores its source until its moment.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkMovementShownAsMovement, checkNoEarlyReveal, checkWholeParent, movementPresentations } from './helpers/replayInvariants.mjs';
import { checkMovementUnrendered } from './helpers/replayContractWarnings.mjs';

const { cases } = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/source-kept-movement.json', import.meta.url), 'utf8'));
const prepare = record => prepareReplay({ ...structuredClone(record), includePlayback: true });
const faults = (replay, record) => [...checkWholeParent(replay), ...checkNoEarlyReveal(replay),
  ...checkMovementShownAsMovement(replay, record)].map(fault => `${fault.rule}@${fault.frame}: ${fault.detail}`);

test('a claim naming a source-kept trace in its prior anchors leaves the matrix clause to construction', () => {
  const record = cases[0], replay = prepare(record), steps = replay.playbackSteps;
  assert.deepEqual(faults(replay, record), []);
  const at = id => steps.findIndex(step => step.replayVisibleNodeIds?.includes(id));
  const movement = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 1);
  // seems, I and I′ are selected and merged before the raising moment, as for the landing-kept form.
  for (const id of ['aSeems', 'aFiniteI', 'aMatrixIbar'])
    assert.ok(at(id) >= 0 && at(id) < movement, `${id} is built before the movement (frame ${at(id) + 1}, movement ${movement + 1})`);
  assert.equal(steps[at('aSeems')].operation, 'Project');
});

test('a pending phrasal movement whose source keeps its id restores that source until its own moment', () => {
  const record = cases[1], replay = prepare(record);
  assert.deepEqual(faults(replay, record), []);
  const shown = movementPresentations(replay, record).map(({ landing, shown, trajectory }) => ({ landing, shown, trajectory }));
  assert.deepEqual(shown.sort((a, b) => a.landing.localeCompare(b.landing)), [
    { landing: 'contentTrace', shown: true, trajectory: true },
    { landing: 'mVerbTrace', shown: true, trajectory: true }
  ]);
});

test('a source-kept hop is recognized when its landing field is not a landing role or its chain restates earlier occurrences', () => {
  for (const [index, landing] of [[2, 'e_shetr'], [3, 'pp_goal_c2']]) {
    const record = cases[index], replay = prepare(record);
    assert.deepEqual(faults(replay, record), [], `case ${index}`);
    assert.deepEqual(checkMovementUnrendered(replay, record).map(warning => warning.detail), [], `case ${index}`);
    assert.deepEqual(movementPresentations(replay, record).map(({ landing, shown, trajectory }) => ({ landing, shown, trajectory })),
      [{ landing, shown: true, trajectory: true }], `case ${index}`);
  }
});

// A claim naming a chain's old foot beside its new top restates the chain: it
// proves the stage's hop only through the chain's head, as when the landing
// keeps the id (both fixtures were authored that way; Replay reads them source-kept).
const fixture = (file, pointer = '') => {
  const document = JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8'));
  return pointer.split('/').filter(Boolean).reduce((value, key) => value[key], document);
};
const arrowClaims = (replay, stageIndex) => [...new Set(replay.relationRenderPlan.frames[stageIndex].items
  .filter(item => item.kind === 'trajectory').map(item => `${item.relationRef.stageIndex}:${item.relationRef.relationIndex}`))];

test('a claim pairing an earlier lower copy with the new landing draws no hop of its own', () => {
  // "proper government of wh-traces" names the object trace and the new top; only the A′-movement draws.
  assert.deepEqual(arrowClaims(prepare(fixture('movement/holdout-transitions.json', '/0')), 1), ['1:0']);
  // "interrogative operator licensing and scope" restates the stage-4 hop the A-bar movement owns.
  const replay = prepare(fixture('replay-regressions/successive-cyclic-source.json', '/cases/1'));
  assert.deepEqual(arrowClaims(replay, 3), ['1:1', '3:0']);
  assert.deepEqual(arrowClaims(replay, 5), ['1:1', '3:0', '5:0', '5:1']);
});
