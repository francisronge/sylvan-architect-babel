import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildTier2FacetEvidence, dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { recoverNamedFeatureLicensing } from '../replay/relations/featureLicensingEvidence.ts';
import { compileRelationRenderPlan, visiblePlanFrameItems } from '../replay/relations/renderPlanCompiler.ts';
import { collectionPlaque, featurePlaqueAssignment } from '../replay/relations/featureComposition.ts';
import { preparePlaqueTextLayout } from '../replay/relations/plaqueTextLayout.ts';

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/japanese-topic-feature.json', import.meta.url)));
const node = (id, children = []) => ({ id, label: 'X', children });
const forest = [node('root', [node('recipient', [node('particle')]), node('source'), node('other')])];
const relation = () => ({ relation: 'topic-feature licensing', anchors: { licenser: 'source', topic: 'recipient', particle: 'particle' },
  values: { feature: 'topic' } });
const stage = (claim, workspaceForest = forest) => ({ statement: '', stageRecord: '', workspaceForest, relations: [claim] });
const itemsFor = (claim, workspaceForest = forest) => compileRelationRenderPlan([stage(claim, workspaceForest)]).frames[0].items;
const scopeFor = (claim, currentForest = forest) => recoverNamedFeatureLicensing(buildTier2FacetEvidence({ relation: claim, currentForest }));
const featureItems = items => items.filter(item => item.tier2FacetId === 'feature.dependency');

function assertFeature(items, source, target, label, value) {
  const features = featureItems(items);
  const plaque = features.find(item => item.plaqueStyle === 'feature');
  const paths = features.filter(item => item.kind === 'directed-path');
  assert(plaque);
  assert.deepEqual(plaque.anchorNodeIds, [source]);
  assert.deepEqual(plaque.rows, [{ label, value }]);
  assert.equal(plaque.title, undefined);
  assert.equal(preparePlaqueTextLayout(plaque, { variant: 'feature' }).title, undefined);
  assert.equal(featurePlaqueAssignment(items, items.indexOf(plaque)), undefined);
  assert.equal(paths.length, 1);
  assert.equal(paths[0].pathStyle, 'case-agree', 'the existing generic feature connector is reused');
  assert.equal(paths[0].fromNodeId, source);
  assert.equal(paths[0].toNodeId, target);
  assert.deepEqual(paths[0].featureRow, { label, value });
  assert.equal(collectionPlaque(items, paths[0])?.item, plaque);
  assert(!features.some(item => item.pathStyle === 'case-assignment' || item.kind === 'trajectory'));
}

test('saved Japanese topic licensing owns one literal feature plaque and exact recipient connector', () => {
  const original = structuredClone(fixture.stage);
  const index = fixture.provenance.relationIndex;
  const plan = compileRelationRenderPlan([fixture.stage]);
  const items = plan.frames[0].items.filter(item => item.relationRef.relationIndex === index);
  assertFeature(items, 'top', 'taroK1', 'feature', 'topic');
  assert(!featureItems(visiblePlanFrameItems(plan, 0, new Set([0]))).some(item => item.relationRef.relationIndex === index));
  assertFeature(visiblePlanFrameItems(plan, 0, new Set([0, index])).filter(item => item.relationRef.relationIndex === index),
    'top', 'taroK1', 'feature', 'topic');
  const dispatch = dispatchRelationClaims({ relation: fixture.stage.relations[index], currentForest: fixture.stage.workspaceForest,
    stageIndex: 0, relationIndex: index });
  assert.equal(dispatch.facets.filter(facet => facet.recipe.id === 'feature.dependency').length, 1);
  const particle = dispatch.evidenceCoverage.fields.find(field => field.field === 'anchors' && field.key === 'particle');
  assert.deepEqual(particle.recognizedBy, [], 'the particle is context, not a second recipient or inferred movement');
  assert.deepEqual(fixture.stage, original);
});

test('named feature licensing preserves arbitrary participant and feature names without a topic special case', () => {
  for (const [participant, literal] of [['topic', 'aboutness: established'], ['focus', '[contrast: +]'], ['談話', '自由な素性']]) {
    for (const source of ['licenser', 'licensor', 'licensingHead', 'embeddedLicensor']) {
      const claim = { relation: `${participant}-feature licensing`, anchors: { [source]: 'source', [participant]: 'recipient' },
        values: { feature: literal } };
      const original = structuredClone(claim);
      assertFeature(itemsFor(claim), 'source', 'recipient', 'feature', literal);
      assert.deepEqual(claim, original);
    }
  }
});

