import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { dispatchStageRelations } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan, planItemRelationRefs } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';

const stage = (workspaceForest, relations) => ({ statement: '', stageRecord: '', workspaceForest, relations });
const prior = () => [{ id: 'root', label: 'TP', children: [
  { id: 'tense', label: 'T', silent: true },
  { id: 'vp', label: 'VP', children: [
    { id: 'verb', label: 'V', word: 'want' },
    { id: 'low', label: 'NP', word: 'Mia', lineageId: 'person' },
    { id: 'cp', label: 'CP', children: [{ id: 'pro', label: 'NP[PRO]', word: 'PRO', silent: true, lineageId: 'controlled' }] }
  ] }
] }];
const current = () => {
  const forest = prior();
  forest[0].children.unshift({ id: 'high', label: 'NP', word: 'Mia', lineageId: 'person' });
  forest[0].children[2].children[1].silent = true;
  return forest;
};
const control = { relation: 'Obligatory subject control', anchors: { controller: 'low', controlledPRO: 'pro' } };
const chain = { relation: 'Obligatory subject control', anchors: { controllerOccurrences: ['high', 'low'], controlledPRO: 'pro' },
  values: { dependencyType: 'control rather than movement', reference: 'coreferential' } };
const stages = () => [stage(prior(), [structuredClone(control)]), stage(current(), [structuredClone(chain)])];
const controlFacet = ds => dispatchStageRelations(ds).at(-1).at(-1).facets.find(f => f.recipe.id === 'control.dependency');
const find = (forest, id) => forest.flatMap(n => [n, ...flatten(n.children ?? [])]).find(n => n.id === id);
const flatten = forest => forest.flatMap(n => [n, ...flatten(n.children ?? [])]);

test('an authored controller chain retains its earlier exact controller independent of array order', () => {
  for (const order of [['high', 'low'], ['low', 'high']]) {
    const ds = stages(); ds[1].relations[0].anchors.controllerOccurrences = order;
    const before = structuredClone(ds);
    const dispatch = dispatchStageRelations(ds)[1][0];
    const recovered = dispatch.facets.find(f => f.recipe.id === 'control.dependency');
    assert(recovered);
    assert.deepEqual(recovered.evidence.currentAnchors.controller, ['low']);
    assert.deepEqual(recovered.evidence.currentAnchors.controllee, ['pro']);
    assert(dispatch.facets.some(f => f.recipe.id === 'identity.occurrences'));
    const coverage = dispatch.evidenceCoverage.fields.find(f => f.key === 'controllerOccurrences');
    assert.deepEqual(coverage.recognizedBy.find(o => o.claim === 'control.dependency').itemIndices, [order.indexOf('low')]);
    assert.deepEqual(coverage.recognizedBy.find(o => o.claim === 'identity.occurrences').itemIndices, [0, 1]);
    const plan = compileRelationRenderPlan(ds);
    const paths = plan.frames[1].items.filter(i => i.pathStyle === 'control');
    assert.equal(paths.length, 1);
    assert.equal(paths[0].fromNodeId, 'low'); assert.equal(paths[0].toNodeId, 'pro');
    assert.deepEqual(planItemRelationRefs(paths[0]).map(r => [r.stageIndex, r.relationIndex]), [[0, 0], [1, 0]]);
    assert.deepEqual(ds, before);
  }
});

test('the saved Mia analysis gives stage 4 relation 13 the existing control connector', () => {
  const records = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/restated-chains.json', import.meta.url)));
  const saved = records.find(r => r.name === 'raising-control-xbar-sol');
  const before = structuredClone(saved);
  const dispatch = dispatchStageRelations(saved.derivationStages)[3][12];
  const facet = dispatch.facets.find(f => f.recipe.id === 'control.dependency');
  assert(facet);
  assert.deepEqual(facet.evidence.currentAnchors.controller, ['miaLow']);
  assert.deepEqual(facet.evidence.currentAnchors.controllee, ['proLeave']);
  assert(dispatch.facets.some(f => f.recipe.id === 'identity.occurrences'));
  const paths = compileRelationRenderPlan(saved.derivationStages).frames[3].items.filter(i => i.pathStyle === 'control');
  assert.equal(paths.length, 1);
  assert.deepEqual(planItemRelationRefs(paths[0]).map(r => [r.stageIndex, r.relationIndex]), [[1, 4], [2, 4], [3, 12]]);
  assert.deepEqual(saved, before);
});

test('a chain restatement keeps the existing measured control path and coindices', () => {
  const plan = compileRelationRenderPlan(stages());
  const positions = { low: { x: 120, y: 200 }, pro: { x: 380, y: 310 }, high: { x: 0, y: 90 } };
  const paths = plan.frames.map(frame => ({ ...frame, items: frame.items.filter(i => i.pathStyle === 'control') }));
  const onlyPaths = { ...plan, frames: paths };
  const before = bindRelationPlanFrame(onlyPaths, 0, id => positions[id] ?? null);
  const after = bindRelationPlanFrame(onlyPaths, 1, id => positions[id] ?? null);
  assert.deepEqual(before.failed, []); assert.deepEqual(after.failed, []);
  assert.equal(after.primitives.length, 1);
  assert.deepEqual(after.primitives, before.primitives);
  assert.equal(after.primitives[0].shapeStyle, 'control');
  assert.equal(after.primitives[0].arrowhead, true);
  const indices = plan.frames.map(frame => frame.items.find(i => i.familyId === 'control.dependency' && i.kind === 'coindex'));
  assert.equal(indices[1].index, indices[0].index);
  assert.deepEqual(indices[1].nodeIds, ['low', 'pro']);
});

