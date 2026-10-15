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

const projectionForest = [{ id: 'clause', label: 'TP', children: [
  { id: 'subject', label: 'DP', word: 'Nora' },
  { id: 'modal', label: 'V', word: 'might' },
  { id: 'projection', label: 'VP', children: [
    { id: 'object', label: 'DP', word: 'the letter' },
    { id: 'bar', label: 'V′', children: [{ id: 'head', label: 'V', word: 'write' }] }
  ] }
] }];
const projectionAssignment = { relation: 'External theta-role assignment by predication',
  anchors: { predicate: 'projection', lexicalPredicate: 'head', subject: 'subject' },
  values: { thetaRole: 'Agent', interpretation: 'The lexical predicate supplies the external role.' } };
const projectionPlan = (relation = projectionAssignment, currentForest = projectionForest) => compileRelationRenderPlan([
  { statement: '', stageRecord: '', workspaceForest: currentForest, relations: [relation] }
]).frames[0].items;

test('a predicate projection owns its assignment when its lexical head is uniquely corroborated', () => {
  for (const qualification of ['', ' by predication', ' through predication']) {
    for (const contextRole of ['verb', 'lexicalVerb', 'lexicalHead', 'lexicalPredicate']) {
      const relation = { ...projectionAssignment, relation: `External theta-role assignment${qualification}`,
        anchors: { predicate: 'projection', [contextRole]: 'head', subject: 'subject' } };
      const original = structuredClone(relation), items = projectionPlan(relation);
      const grid = items.find(item => item.plaqueStyle === 'theta-grid');
      assert.deepEqual(grid?.anchorNodeIds, ['projection']);
      assert.deepEqual(grid?.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label })), [{ nodeId: 'subject', label: 'Agent' }]);
      assert(items.some(item => item.kind === 'fallback' && item.relationRef.anchors[contextRole] === 'head'), 'head context stays inspectable');
      assert.deepEqual(relation, original);
    }
    const assigned = projectionPlan({ ...projectionAssignment, relation: `External theta-role assignment${qualification}`,
      anchors: { assigner: 'head', predicate: 'projection', subject: 'subject' } });
    assert.deepEqual(assigned.find(item => item.plaqueStyle === 'theta-grid')?.anchorNodeIds, ['head'], 'the explicitly assigning head owns the grid');
  }
});

test('projection context cannot hide a competing predicate or an ambiguous head spine', () => {
  const alternatives = [
    { relation: { ...projectionAssignment, anchors: { ...projectionAssignment.anchors, lexicalPredicate: 'modal' } } },
    { relation: { ...projectionAssignment, anchors: { ...projectionAssignment.anchors, lexicalPredicate: 'bar' } } },
    { relation: { ...projectionAssignment, anchors: { ...projectionAssignment.anchors, lexicalPredicate: ['head', 'modal'] } } },
    { relation: { ...projectionAssignment, anchors: { ...projectionAssignment.anchors, verb: 'head' } } },
    { forest: [{ ...projectionForest[0], children: [...projectionForest[0].children, { id: 'head', label: 'V', word: 'read' }] }] },
    { forest: [{ ...projectionForest[0], children: projectionForest[0].children.map(node => node.id !== 'projection' ? node :
      { ...node, children: [...node.children, { id: 'secondHead', label: 'V', word: 'read' }] }) }] },
    { forest: [{ ...projectionForest[0], children: projectionForest[0].children.map(node => node.id !== 'projection' ? node :
      { ...node, children: [{ id: 'embedded', label: 'CP', children: node.children }] }) }] }
  ];
  for (const alternative of alternatives) assert(!projectionPlan(alternative.relation, alternative.forest)
    .some(item => item.plaqueStyle === 'theta-grid'), JSON.stringify(alternative));
});

test('projection corroboration preserves provisional, denied and malformed claims', () => {
  for (const prefix of ['no', 'pending', 'possible', 'unresolved', 'failed'])
    assert(!projectionPlan({ ...projectionAssignment, relation: `${prefix} ${projectionAssignment.relation}` })
      .some(item => item.plaqueStyle === 'theta-grid'), prefix);
  for (const status of ['pending', 'failed', ['licensed', 'failed']])
    assert(!projectionPlan({ ...projectionAssignment, values: { ...projectionAssignment.values, status } })
      .some(item => item.plaqueStyle === 'theta-grid'), JSON.stringify(status));
  assert(!projectionPlan({ ...projectionAssignment, relationContractFailure: { code: 'test-malformed' } })
    .some(item => item.plaqueStyle === 'theta-grid'));
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
