import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';

const cases = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/clause-context.json', import.meta.url))).cases;
const expected = [
  ['miaTrace', 'miaNP'], ['subjectTrace', 'subjectNP'], ['contentTrace', 'embeddedCP'],
  ['matrixObject', 'scrambledObject'], ['journalistDP0', 'journalistDP1'], ['journalistDP1', 'journalistDP2'],
  ['reportDP1', 'reportDP2'], ['objectTrace', 'whNP'], ['cpTrace', 'whNP']
];
const nodes = node => [node, ...(node.children ?? []).flatMap(nodes)];
const find = (forest, id) => forest.flatMap(nodes).find(node => node.id === id);
const parent = (forest, id) => forest.flatMap(nodes).find(node => node.children?.some(child => child.id === id));

for (const [index, record] of cases.entries()) {
  test(`saved movement keeps its exact occurrence pair: ${record.name}`, () => {
    const original = structuredClone(record);
    const [previous, current] = record.derivationStages;
    const relation = current.relations[record.relationIndex];
    const input = { relation, priorForest: previous.workspaceForest, currentForest: current.workspaceForest, stageIndex: 1, relationIndex: record.relationIndex };
    const movement = recoverMovementEvidence(relation, input.currentForest, input.priorForest).movement;
    assert.deepEqual([movement?.sourceNodeId, movement?.targetNodeId], expected[index]);
    assert.equal(movement.trajectoryKind, 'phrasal');
    assert.equal(movement.transition, true);
    const dispatch = dispatchRelationClaims(input);
    assert.ok(dispatch.facets.some(facet => facet.recipe.id === 'movement.path'));
    for (const key of ['target', 'targetHead', 'lowestTrace', 'sourceClause']) {
      const id = relation.anchors[key];
      if (!id || id === movement.sourceNodeId || id === movement.targetNodeId) continue;
      const field = dispatch.evidenceCoverage.fields.find(field => field.field === 'anchors' && field.key === key);
      assert.ok(!field.recognizedBy.some(claim => claim.claim === 'movement.path'), `${key} is not consumed by movement`);
      assert.ok(!movement.context?.some(context => context.key === key), `${key} does not invent movement context`);
    }
    const replay = prepareReplay({ ...record, includePlayback: true });
    const momentIndex = replay.playbackSteps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1
      && step.replayRelationIdentity.relationIndex === record.relationIndex);
    assert.ok(momentIndex > 0);
    const before = replay.playbackSteps[momentIndex - 1], moment = replay.playbackSteps[momentIndex];
    const priorSource = find(previous.workspaceForest, movement.priorSourceNodeId);
    assert.equal(parent([before.replayCanvasData], movement.priorSourceNodeId)?.id,
      parent(previous.workspaceForest, movement.priorSourceNodeId)?.id);
    assert.deepEqual(find([before.replayCanvasData], movement.priorSourceNodeId)?.children?.map(node => node.id), priorSource.children?.map(node => node.id));
    assert.equal(parent([moment.replayCanvasData], movement.targetNodeId)?.id,
      parent(current.workspaceForest, movement.targetNodeId)?.id);
    assert.equal(moment.replayRelationLinks.filter(link => link.authoredRelationKey === `1:${record.relationIndex}`
      && link.trajectoryKind === 'phrasal' && link.sourceNodeId === movement.sourceNodeId && link.targetNodeId === movement.targetNodeId).length, 1);
    assert.deepEqual(record, original);
  });
}

test('the island verdict follows the completed attempted movement without owning a second transition', () => {
  const record = cases.find(record => record.name === 'english-island-4');
  const replay = prepareReplay({ ...record, includePlayback: true });
  const move = replay.playbackSteps.find(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 1);
  const verdict = replay.playbackSteps.find(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 2);
  assert.ok(move && verdict);
  assert.deepEqual(move.replayCanvasData, verdict.replayCanvasData);
  assert.deepEqual(move.replayVisibleNodeIds, verdict.replayVisibleNodeIds);
  assert.equal(verdict.replayRelationLinks.filter(link => link.trajectoryKind === 'phrasal'
    && link.sourceNodeId === 'cpTrace' && link.targetNodeId === 'whNP').length, 1);
  assert.ok(verdict.replayRelationLinks.some(link => link.authoredRelationKey === '1:1'
    && link.sourceNodeId === 'cpTrace' && link.targetNodeId === 'whNP'));
});