test('chains without a unique earlier control owner do not invent a connector', () => {
  const absent = stages(); absent[0].relations = [];
  assert.equal(controlFacet(absent), undefined);
  const competing = stages(); competing[0].workspaceForest = current();
  competing[0].relations.push({ ...control, anchors: { controller: 'high', controlledPRO: 'pro' } });
  assert.equal(controlFacet(competing), undefined);
  const later = stages(); later[0].relations = []; later[1].relations.push(control);
  assert(!dispatchStageRelations(later)[1][0].facets.some(f => f.recipe.id === 'control.dependency'));
});

test('unrelated, duplicate, missing or conflicting controller lists remain neutral', () => {
  const mutations = [
    ds => { find(ds[1].workspaceForest, 'high').lineageId = 'another-person'; },
    ds => { find(ds[1].workspaceForest, 'high').lineageId = ' person '; },
    ds => { delete find(ds[1].workspaceForest, 'high').lineageId; },
    ds => { ds[1].relations[0].anchors.controllerOccurrences = ['low', 'low']; },
    ds => { ds[1].relations[0].anchors.controllerOccurrences = ['low', 'missing']; },
    ds => { ds[1].relations[0].anchors.controllerChain = ['low', 'high']; },
    ds => { ds[1].relations[0].priorAnchors = { controller: 'other' }; },
    ds => { ds[1].relations[0].anchors.controlledPRO = ['pro', 'pro']; },
    ds => { ds[1].workspaceForest.push(structuredClone(find(ds[1].workspaceForest, 'low'))); }
  ];
  for (const mutate of mutations) { const ds = stages(); mutate(ds); assert.equal(controlFacet(ds), undefined); }
});

test('a controller occurrence cannot disappear, change lineage or change position and resume by name', () => {
  for (const mutate of [
    forest => { find(forest, 'vp').children = find(forest, 'vp').children.filter(n => n.id !== 'low'); },
    forest => { find(forest, 'low').lineageId = 'replacement'; },
    forest => { const children = find(forest, 'vp').children; [children[0], children[1]] = [children[1], children[0]]; },
    forest => { const vp = find(forest, 'vp'); const low = find(forest, 'low'); vp.children = vp.children.filter(n => n !== low); forest.push(low); }
  ]) {
    const ds = stages(), between = current(); mutate(between); ds.splice(1, 0, stage(between, []));
    assert.equal(controlFacet(ds), undefined);
  }
});

test('controllee gaps and replacements also invalidate earlier control ownership', () => {
  for (const mutate of [
    forest => { find(forest, 'cp').children = []; },
    forest => { find(forest, 'pro').lineageId = 'replacement'; }
  ]) {
    const ds = stages(), between = current(); mutate(between); ds.splice(1, 0, stage(between, []));
    assert.equal(controlFacet(ds), undefined);
  }
  const deniedOwner = stages(); deniedOwner[0].relations[0].relation = 'No subject control';
  assert.equal(controlFacet(deniedOwner), undefined);
  const shiftedControllee = stages();
  for (const entry of shiftedControllee) find(entry.workspaceForest, 'cp').children.push({ id: 'complement', label: 'VP' });
  find(shiftedControllee[1].workspaceForest, 'cp').children.reverse();
  assert.equal(controlFacet(shiftedControllee), undefined);
});

test('a proven movement transfers control ownership only to its exact lower witness', () => {
  const ds = stages(), forest = ds[1].workspaceForest;
  const high = find(forest, 'high'), low = find(forest, 'low');
  high.id = 'low'; low.id = 'trace'; low.label = 'NP[trace]';
  ds[1].relations = [
    { relation: 'A-movement', anchors: { source: 'trace', target: 'low' }, priorAnchors: { source: 'low' } },
    { ...chain, anchors: { controllerOccurrences: ['low', 'trace'], controlledPRO: 'pro' } }
  ];
  const facet = controlFacet(ds);
  assert(facet); assert.deepEqual(facet.evidence.currentAnchors.controller, ['trace']);
  const shiftedWitness = structuredClone(ds);
  const children = find(shiftedWitness[1].workspaceForest, 'vp').children;
  [children[0], children[1]] = [children[1], children[0]];
  assert.equal(controlFacet(shiftedWitness), undefined);
  ds[1].relations.shift();
  assert.equal(controlFacet(ds), undefined);
});

test('denied, uncertain and contradictory control claims cannot borrow a positive earlier connector', () => {
  for (const relation of ['No obligatory subject control', 'Possible subject control', 'Subject control not established', 'Failed control', 'Control denied', 'Ambiguous control']) {
    const ds = stages(); ds[1].relations[0].relation = relation;
    assert.equal(controlFacet(ds), undefined, relation);
  }
  for (const values of [{ outcome: 'blocked' }, { status: 'pending' }, { outcome: ['licensed', 'blocked'] },
    { dependencyType: 'movement rather than control' }]) {
    const ds = stages(); ds[1].relations[0].values = values;
    assert.equal(controlFacet(ds), undefined, JSON.stringify(values));
  }
});

test('explicit controllers keep their endpoints and malformed exact Control is not repaired', () => {
  const explicit = stages(); explicit[1].relations[0].anchors.controller = 'high';
  assert.deepEqual(controlFacet(explicit).evidence?.currentAnchors.controller
    ?? dispatchStageRelations(explicit)[1][0].evidence.currentAnchors.controller, ['high']);
  const malformed = stages(); malformed[1].relations[0].relation = 'Control';
  const dispatch = dispatchStageRelations(malformed)[1][0];
  assert.equal(dispatch.primaryClaim.tier, 3);
  assert(!dispatch.facets.some(f => f.recipe.id === 'control.dependency'));
});
