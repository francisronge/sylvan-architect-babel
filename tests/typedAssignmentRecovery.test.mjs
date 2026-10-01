import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const forest = [{ id: 'voiceP', label: 'VoiceP', children: [
  { id: 'voice', label: 'Voice', word: 'di-' },
  { id: 'vp', label: 'VP', children: [
    { id: 'verb', label: 'V', word: 'give' }, { id: 'theme', label: 'DP', word: 'a book' },
    { id: 'pp', label: 'PP', children: [{ id: 'p', label: 'P', word: 'to' }, { id: 'goal', label: 'DP', word: 'Mia' }] }
  ] },
  { id: 'agent', label: 'DP', word: 'Nora' },
  { id: 'predicate', label: 'AP', children: [{ id: 'a', label: 'A', word: 'new' }] }
] }];
const dispatch = (relation, currentForest = forest) => dispatchRelationClaims({ relation, currentForest, stageIndex: 0, relationIndex: 0 });
const plan = relation => compileRelationRenderPlan([{ statement: '', stageRecord: '', workspaceForest: forest, relations: [relation] }]).frames[0].items;
const grid = relation => plan(relation).find(item => item.plaqueStyle === 'theta-grid');
const predication = relation => plan(relation).find(item => item.linkStyle === 'predication');
const thetaRoles = relation => grid(relation)?.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label }));

test('one typed assignment keeps its role when a separate Case property is present', () => {
  const relation = { relation: 'object-role and Case assignment', anchors: { assigner: 'verb', recipient: 'theme' }, values: { case: 'accusative', role: 'theme' } };
  const original = structuredClone(relation);
  assert.deepEqual(thetaRoles(relation), [{ nodeId: 'theme', label: 'theme' }]);
  assert(plan(relation).some(item => item.pathStyle === 'case-assignment'));
  const claims = dispatch(relation).claims.filter(claim => claim.tier === 2);
  assert.equal(claims.filter(claim => claim.facet.recipe.id === 'theta-grid').length, 1);
  const theta = claims.find(claim => claim.facet.recipe.id === 'theta-grid');
  assert.deepEqual(theta.consumedEvidence.map(({ field, key }) => [field, key]).sort(), [
    ['anchors', 'assigner'], ['anchors', 'recipient'], ['values', 'role']
  ]);
  assert.deepEqual(relation, original);
});

test('a thematic source also assigns Case only when the compound claim explicitly asserts it', () => {
  for (const [label, role, target, caseValue, assignsCase] of [
    ['matrix theme-role and Case assignment', 'theme', 'theme', 'accusative', true],
    ['matrix goal-role assignment', 'goal', 'goal', 'dative', false]
  ]) {
    const relation = { relation: label, anchors: { verb: 'verb', [role]: target }, values: { role, case: caseValue } };
    assert.deepEqual(thetaRoles(relation), [{ nodeId: target, label: role }]);
    assert.equal(plan(relation).some(item => item.pathStyle === 'case-assignment'), assignsCase);
    const theta = dispatch(relation).claims.find(claim => claim.tier === 2 && claim.facet.recipe.id === 'theta-grid');
    assert(!theta.consumedEvidence.some(ref => ref.field === 'values' && ref.key === 'case'));
    assert(dispatch(relation).evidenceCoverage.fields.find(field => field.field === 'values' && field.key === 'case')?.recognizedBy.length);
  }
});

test('a typed thematic claim supports generic directions and an exact qualified predicate head', () => {
  for (const relation of [
    { relation: 'thematic-role assignment', anchors: { assigner: 'p', recipient: 'goal' }, values: { role: 'ground' } },
    { relation: 'agent-role assignment', anchors: { passiveHead: 'voice', agent: 'agent' }, values: { role: 'Agent' } },
    { relation: 'originator-role assignment', anchors: { verb: 'verb', originator: 'agent' }, values: { role: 'originator' } }
  ]) {
    const target = relation.anchors.recipient ?? relation.anchors.agent ?? relation.anchors.originator;
    assert.deepEqual(thetaRoles(relation), [{ nodeId: target, label: relation.values.role }], JSON.stringify(relation));
    assert.deepEqual(grid(relation).anchorNodeIds, [relation.anchors.assigner ?? relation.anchors.passiveHead ?? relation.anchors.verb]);
  }
});

test('typed thematic recovery rejects context, denied claims, competing endpoints and missing evidence', () => {
  const assignment = { relation: 'agent-role assignment', anchors: { passiveHead: 'voice', agent: 'agent' }, values: { role: 'Agent' } };
  for (const relation of [
    { relation: 'a contextual observation', anchors: { verb: 'verb', agent: 'agent' } },
    { ...assignment, relation: 'passive licensing' },
    { ...assignment, relation: 'failed agent-role assignment' },
    { ...assignment, relation: 'possible agent-role assignment' },
    { ...assignment, relation: 'agent-role assignment but no agent-role assignment' },
    { ...assignment, anchors: { contextualHead: 'voice', agent: 'agent' } },
    { ...assignment, anchors: { passiveHead: 'voice', predicate: 'verb', agent: 'agent' } },
    { ...assignment, anchors: { passiveHead: 'voice', agent: 'agent', theme: 'theme' } },
    { ...assignment, anchors: { passiveHead: 'voice', agent: 'missing' } },
    { ...assignment, values: { role: ['Agent', 'Theme'] } },
    { ...assignment, values: { role: 'Agent', outcome: 'failed' } }
  ]) assert(!grid(relation), JSON.stringify(relation));
  const crossWorkspace = [{ id: 'voice', label: 'Voice' }, { id: 'agent', label: 'DP' }];
  assert(!dispatch(assignment, crossWorkspace).facets.some(facet => facet.recipe.id === 'theta-grid'));
});

test('explicit predication binds the predicate to its named bearer without inventing a theta role', () => {
  for (const [label, field] of [['circumstantial predication', 'bearer'], ['predicative subject role', 'recipient']]) {
    const relation = { relation: label, anchors: { predicate: 'predicate', [field]: 'agent' } };
    const original = structuredClone(relation);
    const drawing = predication(relation);
    assert(drawing, label);
    assert.deepEqual(drawing.pairs, [{ fromNodeId: 'agent', toNodeId: 'predicate' }]);
    assert(!grid(relation));
    const claim = dispatch(relation).claims.find(claim => claim.tier === 2 && claim.facet.recipe.id === 'predication.dependency');
    assert.deepEqual(claim.consumedEvidence.map(({ field, key }) => [field, key]).sort(), [
      ['anchors', field], ['anchors', 'predicate']
    ].sort());
    assert.deepEqual(relation, original);
  }
});

test('a bearer alone, denied predication and competing bearers stay neutral', () => {
  const base = { relation: 'circumstantial predication', anchors: { predicate: 'predicate', bearer: 'agent' } };
  for (const relation of [
    { ...base, relation: 'a contextual observation' },
    { ...base, relation: 'no circumstantial predication' },
    { ...base, relation: 'possible predication' },
    { ...base, relation: 'circumstantial predication but no predication' },
    { ...base, values: { outcome: 'failed' } },
    { ...base, anchors: { ...base.anchors, recipient: 'theme' } },
    { ...base, anchors: { predicate: 'predicate', bearer: 'missing' } },
    { ...base, anchors: { predicate: 'predicate', bearer: 'predicate' } }
  ]) assert(!predication(relation), JSON.stringify(relation));
});
