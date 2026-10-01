import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const node = (id, label, children = [], extra = {}) => ({ id, label, children, ...extra });
const stage = (workspaceForest, relations = []) => ({
  statement: 'Authored state', stageRecord: '', workspaceForest, relations
});
const inspect = (relation, currentForest, priorForest) => {
  const dispatch = dispatchRelationClaims({
    relation, currentForest, priorForest, stageIndex: priorForest ? 1 : 0, relationIndex: 0
  });
  const stages = [...(priorForest ? [stage(priorForest)] : []), stage(currentForest, [relation])];
  return { dispatch, items: compileRelationRenderPlan(stages).frames.at(-1).items };
};
const hasFacet = (result, id) => result.dispatch.facets.some(facet => facet.recipe.id === id);

const ellipsisForest = (silent = true) => [
  node('first-clause', 'IP', [
    node('first-i', 'I'),
    node('antecedent', 'VP', [node('first-v', 'V', [], { word: 'read' })])
  ]),
  node('second-clause', 'IP', [
    node('licensing-i', 'I', [], { word: 'did' }),
    node('elided', 'VP', [
      node('elided-v', 'V', [], { word: 'read' }),
      node('elided-object', 'DP', [node('elided-n', 'N', [], { word: 'books' })])
    ], silent ? { silent: true } : {})
  ])
];
const ellipsisRelation = (role = 'elidedVP') => ({
  relation: 'An authored relation',
  anchors: { antecedentVP: 'antecedent', [role]: 'elided', licensor: 'licensing-i' }
});

test('an explicit elided VP earns ghosting of its exact silent subtree', () => {
  const relation = ellipsisRelation();
  const forest = ellipsisForest();
  const before = structuredClone({ relation, forest });
  const result = inspect(relation, forest);
  assert(hasFacet(result, 'ellipsis.site'));
  const ghosts = result.items.filter(item => item.kind === 'ellipsis-site');
  assert.equal(ghosts.length, 1);
  assert.equal(ghosts[0].tier2FacetId, 'ellipsis.site');
  assert.deepEqual(ghosts[0].ghostNodeIds, ['elided', 'elided-v', 'elided-object', 'elided-n']);
  assert.equal(result.dispatch.primaryRelation.anchors?.licensor, 'licensing-i');
  assert(result.dispatch.claims.some(claim => claim.tier === 3
    && claim.consumedEvidence.some(ref => ref.field === 'anchors' && ref.key === 'licensor')));
  assert(!hasFacet(result, 'feature.dependency'), 'a generic licensor does not establish Case or agreement');
  assert(!result.items.some(item => item.kind === 'directed-path' || item.kind === 'trajectory'));
  assert.deepEqual({ relation, forest }, before);
});

test('an elided VP role does not ghost an overt subtree', () => {
  const result = inspect(ellipsisRelation(), ellipsisForest(false));
  assert(!hasFacet(result, 'ellipsis.site'));
  assert(!result.items.some(item => item.kind === 'ellipsis-site'));
});

test('nearby role spellings do not assert ellipsis', () => {
  for (const role of ['elidedVPContext', 'possibleElidedVP', 'VP']) {
    const result = inspect(ellipsisRelation(role), ellipsisForest());
    assert(!hasFacet(result, 'ellipsis.site'), role);
    assert(!result.items.some(item => item.kind === 'ellipsis-site'), role);
  }
});

const occurrence = (id, silent = false) => node(id, 'DP', [], {
  word: 'which', lineageId: 'object', ...(silent ? { silent: true } : {})
});
const movementForest = moved => [node('cp', 'CP', [
  ...(moved ? [occurrence('upper')] : []),
  node('cbar', 'C′', [
    node('c', 'C', [], { word: 'that' }),
    node('tp', 'TP', [
      node('t', 'T'),
      node('vp', 'VP', [node('v', 'V', [], { word: 'read' }), occurrence('lower', moved)])
    ])
  ])
])];

test('movement to a clause edge does not independently assert a phase edge', () => {
  const relation = {
    relation: 'An authored relation',
    anchors: { edge: 'upper', lower: 'lower' },
    priorAnchors: { source: 'lower' }
  };
  const result = inspect(relation, movementForest(true), movementForest(false));
  const paths = result.items.filter(item => item.kind === 'trajectory');
  assert.equal(paths.length, 1);
  assert.equal(paths[0].sourceNodeId, 'lower');
  assert.equal(paths[0].targetNodeId, 'upper');
  assert(!hasFacet(result, 'phase.edge'));
  assert(!result.items.some(item => item.domainStyle === 'transfer-edge'));
});

test('an explicit phase-edge role preserves its existing outline', () => {
  const relation = { relation: 'An authored relation', anchors: { phaseEdge: 'upper' } };
  const result = inspect(relation, movementForest(true));
  assert(hasFacet(result, 'phase.edge'));
  const outlines = result.items.filter(item => item.domainStyle === 'transfer-edge');
  assert.equal(outlines.length, 1);
  assert.equal(outlines[0].rootNodeId, 'upper');
  assert.deepEqual(outlines[0].memberNodeIds, ['upper']);
});

test('a phase anchor qualifies its explicitly associated edge', () => {
  const relation = { relation: 'An authored relation', anchors: { phase: 'cp', edge: 'upper' } };
  const result = inspect(relation, movementForest(true));
  assert(hasFacet(result, 'phase.edge'));
  const outlines = result.items.filter(item => item.domainStyle === 'transfer-edge');
  assert.equal(outlines.length, 1);
  assert.equal(outlines[0].rootNodeId, 'upper');
});

test('a similar phase-edge field does not earn an outline', () => {
  const relation = { relation: 'An authored relation', anchors: { phaseEdgeComment: 'upper' } };
  const result = inspect(relation, movementForest(true));
  assert(!hasFacet(result, 'phase.edge'));
  assert(!result.items.some(item => item.domainStyle === 'transfer-edge'));
});
