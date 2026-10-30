import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkNoEarlyReveal, checkParentAfterChildren, checkRelationMoments, frameStructure } from './helpers/replayInvariants.mjs';
import { checkMarkPersistence, checkStepSemantics } from './helpers/replayStepInvariants.mjs';
import { canonicalId } from './helpers/canonicalIds.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/claim-beside-movement.json', import.meta.url), 'utf8'));
const replay = prepareReplay({ ...structuredClone(fixture), includePlayback: true }), steps = replay.playbackSteps;
const moment = relationIndex => steps.findIndex(step => step.replayKind === 'relation'
  && step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === relationIndex);
const firstShown = id => steps.findIndex(step => frameStructure(step).displayed.has(id));

test('a claim naming a moved subject leaves the matrix clause to construction and the subject to its movement (04-en-raising-control-mix)', () => {
  for (const id of ['aSeems', 'aSeemsVP', 'aFiniteI', 'aMatrixIbar', 'aRootCP']) {
    const step = steps[firstShown(id)];
    assert.equal(step.replayKind, 'micro', `${id} first appears at its own construction step, not at ${step.replayKind} ${step.operation}`);
    assert.ok([id, `${id}::__leaf`].includes(step.targetNodeId), `${id} first appears at the step that builds it`);
  }
  // The landing the model let keep "aCommittee" and its new trace, under Replay's ids.
  const movement = moment(1), landing = frameStructure(steps[movement]), id = name => canonicalId(replay, name, 1);
  assert.deepEqual(landing.children.get('aMatrixIP'), [id('aCommittee'), 'aMatrixIbar'], 'the subject lands beside the matrix I′');
  assert.equal(landing.parent.get(id('aCommitteeTrace')), 'aPerfectIP');
  assert.ok(firstShown('aSeems') < moment(0), 'raising selection plays once seems exists');
  const licensing = moment(2), before = frameStructure(steps[licensing - 1]), after = frameStructure(steps[licensing]);
  assert.deepEqual([...after.displayed].filter(id => !before.displayed.has(id)), [], 'the licensing claim adds no syntax');
  assert.deepEqual([...checkParentAfterChildren(replay), ...checkNoEarlyReveal(replay), ...checkRelationMoments(replay, fixture),
    ...checkStepSemantics(replay, fixture), ...checkMarkPersistence(replay, fixture)], []);
});