test('an explicit feature-licensing recipient uses the same claim without a named subtype', () => {
  for (const target of ['licensee', 'licensed phrase', 'feature target']) {
    const claim = { relation: 'feature licensing', anchors: { licenser: 'source', [target]: 'recipient' }, values: { feature: 'open feature' } };
    assertFeature(itemsFor(claim), 'source', 'recipient', 'feature', 'open feature');
  }
});

test('labels and node annotations alone cannot create a licensed feature or identify its source', () => {
  const base = relation();
  const claims = [
    { ...base, values: {} },
    { ...base, values: { feature: '' } },
    { ...base, values: { feature: ['topic', 'focus'] } },
    { ...base, values: { label: 'topic' } },
    { ...base, values: { feature: 'topic', featureLabel: 'focus' } },
    { ...base, anchors: { topic: 'recipient', particle: 'particle' } },
    { ...base, anchors: { head: 'source', topic: 'recipient' } },
    { ...base, anchors: { licenser: 'source', otherTopic: 'recipient' } },
    { ...base, relation: 'topic licensing' },
    { ...base, relation: 'An account of topic-feature licensing' },
    { ...base, relation: 'feature annotation' }
  ];
  const annotated = structuredClone(forest); annotated[0].children[0].label = 'K[topic]';
  for (const claim of claims) {
    assert.equal(scopeFor(claim, annotated).length, 0, JSON.stringify(claim));
    assert.equal(featureItems(itemsFor(claim, annotated)).length, 0, JSON.stringify(claim));
  }
});

test('ambiguous, identical, duplicate and absent endpoints never gain a dependency', () => {
  const base = relation();
  for (const anchors of [
    { ...base.anchors, licensor: 'other' },
    { ...base.anchors, source: 'other' },
    { ...base.anchors, recipient: 'other' },
    { ...base.anchors, Topic: 'other' },
    { ...base.anchors, topic: ['recipient', 'other'] },
    { ...base.anchors, topic: 'source' },
    { ...base.anchors, topic: 'missing' },
    { ...base.anchors, licenser: 'missing' }
  ]) assert.equal(scopeFor({ ...base, anchors }).length, 0, JSON.stringify(anchors));
  const duplicate = [...structuredClone(forest), node('recipient')];
  assert.equal(scopeFor(base, duplicate).length, 0);
  assert.equal(featureItems(itemsFor(base, duplicate)).length, 0);
});

test('Case and paired feature-value notation are never recast as generic feature licensing', () => {
  const base = relation();
  for (const values of [{ feature: 'Case' }, { feature: 'structural case' }, { feature: 'Case', value: 'nominative' },
    { feature: 'Number', value: 'plural' }, { feature: 'topic', case: 'nominative' }, { feature: 'topic', features: 'focus' }])
    assert.equal(scopeFor({ ...base, values }).length, 0, JSON.stringify(values));
  const literal = { ...base, values: { feature: 'Case: nominative' } };
  assertFeature(itemsFor(literal), 'source', 'recipient', 'feature', 'Case: nominative');
  assert(!itemsFor(literal).some(item => item.pathStyle === 'case-assignment'),
    'a literal row containing Case notation cannot acquire independent Case semantics');
});

test('denied, conditional and unresolved licensing remains neutral even with complete positive-looking participants', () => {
  const base = relation();
  for (const prefix of ['No', 'Not', 'Required', 'Pending', 'Failed', 'Blocked', 'Hypothetical', 'Conditional', 'Unestablished', 'Possible']) {
    const claim = { ...base, relation: `${prefix} topic-feature licensing` };
    assert.equal(featureItems(itemsFor(claim)).length, 0, claim.relation);
  }
  for (const suffix of ['; licensing failed', ' and no topic licensing', ' if possible', ' unless blocked']) {
    const claim = { ...base, relation: `${base.relation}${suffix}` };
    assert.equal(featureItems(itemsFor(claim)).length, 0, claim.relation);
  }
  for (const outcome of ['pending', 'failed', 'blocked', 'not established', 'possibly licensed', 'unknown']) {
    const claim = { ...base, values: { ...base.values, outcome } };
    assert.equal(featureItems(itemsFor(claim)).length, 0, outcome);
  }
  const positive = { ...base, values: { ...base.values, outcome: 'licensed' } };
  assertFeature(itemsFor(positive), 'source', 'recipient', 'feature', 'topic');
  assert.equal(featureItems(itemsFor(positive)).find(item => item.kind === 'directed-path').outcome, 'licensed');
});

test('malformed exact Tier-1 records cannot be repaired by this evidence scope', () => {
  for (const name of ['Agree', 'CaseAssignment']) {
    const claim = { ...relation(), relation: name };
    assert.equal(featureItems(itemsFor(claim)).length, 0);
  }
});
