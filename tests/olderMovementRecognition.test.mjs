import assert from 'node:assert/strict';
import test from 'node:test';
import { readCategoryLabel } from '../replay/categoryLabel.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const leaf = (id, label, extra = {}) => ({ id, label, children: [], ...extra });
const branch = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const stages = input => [input.priorForest, input.currentForest].map((workspaceForest, i) => ({
  statement: 'Authored state', stageRecord: '', workspaceForest, relations: i ? [input.relation] : []
}));
const recover = input => recoverMovementEvidence(input.relation, input.currentForest, input.priorForest);
const dispatch = input => dispatchRelationClaims({ ...input, stageIndex: 1, relationIndex: 0 });

const zeroLevelHead = () => {
  const source = leaf('v_base', 'V°', { word: 'read', lineageId: 'verb' });
  const host = leaf('i_core', 'I°', { silent: true });
  const priorForest = [branch('ip', 'IP', [branch('ibar', 'I′', [host, branch('vp', 'VP', [source])])])];
  const currentForest = [branch('ip', 'IP', [branch('ibar', 'I′', [
    branch('i_complex', 'I°', [leaf('v_raised', 'V°', { word: 'read', lineageId: 'verb' }), structuredClone(host)]),
    branch('vp', 'VP', [leaf('v_trace', 'V°', { word: 'read', lineageId: 'verb', silent: true })])
  ])])];
  return { priorForest, currentForest, relation: { relation: 'V-to-I head movement',
    anchors: { inflectionalHost: 'i_core', lowerCopy: 'v_trace', raisedOccurrence: 'v_raised', resultingComplexHead: 'i_complex' },
    priorAnchors: { sourceOccurrence: 'v_base', targetHead: 'i_core' } } };
};

test('degree-sign zero-level notation keeps the existing category and projection distinctions', () => {
  for (const label of ['V°', 'I°', 'T°[past]', 'C°: interrogative']) assert.equal(readCategoryLabel(label)?.kind, 'head', label);
  assert.equal(readCategoryLabel('VP°')?.kind, 'phrase', 'a degree suffix cannot turn a phrase into a head');
  for (const label of ['45°', 'I °', 'V° prose', 'V°+TP']) assert.equal(readCategoryLabel(label), undefined, label);
});

test('degree-sign verb and inflection recover their exact authored head-movement endpoints', () => {
  const input = zeroLevelHead(), before = structuredClone(input);
  const movement = recover(input).movement;
  assert.equal(movement?.trajectoryKind, 'head');
  assert.equal(movement?.priorSourceNodeId, 'v_base');
  assert.equal(movement?.sourceNodeId, 'v_trace');
  assert.equal(movement?.targetNodeId, 'v_raised');
  assert(dispatch(input).facets.some(facet => facet.recipe.id === 'movement.path'));
  const path = compileRelationRenderPlan(stages(input)).frames[1].items.find(item => item.kind === 'trajectory');
  assert.equal(path?.trajectoryKind, 'head');
  assert.equal(path?.sourceNodeId, 'v_trace');
  assert.equal(path?.targetNodeId, 'v_raised');
  assert.deepEqual(input, before);
});

const bareScope = () => {
  const object = branch('objectLow', 'D', [leaf('dLow', 'D', { word: 'a' }), leaf('nLow', 'N', { word: 'book' })], { lineageId: 'object' });
  const clause = branch('clause', 'T', [
    branch('subject', 'D', [leaf('subjectWord', 'N', { word: 'Nora' })]),
    branch('tenseCore', 'T', [leaf('tense', 'T', { silent: true }), branch('verbPhrase', 'V', [leaf('verb', 'V', { word: 'read' }), object])])
  ]);
  const higher = branch('objectHigh', 'D', [leaf('dHigh', 'D', { word: 'a' }), leaf('nHigh', 'N', { word: 'book' })], { lineageId: 'object', silent: true });
  return { priorForest: [structuredClone(clause)], currentForest: [branch('scopeClause', 'T', [higher, clause])],
    relation: { relation: 'covert object Internal Merge', anchors: { higherOccurrence: 'objectHigh', lowerOccurrence: 'objectLow', scopeHost: 'clause' },
      priorAnchors: { source: 'objectLow' }, values: { motivation: 'inverse quantifier scope', pronunciation: 'lower occurrence only' } } };
};

test('an unchanged bare-labelled clause containing the lower occurrence is a phrasal landing context', () => {
  const input = bareScope(), before = structuredClone(input);
  assert.equal(recover(input).movement?.trajectoryKind, 'phrasal');
  const result = dispatch(input);
  assert(result.facets.some(facet => facet.recipe.id === 'scope.movement'));
  assert(!result.facets.some(facet => facet.recipe.id === 'movement.path'));
  assert.deepEqual(result.evidenceCoverage.fields.find(field => field.key === 'scopeHost').unrecoveredItemIndices, []);
  const items = compileRelationRenderPlan(stages(input)).frames[1].items;
  assert(items.some(item => item.kind === 'quantifier-raising' && item.scopeDomainNodeId === 'clause'));
  assert.deepEqual(input, before, 'recognition never adds or reorders syntax');
});

test('the same bare phrase without an explicit covert claim remains ordinary phrasal movement', () => {
  const input = bareScope();
  input.relation.relation = 'object Internal Merge';
  assert.equal(recover(input).movement?.trajectoryKind, 'phrasal');
  const result = dispatch(input);
  assert(result.facets.some(facet => facet.recipe.id === 'movement.path'));
  assert(!result.facets.some(facet => facet.recipe.id === 'scope.movement'));
});

test('a duplicate lower occurrence cannot become a scope or movement path', () => {
  const input = bareScope();
  input.currentForest.push(structuredClone(input.priorForest[0]));
  assert.equal(recover(input).movement, undefined);
  assert(!dispatch(input).facets.some(facet => ['scope.movement', 'movement.path'].includes(facet.recipe.id)));
});

test('an independent recursively built head host still accepts head adjunction', () => {
  const source = leaf('negLow', 'Neg', { word: 'not', lineageId: 'neg' });
  const host = branch('host', 'T', [leaf('tense', 'T'), branch('auxiliary', 'Aux', [leaf('aux', 'Aux'), leaf('inflection', 'Agr')])]);
  const input = { priorForest: [branch('negProjection', 'NegP', [source]), structuredClone(host)],
    currentForest: [branch('tp', 'TP', [branch('newHead', 'T', [leaf('negHigh', 'Neg', { word: 'not', lineageId: 'neg' }), host]),
      branch('negProjection', 'NegP', [{ ...source, silent: true }])])],
    relation: { relation: 'An authored dependency', anchors: { higherOccurrence: 'negHigh', lowerOccurrence: 'negLow', landingHead: 'host' }, priorAnchors: { source: 'negLow' } } };
  assert.equal(recover(input).movement?.trajectoryKind, 'head');
  assert(dispatch(input).facets.some(facet => facet.recipe.id === 'movement.path'));
});
