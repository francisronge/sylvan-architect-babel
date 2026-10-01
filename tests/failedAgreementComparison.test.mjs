import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildTier2FacetEvidence } from '../replay/relations/relationEvidence.ts';
import { recoverFailedFeatureComparison } from '../replay/relations/qualifiedAgreement.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/failed-agreement-holdout.json', import.meta.url)));
const [nominal, finite] = fixture.cases;
const recover = ({ relation, workspaceForest }) => recoverFailedFeatureComparison(buildTier2FacetEvidence({ relation, currentForest: workspaceForest }));
const plan = ({ relation, workspaceForest }) => compileRelationRenderPlan([
  { statement: '', stageRecord: '', workspaceForest, relations: [relation] }
]).frames[0].items;
const paths = record => plan(record).filter(item => item.kind === 'directed-path');
const changed = (record, relation) => ({ ...record, relation: { ...record.relation, ...relation } });

test('saved nominal conflict draws its failed comparison and preserves both authored feature values', () => {
  const before = structuredClone(nominal);
  const drawn = paths(nominal);
  assert.equal(drawn.length, 2);
  assert(drawn.every(item => item.fromNodeId === 'd0' && item.toNodeId === 'n0' && item.outcome === 'blocked'));
  assert.deepEqual(drawn.map(item => item.featureRow), [
    { label: 'demonstrativeNumber', value: 'plural' },
    { label: 'nominalNumber', value: 'singular' }
  ]);
  assert.deepEqual(nominal, before);
});

test('saved finite conflict draws probe and goal specifications as one failed dependency', () => {
  const before = structuredClone(finite);
  const drawn = paths(finite);
  assert.equal(drawn.length, 2);
  assert(drawn.every(item => item.fromNodeId === 'has' && item.toNodeId === 'dp0' && item.outcome === 'blocked'));
  assert.deepEqual(drawn.map(item => item.featureRow), [
    { label: 'probeSpecification', value: 'third-person singular' },
    { label: 'goalSpecification', value: 'third-person plural' }
  ]);
  const dispatch = dispatchRelationClaims({ relation: finite.relation, currentForest: finite.workspaceForest, stageIndex: 0, relationIndex: 0 });
  assert.equal(dispatch.claims.filter(claim => claim.tier === 2 && claim.facet.recipe.id === 'feature.dependency').length, 1);
  assert(!dispatch.claims.some(claim => claim.tier === 3));
  assert.deepEqual(finite, before);
});

test('comparison failure needs an asserted claim, not just differing values or a conditional status', () => {
  for (const relation of ['Finite agreement', 'Possible finite agreement conflict', 'No finite agreement conflict',
    'Finite agreement conflict if the probe is plural', 'Whether finite agreement conflict']) {
    assert.deepEqual(recover(changed(finite, { relation })), [], relation);
  }
  for (const status of ['successful', 'pending', 'not unlicensed', 'Agree can successfully license the supplied auxiliary form',
    'Agree cannot successfully license the supplied auxiliary form if the goal is plural',
    'Agree cannot fail', 'Agree cannot successfully license the supplied auxiliary form but agreement succeeds',
    'Agree does not always license the supplied auxiliary form', 'possible failure', ['failed', 'successful']]) {
    assert.deepEqual(recover(changed(finite, { values: { ...finite.relation.values, status } })), [], JSON.stringify(status));
  }
});

test('failed comparison never chooses between competing, missing or repeated participants and properties', () => {
  for (const relation of [
    { anchors: { ...finite.relation.anchors, probeHead: 'has' } },
    { anchors: { ...finite.relation.anchors, collector: 'd0' } },
    { anchors: { ...finite.relation.anchors, featureTarget: 'n0' } },
    { anchors: { ...finite.relation.anchors, probe: ['has', 'd0'] } },
    { anchors: { ...finite.relation.anchors, goal: 'has' } },
    { values: { ...finite.relation.values, probeFeatures: 'first-person plural' } },
    { values: { ...finite.relation.values, probeSpecification: '' } },
    { values: { ...finite.relation.values, probeSpecification: ['third-person singular', 'first-person plural'] } },
    { values: { probeSpecification: 'third-person singular', status: 'failed' } }
  ]) assert.deepEqual(recover(changed(finite, relation)), [], JSON.stringify(relation));
  assert.equal(paths(changed(finite, { anchors: { ...finite.relation.anchors, goal: 'missing' } }))
    .filter(item => item.outcome === 'blocked').length, 0);
});

test('participant specifications retain ownership under bounded negative comparison assertions', () => {
  for (const status of ['Agreement cannot match the nominal features', 'Concord cannot satisfy the number requirement']) {
    const record = changed(finite, { values: { ...finite.relation.values, status } });
    const [scope] = recover(record);
    assert(scope, status);
    assert.equal(scope.evidence.authoredValues.find(entry => entry.key === 'status').items[0], status);
    assert.deepEqual(scope.evidence.values.outcome, ['failed']);
    assert(paths(record).every(item => item.outcome === 'blocked'));
  }
});

test('independent sibling statuses cannot turn a local comparison failure into another outcome', () => {
  const relation = {
    ...finite.relation,
    relation: 'Finite agreement conflict; Case assignment',
    values: { ...finite.relation.values, status: 'successful', agreementStatus: 'failed' }
  };
  const scopes = recover(changed(finite, relation));
  assert.equal(scopes.length, 1);
  assert.deepEqual(scopes[0].origins.values.agreementStatus, [0]);
  assert.equal(scopes[0].origins.values.status, undefined);
});
