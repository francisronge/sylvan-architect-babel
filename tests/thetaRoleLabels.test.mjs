import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const forest = [{ id: 'phrase', label: 'VP', children: [
  { id: 'predicate', label: 'V', word: 'gave' },
  { id: 'argument', label: 'DP', word: 'Mia' },
  { id: 'other', label: 'DP', word: 'books' }
] }];
const record = relation => ({ statement: 'Authored state', stageRecord: '', workspaceForest: forest, relations: [relation] });
const plan = relation => compileRelationRenderPlan([record(relation)]).frames[0].items;
const grid = relation => plan(relation).find(item => item.plaqueStyle === 'theta-grid');
const dispatch = relation => dispatchRelationClaims({ relation, currentForest: forest, stageIndex: 0, relationIndex: 0 });
const assignment = label => ({ relation: label, anchors: { predicate: 'predicate', recipient: 'argument' } });
const roles = relation => grid(relation)?.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label }));

test('a complete thematic-role clause supplies the role, not the recipient endpoint name', () => {
  for (const [label, role] of [
    ['agent theta-role', 'agent'], ['theme theta-role and object government', 'theme'],
    ['object government; theme thematic-role assignment', 'theme'],
    ['recipient theta-role', 'recipient'], ['originator θ-role introduction', 'originator']
  ]) {
    const relation = assignment(label);
    const original = structuredClone(relation);
    assert.deepEqual(roles(relation), [{ nodeId: 'argument', label: role }], label);
    assert.deepEqual(relation, original);
    const claim = dispatch(relation).claims.find(claim => claim.tier === 2 && claim.facet.recipe.id === 'theta-grid');
    assert(claim, label);
    assert.deepEqual(claim.consumedEvidence.map(({ field, key }) => [field, key]).sort(), [
      ['anchors', 'predicate'], ['anchors', 'recipient']
    ]);
    assert.deepEqual(grid(relation).relationRef, { stageIndex: 0, relationIndex: 0, ...original });
  }
});

test('authored role values take precedence and keep arbitrary literal wording', () => {
  for (const values of [{ role: 'Recipient' }, { role: 'Unfamiliar interpretation' }, { recipient: 'Witness of the event' }]) {
    const relation = { ...assignment('agent theta-role'), values };
    assert.deepEqual(roles(relation), [{ nodeId: 'argument', label: Object.values(values)[0] }]);
    const claim = dispatch(relation).claims.find(claim => claim.tier === 2 && claim.facet.recipe.id === 'theta-grid');
    assert(claim.consumedEvidence.some(ref => ref.field === 'values' && ref.key === Object.keys(values)[0]));
  }
  for (const values of [{ role: [] }, { role: '' }, { recipient: [] }, { role: ['Agent', 'Theme'] }])
    assert(!grid({ ...assignment('agent theta-role'), values }), JSON.stringify(values));
});

test('ambiguous endpoint names do not become thematic-role labels', () => {
  for (const relation of [
    assignment('an unfamiliar relation'),
    assignment('argument structure'), assignment('newrole'),
    { relation: 'argument structure', anchors: { predicate: 'predicate', goal: 'argument' } },
    { relation: 'argument structure', anchors: { predicate: 'predicate', recipient: 'argument', goal: 'other' } }
  ]) {
    assert(!grid(relation), JSON.stringify(relation));
    assert(dispatch(relation).claims.some(claim => claim.tier === 3));
  }
  const predicative = assignment('predicative subject role');
  assert(!grid(predicative));
  assert(plan(predicative).some(item => item.linkStyle === 'predication'));
  assert.deepEqual(roles({ relation: 'argument structure', anchors: { predicate: 'predicate', agent: 'argument', theme: 'other' } }), [
    { nodeId: 'argument', label: 'agent' }, { nodeId: 'other', label: 'theme' }
  ]);
  assert.deepEqual(roles({ relation: 'argument structure', anchors: { predicate: 'predicate', agent: 'argument', recipient: 'other' } }), [
    { nodeId: 'argument', label: 'agent' }, { nodeId: 'other', label: 'recipient' }
  ]);
});

test('thematic label reading rejects denial, provisional claims, prose and competing role clauses', () => {
  for (const label of [
    'no agent theta-role', 'possible agent theta-role', 'agent theta-role is unassigned',
    'agent theta-role and theme theta-role', 'agent theta-role but no agent theta-role',
    'not theta-role', 'unassigned theta-role', 'discussion of agent theta-role',
    'agent theta-role is sometimes assigned'
  ]) assert(!grid(assignment(label)), label);
  for (const relation of [
    { ...assignment('agent theta-role'), anchors: { predicate: 'predicate', recipient: ['argument', 'other'] } },
    { ...assignment('agent theta-role'), anchors: { predicate: 'predicate', recipient: 'missing' } },
    { ...assignment('agent theta-role'), anchors: { predicate: 'predicate', recipient: 'argument', argument: 'other' } },
    { ...assignment('agent theta-role'), values: { outcome: 'failed' } }
  ]) assert(!grid(relation), JSON.stringify(relation));
});

test('different thematic role clauses do not share a drawing identity', () => {
  const stages = [record(assignment('agent theta-role')), record(assignment('theme theta-role'))];
  const frames = compileRelationRenderPlan(stages).frames;
  assert.deepEqual(frames.map(frame => frame.items.filter(item => item.plaqueStyle === 'theta-grid').map(item => item.thetaRoles[0].label)), [
    ['agent'], ['agent', 'theme']
  ]);
});
