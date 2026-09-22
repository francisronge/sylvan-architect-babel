import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileRelationRenderPlan, planItemOwnsRelationMoment, planItemRelationRefs, visiblePlanFrameItems
} from '../replay/relations/renderPlanCompiler.ts';

const agreement = { relation: 'Agree', anchors: { probe: 'tFinite', goal: 'dLower' }, values: { person: 'third', number: 'plural' } };
const forest = (label, ids = {}) => [{ id: 'clause', label: 'TP', children: [
  { id: ids.probe ?? 'tFinite', label, lineageId: ids.lineage ?? 'tense', silent: true },
  { id: ids.goal ?? 'dLower', label: 'DP', lineageId: 'subject', word: 'children' }
] }];
const stage = (label, relations = [], ids) => ({
  statement: 'A completed state', stageRecord: 'The authored record.', workspaceForest: forest(label, ids), relations
});
const stages = (later = agreement, ids) => [
  stage('T'), stage('T'),
  stage('T [present; person:3, number:plural; EPP]', [agreement]),
  stage('T [present; person:3, number:plural; EPP satisfied]', [later], ids)
];
const plaques = items => items.filter(item => item.kind === 'node-plaque' && item.plaqueStyle === 'feature');

test('a changed T label does not duplicate an unchanged persistent Agree plaque', () => {
  const input = stages(), before = structuredClone(input), plan = compileRelationRenderPlan(input);
  const first = plaques(plan.frames[2].items), final = plaques(plan.frames[3].items);
  assert.equal(first.length, 1);
  assert.equal(final.length, 1);
  assert.deepEqual(final[0].rows, [{ label: 'person', value: 'third' }, { label: 'number', value: 'plural' }]);
  assert.deepEqual(final[0].anchorNodeIds, ['tFinite']);
  assert.deepEqual(planItemRelationRefs(final[0]).map(ref => [ref.stageIndex, ref.relationIndex]), [[2, 0], [3, 0]]);
  assert.deepEqual(planItemRelationRefs(first[0]).map(ref => [ref.stageIndex, ref.relationIndex]), [[2, 0]], 'future ownership cannot leak into earlier frames');
  for (const stageIndex of [2, 3]) assert(planItemOwnsRelationMoment(final[0], stageIndex, 0));
  assert.equal(planItemOwnsRelationMoment(final[0], 3, 1), false);
  assert.equal(plaques(visiblePlanFrameItems(plan, 2, new Set())).length, 0);
  assert.equal(plaques(visiblePlanFrameItems(plan, 2, new Set([0]), 0)).length, 1);
  assert.equal(plaques(visiblePlanFrameItems(plan, 3, new Set())).length, 1, 'the old claim persists before its restatement');
  assert.equal(plaques(visiblePlanFrameItems(plan, 3, new Set([0]), 0)).length, 1);
  assert.equal(final[0].title, first[0].title, 'consolidation keeps the original heading and does not reveal a future label early');
  assert.deepEqual(input, before);
});

test('different feature values, goals and occurrence lineages remain separate claims', () => {
  for (const [later, ids, extraNodes] of [
    [{ ...agreement, values: { person: 'third', number: 'singular' } }, {}, []],
    [{ ...agreement, anchors: { probe: 'tOther', goal: 'dLower' } }, {}, [{ id: 'tOther', label: 'T', lineageId: 'tense' }]],
    [{ ...agreement, anchors: { probe: 'tFinite', goal: 'dOther' } }, {}, [{ id: 'dOther', label: 'DP', lineageId: 'subject' }]],
    [agreement, { lineage: 'another-tense-occurrence' }, []]
  ]) {
    const input = stages(later, ids);
    input[3].workspaceForest[0].children.push(...extraNodes);
    const plan = compileRelationRenderPlan(input), final = plaques(plan.frames[3].items);
    assert.equal(final.length, 2, JSON.stringify({ later, ids }));
    assert(final.every(item => planItemRelationRefs(item).length === 1));
    assert.equal(plaques(visiblePlanFrameItems(plan, 3, new Set())).length, 1);
    assert.equal(plaques(visiblePlanFrameItems(plan, 3, new Set([0]), 0)).length, 2);
  }
});

test('disappeared exact participants are not replaced by their lineage siblings', () => {
  const later = { ...agreement, anchors: { probe: 'replacementT', goal: 'dLower' } };
  const plan = compileRelationRenderPlan(stages(later, { probe: 'replacementT' }));
  const final = plaques(plan.frames[3].items);
  assert.equal(final.length, 1);
  assert.deepEqual(final[0].anchorNodeIds, ['replacementT']);
  assert.deepEqual(planItemRelationRefs(final[0]).map(ref => [ref.stageIndex, ref.relationIndex]), [[3, 0]]);
  assert.equal(plaques(visiblePlanFrameItems(plan, 3, new Set())).length, 0);
  assert(plan.diagnostics.some(diagnostic => diagnostic.kind === 'anchor-vanished'));
});

test('FeatureBundle replacement still happens only at its owning moment', () => {
  const bundle = { relation: 'FeatureBundle', anchors: { bearer: 'tFinite' }, values: { person: 'third', number: 'plural' } };
  const input = stages();
  input[2].relations = [bundle];
  input[3].relations = [{ ...bundle, relation: 'featurebundle' }];
  const plan = compileRelationRenderPlan(input);
  const before = plaques(visiblePlanFrameItems(plan, 3, new Set()));
  const after = plaques(visiblePlanFrameItems(plan, 3, new Set([0]), 0));
  assert.equal(before.length, 1);
  assert.equal(after.length, 1);
  assert.deepEqual(planItemRelationRefs(before[0]).map(ref => [ref.stageIndex, ref.relationIndex]), [[2, 0]]);
  assert.deepEqual(planItemRelationRefs(after[0]).map(ref => [ref.stageIndex, ref.relationIndex]), [[3, 0]]);
  assert.equal(before[0].title.includes('satisfied'), false);
  assert.equal(after[0].title.includes('satisfied'), true);
  assert.equal(plaques(visiblePlanFrameItems(plan, 3, null)).length, 1);
});
