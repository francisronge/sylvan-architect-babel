import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchStageRelations } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const node = (id, label, children = [], extra = {}) => ({ id, label, children, ...extra });
const source = node('host', 'V⁰[participle]', [], { word: 'seen' });
const target = node('argument', 'DP', [], { word: 'them' });
const before = [node('projection', 'V′', [source, target])];
const complex = node('complex', 'V⁰[complex]', [node('adjunct', 'D⁰', [], { word: 'clitic' }), source]);
const after = [node('projection', 'V′', [complex, target])];
const stage = (workspaceForest, relations) => ({ statement: '', stageRecord: '', workspaceForest, relations });
const assignments = [
  { relation: 'An authored role assignment', anchors: { predicate: 'host', argument: 'argument' }, values: { thetaRole: 'Theme' } },
  { relation: 'An authored Case assignment', anchors: { assigner: 'host', recipient: 'argument' }, values: { case: 'accusative' } }
];
const continued = (sourceId = 'host') => ({ relation: 'An authored continuation',
  anchors: { retainedParticipant: sourceId, argumentPosition: 'argument' }, values: { thetaRole: 'Theme', case: 'accusative' } });
const continuationFacets = stages => dispatchStageRelations(stages).at(-1).at(-1).facets
  .filter(facet => facet.evidence && ['theta-grid', 'feature.dependency'].includes(facet.recipe.id));

test('the exact assigning head retains Case and theta assignments inside its new head complex', () => {
  const stages = [stage(before, assignments), stage(after, [continued()])];
  const original = structuredClone(stages);
  const facets = continuationFacets(stages);
  assert.deepEqual(facets.map(facet => facet.recipe.id).sort(), ['feature.dependency', 'theta-grid']);
  for (const facet of facets) assert.deepEqual(facet.evidence.currentAnchors,
    facet.recipe.id === 'theta-grid' ? { predicate: ['host'], 'theta.arguments': ['argument'] }
      : { 'feature.source': ['host'], 'feature.target': ['argument'] });
  assert.deepEqual(stages, original);
  const items = compileRelationRenderPlan(stages).frames[1].items;
  assert(items.some(item => item.plaqueStyle === 'theta-grid' && item.anchorNodeIds.includes('host')));
  assert(items.some(item => item.pathStyle === 'case-assignment' && item.fromNodeId === 'host' && item.toNodeId === 'argument'));
});

test('nested head adjunction preserves the original assigning host without selecting the added heads', () => {
  const nested = [node('projection', 'V′', [
    node('outerComplex', 'V⁰', [node('outerAdjunct', 'T⁰'), complex]), target
  ])];
  const facets = continuationFacets([stage(before, assignments), stage(nested, [continued()])]);
  assert.equal(facets.length, 2);
  assert(facets.every(facet => (facet.evidence.currentAnchors.predicate ?? facet.evidence.currentAnchors['feature.source'])[0] === 'host'));
});

test('an explicitly named complex can continue its retained host assignment at the old slot', () => {
  const tense = node('tense', 'I⁰[finite]', [], { silent: true });
  const subject = node('subject', 'NP', [], { word: 'books' });
  const oldForest = [node('ip', 'IP', [subject, node('ibar', 'I′', [tense])])];
  const newForest = [node('ip', 'IP', [subject, node('ibar', 'I′', [
    node('finiteComplex', 'I⁰[finite]', [node('verb', 'V⁰', [], { word: 'were' }), tense])
  ])])];
  const stages = [stage(oldForest, [{ relation: 'A Case assignment', anchors: { licenser: 'tense', recipient: 'subject' }, values: { case: 'nominative' } }]),
    stage(newForest, [{ relation: 'An authored chain', anchors: { caseLicenser: 'finiteComplex', chainHead: 'subject' }, values: { case: 'nominative' } }])];
  const facets = continuationFacets(stages);
  assert.equal(facets.length, 1);
  assert.deepEqual(facets[0].evidence.currentAnchors, { 'feature.source': ['finiteComplex'], 'feature.target': ['subject'] });
});

test('head continuation rejects competing heads, phrase wrappers, duplicated hosts and changed target slots', () => {
  const competingHead = structuredClone(after);
  competingHead[0].children[0].children[0].label = 'V⁰';
  const phraseWrapper = structuredClone(after);
  phraseWrapper[0].children[0].label = 'VP';
  const unaryWrapper = structuredClone(after);
  unaryWrapper[0].children[0].children.shift();
  const duplicatedHost = structuredClone(after);
  duplicatedHost.push(structuredClone(source));
  const unrelatedCopy = structuredClone(after);
  unrelatedCopy[0].children[0].children[1].id = 'differentHost';
  unrelatedCopy[0].children[0].children[1].lineageId = 'shared';
  const movedTarget = [node('outer', 'XP', [node('projection', 'V′', [complex]), node('otherSlot', 'XP', [target])])];
  const movedSourceSlot = [node('outer', 'XP', [node('otherSlot', 'V′', [complex]), node('projection', 'V′', [target])])];
  for (const forest of [competingHead, phraseWrapper, unaryWrapper, duplicatedHost, unrelatedCopy, movedTarget, movedSourceSlot]) {
    assert.equal(continuationFacets([stage(before, assignments), stage(forest, [continued()])]).length, 0, JSON.stringify(forest));
  }
  const competingAnchors = { ...continued(), anchors: { retainedParticipant: ['host', 'complex'], argumentPosition: 'argument' } };
  assert.equal(continuationFacets([stage(before, assignments), stage(after, [competingAnchors])]).length, 0);
});

test('continuation cannot select a related copy in place of the exact retained host', () => {
  const prior = structuredClone(before);
  prior[0].children[0].lineageId = 'shared';
  const later = structuredClone(after);
  later[0].children[0].children[1] = node('copy', 'V⁰', [], { word: 'seen', lineageId: 'shared' });
  assert.equal(continuationFacets([stage(prior, assignments), stage(later, [continued('complex')])]).length, 0);
  later[0].children[0].children[1].id = 'host';
  later[0].children[0].children[1].lineageId = 'different';
  assert.equal(continuationFacets([stage(prior, assignments), stage(later, [continued('complex')])]).length, 0);
});
