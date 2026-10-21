import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

// Normalization keeps authored node keys outside the contract, authored key
// order and padded relation names. Replay reads the contract projection, so
// none of them may change a claim. The plan once dispatched the raw record and
// lost or replaced movement drawings that Replay still played as movements.
const load = (file, select = record => record) =>
  select(JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8')));
const scrambling = { record: load('movement/clause-context.json', document => document.cases[3]), stageIndex: 1, relationIndex: 0 };
const prefield = { record: load('replay-regressions/relocated-plaque-anchor.json'), stageIndex: 3, relationIndex: 0 };

const mapNodes = (forest, mapNode) => forest.map(function visit(node) {
  const children = Array.isArray(node.children) ? node.children.map(visit) : undefined;
  const { children: _children, ...fields } = node;
  return mapNode(fields, children);
});
const inAlternateStages = (stages, mapStage) => stages.map((stage, stageIndex) => stageIndex % 2 ? mapStage(stage) : stage);
const withNodes = mapNode => stage => ({ ...stage, workspaceForest: mapNodes(stage.workspaceForest, mapNode) });
const cases = [
  ['an ignored node key', scrambling, withNodes((fields, children) => ({ ...fields, note: 'checked', ...(children ? { children } : {}) }))],
  ['reordered node keys', prefield, withNodes((fields, children) =>
    Object.fromEntries([...Object.entries(fields).reverse(), ...(children ? [['children', children]] : [])]))],
  ['padded relation names', scrambling, stage => ({
    ...stage, relations: stage.relations.map(relation => ({ ...relation, relation: ` ${relation.relation} ` }))
  })]
];

const prepare = (record, derivationStages = record.derivationStages) => prepareReplay({
  derivationStages, sentence: record.sentence, inputTokens: record.inputTokens, includePlayback: true });

const assertMovementAgreement = (prepared, { stageIndex, relationIndex }) => {
  const claimItems = prepared.relationRenderPlan.frames[stageIndex].items.filter(item =>
    item.relationRef.stageIndex === stageIndex && item.relationRef.relationIndex === relationIndex);
  const trajectory = claimItems.find(item => item.kind === 'trajectory');
  assert.equal(trajectory?.tier2FacetId, 'movement.path');
  assert.ok(!claimItems.some(item => item.kind === 'coindex'));
  const link = prepared.committedDerivationVisualLinks.find(candidate =>
    candidate.authoredRelationKey === `${stageIndex}:${relationIndex}` && candidate.movementTransition);
  assert.ok(link, 'Replay plays the claim as a movement');
  assert.deepEqual([link.sourceNodeId, link.targetNodeId], [trajectory.sourceNodeId, trajectory.targetNodeId]);
};

for (const [name, claim, mapStage] of cases) {
  test(`${name} in alternate stages leaves the plan and Replay unchanged`, () => {
    const original = prepare(claim.record);
    assertMovementAgreement(original, claim);
    const stages = inAlternateStages(claim.record.derivationStages, mapStage);
    const prepared = prepare(claim.record, stages);
    assertMovementAgreement(prepared, claim);
    assert.deepEqual(prepared.relationRenderPlan, original.relationRenderPlan);
    assert.deepEqual(prepared.playbackSteps, original.playbackSteps);
    assert.deepEqual(compileRelationRenderPlan(stages), original.relationRenderPlan);
  });
}
