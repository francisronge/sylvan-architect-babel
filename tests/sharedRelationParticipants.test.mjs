import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const saved = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));
const forest = [{ id: 'root', label: 'XP', children: ['a', 'b', 'extra'].map(id => ({ id, label: 'D', word: id })) }];
const stage = (relations, workspaceForest = forest) => ({ statement: 'State', stageRecord: 'The authored state.', relations, workspaceForest });
const inspect = (relation, currentForest = forest, priorForest = []) => {
  const input = structuredClone(relation);
  const stages = [...(priorForest.length ? [stage([], priorForest)] : []), stage([relation], currentForest)];
  const dispatch = dispatchRelationClaims({ relation, currentForest, priorForest, stageIndex: stages.length - 1, relationIndex: 0 });
  const plan = compileRelationRenderPlan(stages);
  assert.deepEqual(relation, input);
  return { dispatch, items: plan.frames.at(-1).items };
};
const witnesses = item => item.drawing.marks.map(mark => mark.witness);

for (const [name, stageIndex, relationIndex, expected] of [
  ['astra-xbar', 3, 1, ['complexC', 'tenseI']],
  ['fable-xbar', 4, 2, ['dp3', 'dp1', 'v1']]
]) {
  test(`${name}: recovered notation does not detach government participants`, () => {
    const record = saved.find(record => record.name === name);
    const current = record.derivationStages[stageIndex];
    const relation = current.relations[relationIndex];
    const result = inspect(relation, current.workspaceForest, record.derivationStages[stageIndex - 1].workspaceForest);
    const fallback = result.items.find(item => item.kind === 'fallback');
    assert.deepEqual(witnesses(fallback), expected);
    assert.deepEqual(result.dispatch.claims.find(claim => claim.tier === 3).contextAnchors, relation.anchors);
    assert.ok(result.items.some(item => item.kind !== 'fallback'));
    assert.ok(result.dispatch.evidenceCoverage.fields.some(field => field.field === 'anchors'
      && field.unrecoveredItemIndices.length), 'context is not counted as semantic recovery');
  });
}

for (const [name, anchors, values] of [
  ['Open binding claim', { binder: 'a', variable: 'b', unknownRole: 'extra' }],
  ['Open feature claim', { featureSource: 'a', valuedNode: 'b', unknownRole: 'extra' }, { feature: 'phi' }],
  ['Agree', { probe: 'a', goal: 'b', unknownRole: 'extra' }]
]) {
  test(`${name}: the residual keeps current context without changing the recovered claim`, () => {
    const relation = { relation: name, anchors, ...(values ? { values } : {}) };
    const full = inspect(relation);
    const { unknownRole, ...knownAnchors } = anchors;
    const known = inspect({ ...relation, anchors: knownAnchors });
    const fallback = full.items.find(item => item.kind === 'fallback');
    assert.deepEqual(witnesses(fallback), ['a', 'b', 'extra']);
    assert.deepEqual(full.dispatch.claims.filter(c => c.tier !== 3), known.dispatch.claims.filter(c => c.tier !== 3));
    assert.equal(full.dispatch.evidenceCoverage.fields.find(f => f.key === 'unknownRole').recognizedBy.length, 0);
    assert.equal(full.dispatch.primaryRelation.anchors.unknownRole ?? full.dispatch.residualRelation?.anchors.unknownRole, unknownRole);
  });
}

test('context preserves repeated entries and roles without changing leftover evidence', () => {
  const anchors = { binder: 'a', variable: 'b', additional: ['extra', 'extra'], anotherRole: 'a' };
  const result = inspect({ relation: 'Open binding', anchors });
  const residual = result.dispatch.claims.find(claim => claim.tier === 3);
  assert.deepEqual(residual.contextAnchors, anchors);
  assert.deepEqual(result.dispatch.primaryRelation.anchors, { additional: ['extra', 'extra'], anotherRole: 'a' });
  assert.deepEqual(residual.consumedEvidence, [{ field: 'anchors', key: 'additional' }, { field: 'anchors', key: 'anotherRole' }]);
});

test('a value-only remainder does not grow a duplicate participant connector', () => {
  const result = inspect({ relation: 'Open binding', anchors: { binder: 'a', variable: 'b' }, values: { qualification: 'Uninterpreted prose.' } });
  const residual = result.dispatch.claims.find(claim => claim.tier === 3);
  assert.ok(residual);
  assert.equal(residual.contextAnchors, undefined);
  assert.deepEqual(witnesses(result.items.find(item => item.kind === 'fallback')), []);
});

test('current context never borrows a recognized earlier-stage witness', () => {
  const relation = { relation: 'Agree', anchors: { probe: 'a', goal: 'b', unexplained: 'extra' }, priorAnchors: { probe: 'a' } };
  const result = inspect(relation, forest, forest);
  const fallback = result.items.find(item => item.kind === 'fallback');
  assert.deepEqual(witnesses(fallback), ['a', 'b', 'extra']);
  assert.equal(fallback.backward, false);
  assert.deepEqual(fallback.priorWitnessNodeIds, []);
  assert.equal(fallback.relationRef.priorAnchors, undefined);
});

test('shared context does not relax an incomplete exact Tier-1 claim', () => {
  const result = inspect({ relation: 'BlockedExtraction', anchors: { target: 'b', adjunctDomain: 'root', analysis: 'root' },
    values: { outcome: 'blocked', judgment: '*', label: 'extraction' } });
  assert.equal(result.dispatch.primaryClaim.tier, 3);
  assert.equal(result.dispatch.primaryClaim.reason, 'registered-signature-incomplete');
  assert.ok(!result.dispatch.claims.some(claim => claim.tier === 1));
  assert.ok(result.dispatch.claims.some(claim => claim.tier === 2));
});

test('restored context retains relation-only persistence and the authored badge number', () => {
  const relation = { relation: 'Open binding', anchors: { binder: 'a', variable: 'b', unknownRole: 'extra' } };
  const plan = compileRelationRenderPlan([stage([{ relation: 'Other claim', anchors: { witness: 'root' } }, relation]), stage([])]);
  const fallback = plan.frames[0].items.find(item => item.kind === 'fallback' && item.relationRef.relationIndex === 1);
  assert.deepEqual(witnesses(fallback), ['a', 'b', 'extra']);
  assert.ok(fallback.drawing.marks.every(mark => mark.instance === 2));
  assert.equal(fallback.persistence, 'relation-only');
  assert.ok(!plan.frames[1].items.some(item => item.kind === 'fallback'));
});

test('fallback identity distinguishes different shared participants with identical leftover fields', () => {
  const relation = { relation: 'Open binding', anchors: { binder: 'a', variable: 'b', unknownRole: 'extra' } };
  const first = inspect(relation).dispatch.primaryClaim;
  const second = inspect({ ...relation, anchors: { ...relation.anchors, binder: 'root' } }).dispatch.primaryClaim;
  assert.notEqual(first.canonicalClaimIdentity, second.canonicalClaimIdentity);
  assert.deepEqual(first.consumedEvidence, second.consumedEvidence);
});
