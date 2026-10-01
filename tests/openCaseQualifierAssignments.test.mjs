import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { buildTier2FacetEvidence } from '../replay/relations/relationEvidence.ts';
import { recoverQualifiedCaseAssignments } from '../replay/relations/qualifiedCaseAssignments.ts';

const forest = [{ id: 'ip', label: 'IP', children: [
  { id: 'subject', label: 'DP', word: 'Priya' },
  { id: 'ibar', label: 'I′', children: [
    { id: 'inflection', label: 'I', word: '-ed' },
    { id: 'vp', label: 'VP', children: [
      { id: 'verb', label: 'V', word: 'order' },
      { id: 'object', label: 'DP', word: 'soup' }
    ] }
  ] }
] }];
const relation = { relation: 'Case licensing', anchors: {
  nominativeLicensor: 'inflection', nominativeRecipient: 'subject',
  objectiveLicensor: 'verb', objectiveRecipient: 'object'
} };
const evidence = r => buildTier2FacetEvidence({ relation: r, currentForest: forest });
const plan = (r, workspaceForest = forest) => compileRelationRenderPlan([{
  statement: 'Completed clause', stageRecord: 'Case is licensed.', workspaceForest, relations: [r]
}]).frames[0].items;
const paths = (r, f) => plan(r, f).filter(item => item.pathStyle === 'case-assignment')
  .map(item => [item.fromNodeId, item.toNodeId, item.label]);

test('open Case qualifiers pair exact sources and recipients without translating the literal', () => {
  const original = structuredClone(relation);
  assert.deepEqual(paths(relation), [
    ['inflection', 'subject', 'nominative'], ['verb', 'object', 'objective']
  ]);
  assert(!plan(relation).some(item => item.kind === 'fallback'));
  assert.deepEqual(relation, original);
  const reversed = { ...relation, anchors: Object.fromEntries(Object.entries(relation.anchors).reverse()) };
  assert.deepEqual(paths(reversed).sort(), paths(relation).sort());
  const scopes = recoverQualifiedCaseAssignments(evidence(relation));
  assert.deepEqual(scopes.map(scope => scope.origins.anchors), [
    { nominativeLicensor: [0], nominativeRecipient: [0] },
    { objectiveLicensor: [0], objectiveRecipient: [0] }
  ]);
});

test('the Case domain comes from a complete positive claim, not one familiar literal alias', () => {
  for (const name of ['Case licensing', 'structural Case assignment', 'abstract Case valuation', 'structural Case marking']) {
    for (const literal of ['objective', 'partitive', 'unfamiliar']) {
      const r = { relation: name, anchors: { [`${literal}Licensor`]: 'verb', [`${literal}Recipient`]: 'object' } };
      assert.deepEqual(paths(r), [['verb', 'object', literal]], JSON.stringify(r));
    }
  }
  for (const name of ['An unfamiliar relation', 'Case', 'possibly Case licensing', 'Whether Case licensing occurs', 'Case licensing is possible']) {
    const r = { relation: name, anchors: { objectiveLicensor: 'verb', objectiveRecipient: 'object' } };
    assert.deepEqual(paths(r), [], name);
  }
  // The exact registered relation keeps its required signature, including an
  // explicit Case value. Recovery cannot repair a malformed Tier 1 claim.
  assert.deepEqual(paths({ ...relation, relation: 'CaseAssignment' }), []);
});

test('unmatched, ambiguous and unresolved pairs cannot borrow a neighboring assignment', () => {
  const invalid = [
    { objectiveLicensor: 'verb', partitiveRecipient: 'object' },
    { objectiveLicensor: 'verb', objectiveRecipient: ['subject', 'object'] },
    { objectiveLicensor: 'verb', objectiveRecipient: 'missing' },
    { objectiveLicensor: 'verb', objectiveRecipient: 'verb' },
    { objectiveLicensor: 'verb', objectiveAssigner: 'inflection', objectiveRecipient: 'object' },
    { objectiveLicensor: 'verb', objectiveRecipient: 'object', objectiveDP: 'subject' },
    { failedObjectiveLicensor: 'verb', failedObjectiveRecipient: 'object' }
  ];
  for (const anchors of invalid) {
    const r = { ...relation, anchors: { nominativeLicensor: 'inflection', nominativeRecipient: 'subject', ...anchors } };
    assert.deepEqual(paths(r), [['inflection', 'subject', 'nominative']], JSON.stringify(anchors));
    assert(plan(r).some(item => item.kind === 'fallback'));
  }
  const duplicate = structuredClone(forest);
  duplicate.push({ id: 'object', label: 'DP', word: 'another' });
  assert.deepEqual(paths(relation, duplicate), [['inflection', 'subject', 'nominative']]);
});

test('Case polarity stays local and independent sibling claims survive', () => {
  for (const name of ['No Case licensing', 'Case licensing is pending', 'Possible Case licensing']) {
    assert.deepEqual(paths({ ...relation, relation: name }), [], name);
  }
  for (const result of ['failed', 'pending', 'unresolved'])
    assert.deepEqual(paths({ ...relation, values: { result } }), [], result);
  for (const name of ['No objective Case licensing', 'objective Case licensing is pending']) {
    const r = { relation: name, anchors: { objectiveCaseLicensor: 'verb', objectiveCaseRecipient: 'object' } };
    assert.deepEqual(paths(r), [], name);
  }
  for (const name of ['Failed Case assignment', 'failed objective Case assignment']) {
    const blocked = plan({ relation: name, anchors: { objectiveCaseLicensor: 'verb', objectiveCaseRecipient: 'object' } })
      .filter(item => item.pathStyle === 'case-assignment');
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].outcome, 'blocked');
  }
  assert.deepEqual(paths({ ...relation, relation: 'Case licensing; objective Case licensing is pending' }),
    [['inflection', 'subject', 'nominative']]);
  assert.deepEqual(paths({ ...relation, relation: 'Case licensing; nominative Case licensing is pending' }),
    [['verb', 'object', 'objective']]);
  assert.deepEqual(paths({ ...relation, relation: 'failed agreement; Case licensing' }), paths(relation));
  const sibling = { ...relation, relation: 'Case licensing and thematic role assignment',
    anchors: { ...relation.anchors, predicate: 'verb', argument: 'object' },
    values: { thetaRole: 'Theme', comment: 'Keep this context.' } };
  assert.deepEqual(paths(sibling), paths(relation));
  const rendered = plan(sibling);
  assert(rendered.some(item => item.plaqueStyle === 'theta-grid' && item.thetaRoles.some(role => role.nodeId === 'object' && role.label === 'Theme')));
  assert(rendered.some(item => item.kind === 'fallback' && item.relationRef.values?.comment === 'Keep this context.'));
});

test('separately supplied Case values keep precedence over derived field qualifiers', () => {
  for (const value of ['accusative', ['objective', 'nominative'], []]) {
    const r = { ...relation, values: { case: value } };
    assert.deepEqual(recoverQualifiedCaseAssignments(evidence(r)), []);
  }
});
