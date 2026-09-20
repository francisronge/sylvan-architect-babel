import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan, visiblePlanFrameItems, planItemRelationRefs, planItemDependencyNodeIds } from '../replay/relations/renderPlanCompiler.ts';
import { plaqueIdentity } from '../replay/relations/plaquePlacement.ts';
import { projectThetaGrid } from '../replay/relations/thetaGridComposition.ts';

const leaf = (id, word) => ({ id, label: 'X', word });
const forest = [{ id: 'vp', label: 'VP', children: [leaf('agent', 'Mia'),
  { id: 'bar', label: "V'", children: [leaf('v', 'bought'), leaf('theme', 'books')] }] }];
const theta = (arguments_, labels) => ({ relation: 'ThetaAssignment', anchors: { predicate: 'v', arguments: arguments_ }, values: { arguments: labels } });
const early = theta(['theme'], ['Theme']);
const late = theta(['agent', 'theme'], ['Agent', 'Theme']);
const stage = (relations, workspaceForest = forest) => ({ statement: 'A stage', stageRecord: 'A record', relations, workspaceForest });
const grids = items => items.filter(item => item.plaqueStyle === 'theta-grid');
const refs = role => role.relationRefs.map(ref => [ref.stageIndex, ref.relationIndex]);

test('a growing role grid retains row history, original stages and stable placement identity', () => {
  const stages = [stage([early]), stage([late])], original = structuredClone(stages);
  const plan = compileRelationRenderPlan(stages);
  assert.deepEqual(stages, original);
  const first = grids(plan.frames[0].items)[0], final = grids(plan.frames[1].items);
  assert.equal(final.length, 1);
  assert.equal(plaqueIdentity(first), plaqueIdentity(final[0]));
  assert.deepEqual(final[0].thetaRoles.map(row => [row.nodeId, row.label]), [['theme', 'Theme'], ['agent', 'Agent']]);
  assert.deepEqual(refs(final[0].thetaRoles[0]), [[0, 0], [1, 0]]);
  assert.deepEqual(refs(final[0].thetaRoles[1]), [[1, 0]]);
  assert.deepEqual(planItemRelationRefs(final[0]).map(ref => [ref.stageIndex, ref.relationIndex]), [[0, 0], [1, 0]]);
  const before = grids(visiblePlanFrameItems(plan, 1, new Set()))[0];
  assert.deepEqual(before.thetaRoles.map(row => row.label), ['Theme']);
  assert.deepEqual(planItemDependencyNodeIds(before).sort(), ['theme', 'v']);
  assert.equal(grids(visiblePlanFrameItems(plan, 1, new Set([0])))[0].thetaRoles.length, 2);
  assert.equal(first.thetaRoles.length, 1, 'later composition cannot mutate the previous stage');
});

test('same-stage rows follow exact played moments, including out-of-order replay', () => {
  const plan = compileRelationRenderPlan([stage([early, late])]);
  assert.equal(grids(visiblePlanFrameItems(plan, 0, new Set())).length, 0);
  assert.deepEqual(grids(visiblePlanFrameItems(plan, 0, new Set([0])))[0].thetaRoles.map(row => row.label), ['Theme']);
  const laterFirst = grids(visiblePlanFrameItems(plan, 0, new Set([1])))[0];
  assert.deepEqual(laterFirst.thetaRoles.map(row => row.label), ['Theme', 'Agent']);
  assert.deepEqual(refs(laterFirst.thetaRoles[0]), [[0, 1]]);
  assert.equal(grids(visiblePlanFrameItems(plan, 0, null))[0].thetaRoles.length, 2);
});

test('different predicates, conflicting roles, repeated recipients and historical claims stay separate', () => {
  for (const relation of [
    { ...late, anchors: { ...late.anchors, predicate: 'agent' } },
    theta(['agent', 'theme'], ['Agent', 'Goal']),
    theta(['agent', 'theme', 'theme'], ['Agent', 'Theme', 'Theme']),
    { ...late, priorAnchors: { predicate: 'v', argument: 'theme' } }
  ]) {
    const plan = compileRelationRenderPlan([stage([early]), stage([relation])]);
    assert.equal(grids(plan.frames[1].items).length, 2);
  }
});

test('a vanished recipient cannot leave its old row in a surviving later grid', () => {
  const next = [structuredClone(forest[0])];
  next[0].children[1].children.pop();
  const plan = compileRelationRenderPlan([stage([early, late]), stage([theta(['agent'], ['Agent'])], next)]);
  const final = grids(plan.frames[1].items);
  assert.equal(final.length, 1);
  assert.deepEqual(final[0].thetaRoles.map(row => row.nodeId), ['agent']);
});

test('row projection never modifies the complete reservation or changes role order', () => {
  const plan = compileRelationRenderPlan([stage([early, late])]);
  const full = grids(plan.frames[0].items)[0], original = structuredClone(full);
  projectThetaGrid(full, 0, new Set([0]));
  assert.deepEqual(full, original);
});


test('reusing a predicate ID for a different lineage cannot merge its assignments', () => {
  const changed = structuredClone(forest);
  changed[0].children[1].children[0].lineageId = 'different-predicate';
  const plan = compileRelationRenderPlan([stage([early]), stage([late], changed)]);
  assert.equal(grids(plan.frames[1].items).length, 2);
});
