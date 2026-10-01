import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const forest = [{ id: 'domain', label: 'vP', children: [
  { id: 'introducer', label: 'v' },
  { id: 'predicate', label: 'V', word: 'gave' },
  { id: 'agent', label: 'DP', word: 'Nora' },
  { id: 'theme', label: 'DP', word: 'the book' },
  { id: 'recipient', label: 'PP', word: 'to Mia' }
] }];
const dispatch = (relation, currentForest = forest) => dispatchRelationClaims({ relation, currentForest, stageIndex: 0, relationIndex: 0 });
const plan = relation => compileRelationRenderPlan([{ statement: '', stageRecord: '', workspaceForest: forest, relations: [relation] }]).frames[0].items;
const grid = relation => plan(relation).find(item => item.plaqueStyle === 'theta-grid');
const roles = relation => grid(relation)?.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label }));
const inventory = { relation: 'theta-role assignment', anchors: { predicate: 'predicate', agent: 'agent', theme: 'theme' } };
const paired = { relation: 'Internal theta-role assignment', anchors: { predicate: 'predicate', recipient: 'recipient', theme: 'theme' },
  values: { recipientRole: 'Recipient', themeRole: 'Theme' } };

test('complete named-role inventories retain the exact registered theta drawing', () => {
  const before = structuredClone(inventory);
  assert.deepEqual(roles(inventory), [{ nodeId: 'agent', label: 'Agent' }, { nodeId: 'theme', label: 'Theme' }]);
  assert(dispatch(inventory).claims.some(claim => claim.tier === 1 && claim.registryEntryId === 'theta.grid'));
  assert.deepEqual(inventory, before);
  assert.deepEqual(roles({ ...inventory, values: { interpretation: 'Nora gives the book' } }), roles(inventory));
});

test('interpretive grammatical-role values preserve an already complete named-role inventory', () => {
  const relation = { relation: 'thematic interpretation', anchors: { predicate: 'predicate', experiencer: 'agent', stimulus: 'theme' },
    values: { objectRole: 'experiencer', subjectRole: 'stimulus' } };
  assert.deepEqual(roles(relation), [{ nodeId: 'agent', label: 'experiencer' }, { nodeId: 'theme', label: 'stimulus' }]);
});

test('participant-specific role values outrank scalar assignment recovery and title modifiers', () => {
  for (const relation of [paired, { ...paired, relation: 'External thematic-role assignment' },
    { ...paired, relation: 'Unfamiliar theta-role assignment' }]) {
    const before = structuredClone(relation);
    assert.deepEqual(roles(relation), [{ nodeId: 'recipient', label: 'Recipient' }, { nodeId: 'theme', label: 'Theme' }]);
    assert.deepEqual(relation, before);
    const claims = dispatch(relation).claims.filter(claim => claim.tier < 3);
    assert.equal(claims.filter(claim => claim.facet?.recipe.id === 'theta-grid').length, 1);
  }
});

test('explicit named roles precede arbitrary title literals without changing authored wording', () => {
  for (const prefix of ['give', 'send', 'transfer', 'Unfamiliar']) {
    const relation = { ...inventory, relation: `${prefix} theta-role assignment`, anchors: { verb: 'predicate', agent: 'agent', theme: 'theme', recipient: 'recipient' } };
    const original = structuredClone(relation);
    assert.deepEqual(roles(relation), [{ nodeId: 'agent', label: 'agent' }, { nodeId: 'theme', label: 'theme' }, { nodeId: 'recipient', label: 'recipient' }]);
    assert.deepEqual(relation, original);
    assert.deepEqual(grid(relation).relationRef.anchors, relation.anchors);
  }
});

test('an explicit introducer owns assignment while its lexical predicate stays contextual', () => {
  for (const label of ['theta-role', 'external theta-role assignment']) {
    const relation = { relation: label, anchors: { introducer: 'introducer', predicate: 'predicate', argument: 'agent' }, values: { role: 'perceiver' } };
    assert.deepEqual(roles(relation), [{ nodeId: 'agent', label: 'perceiver' }]);
    assert.deepEqual(grid(relation).anchorNodeIds, ['introducer']);
    const claim = dispatch(relation).claims.find(claim => claim.facet?.recipe.id === 'theta-grid');
    assert.deepEqual(claim.consumedEvidence.map(({ field, key }) => [field, key]).sort(), [
      ['anchors', 'argument'], ['anchors', 'introducer'], ['values', 'role']
    ]);
    assert(dispatch(relation).claims.some(claim => claim.tier === 3), 'lexical context remains inspectable');
  }
});

test('qualified subject assignments keep their complete explicit role despite longer labels', () => {
  for (const label of ['embedded subject theta-role assignment', 'matrix subject theta-role assignment']) {
    const relation = { relation: label, anchors: { assigner: 'predicate', recipient: 'agent' }, values: { role: 'Agent' } };
    assert.deepEqual(roles(relation), [{ nodeId: 'agent', label: 'Agent' }]);
  }
});

test('a complete explicit role survives a separate predication qualification', () => {
  const relation = { relation: 'external theta-role assignment through predication',
    anchors: { argument: 'agent', lexicalPredicate: 'predicate', predicateProjection: 'domain' }, values: { role: 'Agent' } };
  assert.deepEqual(roles(relation), [{ nodeId: 'agent', label: 'Agent' }]);
});

test('inventory precedence preserves denial, provisional and competing-outcome boundaries', () => {
  for (const record of [inventory, paired, { ...inventory, relation: 'give theta-role assignment' }]) {
    for (const modifier of ['no', 'not', 'without', 'possible', 'potential', 'hypothetical', 'pending', 'unresolved', 'unestablished', 'failed', 'blocked', 'unlicensed'])
      assert(!grid({ ...record, relation: `${modifier} ${record.relation}` }), `${modifier} ${record.relation}`);
    for (const status of ['failed', 'pending', 'blocked', 'unknown', ['licensed', 'failed']])
      assert(!grid({ ...record, values: { ...record.values, status } }), JSON.stringify({ record, status }));
  }
  assert(!grid({ ...inventory, relation: 'agent theta-role and theme theta-role' }));
  assert(!grid({ ...inventory, relation: 'agent theta-role is sometimes assigned' }));
});

test('incomplete participant pairs and competing endpoints cannot acquire a theta grid', () => {
  for (const relation of [
    { ...paired, values: { recipientRole: 'Recipient' } },
    { ...paired, values: { ...paired.values, themeRole: '' } },
    { ...paired, values: { ...paired.values, themeRole: ['Theme', 'Patient'] } },
    { ...paired, values: { ...paired.values, theme_role: 'Patient' } },
    { ...paired, anchors: { ...paired.anchors, theme: 'missing' } },
    { ...paired, anchors: { ...paired.anchors, theme: 'recipient' } },
    { ...paired, anchors: { ...paired.anchors, theme: ['theme', 'agent'] } },
    { ...paired, anchors: { ...paired.anchors, verb: 'introducer' } },
    { ...inventory, anchors: { agent: 'agent', theme: 'theme' } },
    { ...inventory, anchors: { ...inventory.anchors, predicate: ['predicate', 'introducer'] } }
  ]) assert(!grid(relation), JSON.stringify(relation));
  const malformed = dispatch({ ...inventory, anchors: { ...inventory.anchors, predicate: 'missing' } });
  assert(!malformed.claims.some(claim => claim.tier < 3), 'incomplete exact Tier 1 remains neutral');
});
