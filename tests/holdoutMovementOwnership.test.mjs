import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { dispatchStageRelations } from '../replay/relations/tier2RelationDispatch.ts';

const cases = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/holdout-transitions.json', import.meta.url)));
const fixture = id => structuredClone(cases.find(c => c.id === id));
const recover = (c, index) => recoverMovementEvidence(c.derivationStages[1].relations[index],
  c.derivationStages[1].workspaceForest, c.derivationStages[0].workspaceForest);
const find = (forest, id) => {
  for (const node of forest) {
    if (node.id === id) return node;
    const match = find(node.children ?? [], id);
    if (match) return match;
  }
};

for (const [id, movementIndex, laterIndex, trace] of [
  ['successive-trace', 0, 2, 'tEdge'], ['raising-completion', 1, 2, 'matrixSubjectTrace']
]) test(`${id}: a completed-chain claim cannot take ownership of a new lower witness`, () => {
  const c = fixture(id), original = structuredClone(c);
  assert.equal(recover(c, movementIndex).movement?.transition, true);
  assert.ok(!recover(c, laterIndex).movement?.transition);
  const steps = prepareReplay({ ...c, includePlayback: true }).playbackSteps;
  const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1
    && s.replayRelationIdentity.relationIndex === movementIndex);
  assert(moment > 0);
  assert(!steps[moment - 1].replayVisibleNodeIds.includes(trace));
  assert(steps[moment].replayVisibleNodeIds.includes(trace));
  const later = steps.find(s => s.replayRelationIdentity?.stageIndex === 1
    && s.replayRelationIdentity.relationIndex === laterIndex);
  assert(later.replayVisibleNodeIds.includes(trace));
  assert.deepEqual(c, original);
});

for (const rebuiltIds of [['eCP'], ['eCP', 'mVbar']]) test(`rebuilt ${rebuiltIds.join(' and ')} retains lower-trace ownership in its unchanged ancestor slot`, () => {
  const c = fixture('successive-trace');
  for (const id of rebuiltIds) find(c.derivationStages[1].workspaceForest, id).id = `rebuilt-${id}`;
  assert.equal(recover(c, 0).movement?.transition, true);
  assert.equal(recover(c, 2).failure, 'MOVEMENT_TARGET_IS_LOWER_WITNESS');
  const steps = prepareReplay({ ...c, includePlayback: true }).playbackSteps;
  const moment = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1
    && step.replayRelationIdentity.relationIndex === 0);
  assert(moment > 0);
  assert(!steps[moment - 1].replayVisibleNodeIds.includes('tEdge'));
  assert(steps[moment].replayVisibleNodeIds.includes('tEdge'));
});

test('a lexical member inside a moved head complex is not mistaken for an unmoved lower witness', () => {
  // Reduced topology of expansion-german-concord: verbI becomes verbC inside
  // the moved inflComplex/inflC, retaining its sister but changing clause slot.
  const node = (id, label, children = [], lineageId) => ({ id, label, children, ...(lineageId ? { lineageId } : {}) });
  const features = node('inflFeatures', 'I [finite, present, indicative, 3PL]');
  const verbTrace = node('verbTrace', 'V (head trace)', [], 'verbChain');
  const vp = node('vp', 'VP', [node('experiencer', 'DP'), node('vbar', 'V′', [node('themeTrace', 'DP'), verbTrace])]);
  const inflection = (id, member) => node(id, 'I', [node(member, 'V', [], 'verbChain'), features], 'inflChain');
  const clause = head => node('ip', 'IP', [node('subjectIP', 'DP'), node('ibar', 'I′', [vp, head])]);
  const prior = [clause(inflection('inflComplex', 'verbI'))];
  const current = [node('cp', 'CP', [node('cbar', 'C′', [
    node('cHead', 'C', [inflection('inflC', 'verbC')]),
    clause(node('inflTrace', 'I (head trace)', [], 'inflChain'))
  ])])];
  const relation = {
    relation: 'Successive head chain',
    anchors: { basePosition: 'verbTrace', intermediatePosition: 'inflTrace', lexicalHead: 'verbC' },
    values: { headMovementConstraint: 'satisfied by successive movement through I' }
  };
  const movement = recoverMovementEvidence(relation, current, prior).movement;
  assert.equal(movement?.sourceNodeId, 'verbTrace');
  assert.equal(movement?.targetNodeId, 'verbC');
  assert.equal(movement?.transition, true);
});

test('a chain extension uses its explicit preceding occurrence, retaining earlier chain members', () => {
  const c = fixture('raising-hop');
  const movement = recover(c, 0).movement;
  assert.equal(movement?.sourceNodeId, 'embeddedSubjectTrace');
  assert.equal(movement?.targetNodeId, 'matrixSubjectDP');
  assert.equal(movement?.priorSourceNodeId, 'embeddedSubjectDP');
  assert.equal(movement?.transition, true);
  const steps = prepareReplay({ ...c, includePlayback: true }).playbackSteps;
  const moment = steps.find(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === 0);
  assert(moment.replayVisibleNodeIds.includes('embeddedSubjectTrace'));
  assert(moment.replayVisibleNodeIds.includes('matrixSubjectDP'));
  assert(moment.replayVisibleNodeIds.includes('objectTrace'));
});

for (const id of ['covert-object-low', 'covert-object-high']) test(`${id}: a contained operator does not compete with its explicit landing occurrence`, () => {
  const c = fixture(id), original = structuredClone(c);
  const movement = recover(c, 0).movement;
  assert.equal(movement?.sourceNodeId, 'ok');
  assert.equal(movement?.targetNodeId, 'okh');
  assert.equal(movement?.transition, true);
  const dispatch = dispatchStageRelations(c.derivationStages)[1][0];
  assert(dispatch.claims.some(claim => claim.tier === 2 && claim.facet.recipe.id === 'scope.movement'));
  assert.deepEqual(c, original);
  c.derivationStages[1].relations[0].anchors.operator = 'sqh';
  assert.equal(recover(c, 0).movement, undefined, 'an unrelated competing operator stays ambiguous');
});

for (const id of ['head-trace', 'complex-head-trace']) test(`${id}: synonymous trace witness roles resolve the exact head-movement signature`, () => {
  const c = fixture(id);
  const result = dispatchStageRelations(c.derivationStages)[1][0];
  assert(result.claims.some(claim => claim.tier === 1 && claim.registryEntryId === 'trajectory.head'),
    JSON.stringify(result.tier1Dispatch.signatureIssues));
});
