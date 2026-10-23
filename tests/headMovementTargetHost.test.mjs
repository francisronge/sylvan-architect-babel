import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelation } from '../replay/relationDispatch/relationDispatch.js';
import { productionRelationRegistry } from '../replay/relationDispatch/productionRegistry.js';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

// French causative head movement as GPT-6.1 Sol authored it
// (sol-ambiguity-test-20261023/n3-39-fr-clitic-climbing): `fait` adjoins to
// silent T, and the exact registered name "head movement" calls that T head
// its `target`.
const causative = (id, extra = {}) => ({ id, label: 'Caus[faire]', lineageId: 'causative', word: 'faire', ...extra });
const vP = lower => ({ id: 'vP', label: 'v', children: [
  { id: 'v', label: 'v', silent: true },
  { id: 'CausP', label: 'Caus', children: [lower, { id: 'V', label: 'V[infinitive]', word: 'lire' }] }
] });
const stages = (relation, tense = 'T') => [{
  statement: 'T merges with the causative phrase.', stageRecord: 'T selects vP.', relations: [],
  workspaceForest: [{ id: 'TP', label: 'T', children: [{ id: tense, label: 'T[present]', silent: true }, vP(causative('faire'))] }]
}, {
  statement: 'The causative head moves to T.', stageRecord: 'faire adjoins to T.', relations: [relation],
  workspaceForest: [{ id: 'TP', label: 'T', children: [
    { id: 'TComplex', label: 'T', children: [causative('fait', { label: 'Caus[faire, finite]', word: 'fait' }), { id: tense, label: 'T[present]', silent: true }] },
    vP(causative('faire', { silent: true }))
  ] }]
}];
const headMovement = anchors => ({ relation: 'head movement', anchors, values: { pronunciation: 'upper occurrence only' } });
const dispatch = derivation => dispatchRelation({ registry: productionRelationRegistry, relation: derivation[1].relations[0],
  stageIndex: 1, relationIndex: 0, currentForest: derivation[1].workspaceForest, priorForest: derivation[0].workspaceForest });
const issues = result => [...(result.signatureIssues ?? []), ...(result.issues ?? [])];
const drawings = derivation => compileRelationRenderPlan(derivation).frames[1].items
  .filter(item => item.relationRef?.stageIndex === 1 && item.relationRef.relationIndex === 0)
  .map(item => item.kind === 'trajectory' ? `trajectory T${item.claimTier} ${item.sourceNodeId}->${item.targetNodeId}` : `${item.kind} T${item.claimTier}`);

test('a head-movement target the tree proves to be the landing host binds as that host, not a second landing', () => {
  const derivation = stages(headMovement({ landing: 'fait', source: 'faire', target: 'T' }));
  const original = JSON.stringify(derivation);
  const result = dispatch(derivation);
  assert.deepEqual(issues(result), []);
  assert.deepEqual(result.roleBindings.find(binding => binding.authoredRole === 'target'),
    { field: 'anchors', authoredRole: 'target', role: 'hostHead', concept: 'movement.host' });
  assert.deepEqual(drawings(derivation), ['trajectory T1 faire->fait']);
  assert.equal(JSON.stringify(derivation), original, 'the authored analysis is unchanged');
});

test('a head-movement target that is neither the landing host nor its complex still competes for the landing', () => {
  for (const target of ['TP', 'vP']) {
    const derivation = stages(headMovement({ landing: 'fait', source: 'faire', target }));
    assert.ok(issues(dispatch(derivation)).some(issue => issue.kind === 'conflicting-role-bindings'), target);
    assert.ok(!drawings(derivation).some(drawing => drawing.startsWith('trajectory T1')), target);
  }
});

test('a target that is the landing itself keeps its registered landing slot', () => {
  const derivation = stages(headMovement({ source: 'faire', target: 'fait' }));
  const result = dispatch(derivation);
  assert.deepEqual(issues(result), []);
  assert.equal(result.roleBindings.find(binding => binding.authoredRole === 'target').role, 'target');
  assert.deepEqual(drawings(derivation), ['trajectory T1 faire->fait']);
});
