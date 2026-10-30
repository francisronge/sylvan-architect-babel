// A movement hop whose lower occurrence keeps the continuing id (the form
// Babel gives every hop) plays like one whose landing keeps it: the trace the
// movement leaves is the movement's own change, and a pending movement still
// restores its source until its moment.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkMovementShownAsMovement, checkNoEarlyReveal, checkWholeParent, movementPresentations } from './helpers/replayInvariants.mjs';

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
