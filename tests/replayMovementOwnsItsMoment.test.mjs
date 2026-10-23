import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { planItemRelationRefs } from '../replay/relations/renderPlan.ts';
import { checkMovementUnrendered } from './helpers/replayContractWarnings.mjs';
import { frameStructure } from './helpers/replayInvariants.mjs';
import { checkStepSemantics } from './helpers/replayStepInvariants.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../fixtures/replay-regressions/${name}.json`, import.meta.url), 'utf8'));
const prepare = record => prepareReplay({ ...structuredClone(record), includePlayback: true });
const momentOf = (steps, stage, relation) => steps.findIndex(step => step.replayKind === 'relation'
  && step.replayRelationIdentity.stageIndex === stage && step.replayRelationIdentity.relationIndex === relation);
const paths = (step, key) => (step.replayRelationLinks ?? []).filter(link => link.renderFamily === 'trajectory' && link.authoredRelationKey === key)
  .map(link => `${link.sourceNodeId}>${link.targetNodeId}`).sort();
const planPaths = (replay, stage, relation) => (replay.relationRenderPlan.frames[stage]?.items ?? []).filter(item => item.kind === 'trajectory'
  && planItemRelationRefs(item).some(ref => ref.stageIndex === stage && ref.relationIndex === relation))
  .map(item => `${item.sourceNodeId}>${item.targetNodeId}`).sort();

test('a movement introduces its landing and path at its own moment when a later claim recovers movement into that landing', () => {
  const fixture = read('landing-claimed-again'), replay = prepare(fixture), steps = replay.playbackSteps;
  const moment = momentOf(steps, 11, 0), chain = momentOf(steps, 11, 1);
  assert.equal(chain, moment + 1, 'the chain claim is the next moment');
  const before = frameStructure(steps[moment - 1]), at = frameStructure(steps[moment]);
  assert.equal(before.displayed.has('who4'), false);
  assert.equal(before.displayed.has('mcbar'), false);
  assert.notEqual(before.nodes.get('who3').data.silent, true, 'the source keeps its pronunciation before the moment');
  assert.equal(at.parent.get('who4'), 'mCP');
  assert.equal(at.parent.get('mcbar'), 'mCP');
  assert.equal(at.parent.get('mTP'), 'mcbar');
  assert.equal(at.nodes.get('who3').data.silent, true);
  assert.deepEqual(paths(steps[moment], '11:0'), ['who3>who4']);
  assert.equal(frameStructure(steps[chain]).key, at.key, 'the chain claim adds no syntax');
  assert.deepEqual(paths(steps[chain], '11:1'), ['who1>who4', 'who2>who4']);
  assert.deepEqual(checkStepSemantics(replay, fixture), []);
});

test('a displacement is read from structure, whatever its claim calls its fields', () => {
  // The Hungarian subject topicalization names its occurrences topic,
  // intermediateTrace and movingNP. No wording proves movement; the stage
  // difference does: d_pi keeps its id and slot, and its new copy d_ptop lands
  // in the topic phrase.
  const { cases: [fixture] } = read('unnamed-movement-roles'), replay = prepare(fixture), steps = replay.playbackSteps;
  const moment = momentOf(steps, 2, 0), at = frameStructure(steps[moment]), before = frameStructure(steps[moment - 1]);
  assert.equal(before.displayed.has('d_ptop'), false);
  assert.equal(at.parent.get('d_ptop'), 'd_topp');
  assert.equal(at.nodes.get('d_pi').data.silent, true);
  assert.deepEqual(planPaths(replay, 2, 0), ['d_pi>d_ptop']);
  assert.deepEqual(paths(steps[moment], '2:0'), ['d_pi>d_ptop']);
  assert.deepEqual(steps[moment].movementDiagnostics ?? [], []);
  assert.deepEqual(checkMovementUnrendered(replay, fixture), []);
});

test('listed landings pair with the listed sources they command, including occurrences of one shared lineage', () => {
  const { cases: [, fixture] } = read('unnamed-movement-roles'), replay = prepare(fixture), steps = replay.playbackSteps;
  const edges = momentOf(steps, 3, 0), subjects = momentOf(steps, 5, 0);
  assert.deepEqual(paths(steps[edges], '3:0'), ['whatObject>whatBuyEdge', 'whatSellObject>whatSellEdge']);
  assert.deepEqual(planPaths(replay, 3, 0), ['whatObject>whatBuyEdge', 'whatSellObject>whatSellEdge']);
  assert.deepEqual(steps[edges].movementDiagnostics ?? [], [], 'the copies are no longer ambiguous');
  assert.deepEqual(paths(steps[subjects], '5:0'), ['john>johnSubject', 'mary>marySubject']);
  for (const [moment, landings] of [[edges, ['whatBuyEdge', 'whatSellEdge']], [subjects, ['johnSubject', 'marySubject']]]) {
    const before = frameStructure(steps[moment - 1]), at = frameStructure(steps[moment]);
    landings.forEach(id => assert.equal(before.displayed.has(id), false, `${id} waits for its moment`));
    landings.forEach(id => assert.equal(at.displayed.has(id), true, `${id} appears at its moment`));
  }
  assert.deepEqual(checkMovementUnrendered(replay, fixture), [],
    'the shared identity of stage 2 names a new pronounced occurrence but displaces none');
});
