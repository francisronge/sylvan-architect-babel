import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';

const lower = { id: 'low', label: 'DP', word: 'Alex', lineageId: 'subject' };
const tense = { id: 'tense', label: 'T' };
const predicate = { id: 'verb', label: 'V', word: 'leave' };
const prior = [{ id: 'tp', label: 'TP', children: [tense,
  { id: 'vp', label: 'VP', children: [lower, predicate] }
] }];
const current = [{ id: 'upper', label: 'TP', children: [{ ...lower, id: 'high' },
  { ...prior[0], children: [tense, { ...prior[0].children[1], children: [{ ...lower, silent: true }, predicate] }] }
] }];
const movement = { relation: 'subject raising', anchors: { source: 'low', landing: 'high', target: 'tense' },
  priorAnchors: { source: 'low' }, values: { dependency: 'A-movement', Case: 'still unvalued' } };
const stages = relation => [
  { statement: '', stageRecord: '', workspaceForest: prior, relations: [] },
  { statement: '', stageRecord: '', workspaceForest: current, relations: [relation] }
];
const items = relation => compileRelationRenderPlan(stages(relation)).frames[1].items;
const dispatch = relation => dispatchRelationClaims({ relation, currentForest: current, priorForest: prior,
  stageIndex: 1, relationIndex: 0 });
const assignments = relation => items(relation).filter(item => item.pathStyle === 'case-assignment');

// These names describe states of valuation, not the open vocabulary of Case categories.
const unestablished = ['unvalued', 'still unvalued', 'currently unassigned', 'not yet valued',
  'Case is still unvalued', 'Case value is not assigned', 'pending', 'unresolved', 'not yet established'];

test('an unvalued Case state stays neutral while the exact subject movement survives', () => {
  const original = structuredClone(movement);
  for (const Case of [...unestablished, 'nominative', 'unfamiliar Case']) {
    const relation = { ...movement, values: { ...movement.values, Case } };
    assert(items(relation).some(item => item.kind === 'trajectory'), Case);
    assert.deepEqual(assignments(relation), [], Case);
    assert(!items(relation).some(item => item.kind === 'node-plaque'), 'the attracting head does not acquire the nominal Case state');
    assert(dispatch(relation).claims.some(claim => claim.tier === 3
      && claim.consumedEvidence.some(ref => ref.field === 'values' && ref.key === 'Case')));
  }
  assert.deepEqual(movement, original);
});

test('explicit Case participants cannot turn pending valuation into an assignment', () => {
  for (const Case of unestablished) {
    const relation = { relation: 'Case licensing', anchors: { assigner: 'tense', recipient: 'high' }, values: { Case } };
    assert.deepEqual(assignments(relation), [], Case);
    assert(dispatch(relation).evidenceCoverage.fields.some(field => field.field === 'values' && field.key === 'Case'),
      'authored state is retained');
  }
});

test('an independent Case claim can accompany movement, with literal unfamiliar Case names', () => {
  for (const Case of ['nominative', 'unfamiliar Case', 'pendingative', 'negative polarity Case']) {
    const relation = { ...movement,
      anchors: { lowerOccurrence: 'low', higherOccurrence: 'high', caseAssigner: 'tense', caseRecipient: 'high' },
      values: { Case } };
    assert(items(relation).some(item => item.kind === 'trajectory'));
    assert.deepEqual(assignments(relation).map(item => [item.fromNodeId, item.toNodeId, item.label]),
      [['tense', 'high', Case]]);
  }
});

test('generic typed Case directions remain valid without a competing movement claim', () => {
  for (const anchors of [{ source: 'tense', target: 'high' }, { assigner: 'tense', recipient: 'high' }]) {
    const relation = { relation: 'Open claim', anchors, values: { Case: 'unfamiliar Case' } };
    assert.deepEqual(assignments(relation).map(item => [item.fromNodeId, item.toNodeId, item.label]),
      [['tense', 'high', 'unfamiliar Case']]);
  }
});

test('a blocked established Case keeps its outcome; malformed exact Tier 1 is not repaired', () => {
  const relation = { relation: 'Case licensing', anchors: { assigner: 'tense', recipient: 'high' },
    values: { Case: 'nominative', outcome: 'blocked' } };
  assert.equal(assignments(relation)[0]?.outcome, 'blocked');
  const malformed = { relation: 'CaseAssignment', anchors: { source: 'low', landing: 'high' }, values: { Case: 'nominative' } };
  assert(!dispatch(malformed).claims.some(claim => claim.tier === 2));
});

test('saved passive-question raising retains the original unvalued Case claim without assigning it to T', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/clause-context.json', import.meta.url)))
    .cases.find(entry => entry.name === 'english-passive-question-4');
  const before = structuredClone(fixture.derivationStages);
  const plan = compileRelationRenderPlan(fixture.derivationStages);
  const relationItems = plan.frames[1].items.filter(item => item.relationRef?.relationIndex === fixture.relationIndex);
  assert(relationItems.some(item => item.kind === 'trajectory'));
  assert(!relationItems.some(item => item.pathStyle === 'case-assignment' || item.kind === 'node-plaque'));
  assert(relationItems.some(item => item.kind === 'fallback' && item.relationRef.values.Case === 'still unvalued'));
  assert.deepEqual(fixture.derivationStages, before);
});
