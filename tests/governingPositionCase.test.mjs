import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const saved = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/astra-spanish-qr.json', import.meta.url)));
const forest = [{ id: 'clause', label: 'IP', children: [
  { id: 'raised', label: 'V', lineageId: 'verb' },
  { id: 'vp', label: 'VP', children: [
    { id: 'lower', label: 'V trace', lineageId: 'verb' }, { id: 'object', label: 'DP' }
  ] }, { id: 'other', label: 'N' }
] }];
const base = { relation: 'Accusative Case under verbal government',
  anchors: { governingPosition: 'lower', object: 'object', verbalHead: 'raised' }, values: { case: 'accusative' } };
const items = (relation = base, currentForest = forest) => compileRelationRenderPlan([
  { statement: '', stageRecord: '', workspaceForest: currentForest, relations: [relation] }
]).frames[0].items;
const paths = (r = base, f = forest) => items(r, f).filter(item => item.pathStyle === 'case-assignment');
const find = (f, id) => f.flatMap(function visit(n) { return [n, ...(n.children ?? []).flatMap(visit)]; }).find(n => n.id === id);

test('both saved Spanish analyses assign Case at the declared governing occurrence', () => {
  for (const analysis of saved.analyses) {
    const stage = analysis.derivationStages[1], original = structuredClone(stage);
    const relation = stage.relations[3], result = paths(relation, stage.workspaceForest);
    assert.equal(result.length, 1);
    assert.deepEqual([result[0].fromNodeId, result[0].toNodeId, result[0].label], [relation.anchors.governingPosition, relation.anchors.object, 'accusative']);
    assert.equal(result[0].relationRef.relation, relation.relation);
    assert.deepEqual(stage, original);
  }
});

test('the existing government primitive uses independently typed Case and exact local endpoints', () => {
  for (const literal of ['accusative', 'opaque Case value']) {
    for (const label of [`${literal} Case under verbal government`, 'Case under verbal government', `${literal} Case under local government`]) {
      const r = { ...base, relation: label, values: { case: literal } };
      assert.deepEqual(paths(r).map(p => [p.fromNodeId, p.toNodeId, p.label]), [['lower', 'object', literal]], label);
    }
  }
  const nominal = structuredClone(forest); find(nominal, 'raised').label = 'N';
  assert.equal(paths({ ...base, relation: 'Case under nominal government', anchors: { governingPosition: 'lower', object: 'object', nominalHead: 'raised' } }, nominal).length, 1);
  const direct = structuredClone(forest); find(direct, 'lower').label = 'V';
  assert.equal(paths({ ...base, anchors: { governingPosition: 'lower', object: 'object' } }, direct).length, 1);
});

test('government recovery never moves Case to a raised head or guesses an unproved local assignment', () => {
  for (const r of [
    { ...base, anchors: { verbalHead: 'raised', object: 'object' } },
    { ...base, anchors: { ...base.anchors, governingPosition: 'raised' } },
    { ...base, anchors: { ...base.anchors, governingPosition: 'missing' } },
    { ...base, anchors: { ...base.anchors, object: 'missing' } },
    { ...base, anchors: { ...base.anchors, object: 'vp' } },
    { ...base, anchors: { ...base.anchors, verbalHead: 'other' } },
    { ...base, anchors: { ...base.anchors, finiteHead: 'other' } },
    { ...base, anchors: { ...base.anchors, nominal: 'other' } },
    { ...base, anchors: { ...base.anchors, governingPosition: ['lower', 'raised'] } },
    { ...base, anchors: { governingPosition: 'lower', object: 'object' } }
  ]) assert.deepEqual(paths(r), [], JSON.stringify(r));
  for (const [id, property, value] of [['raised', 'lineageId', 'unrelated'], ['lower', 'lineageId', undefined],
    ['raised', 'label', 'VP'], ['lower', 'label', 'DP'], ['raised', 'label', 'N']]) {
    const changed = structuredClone(forest); find(changed, id)[property] = value;
    assert.deepEqual(paths(base, changed), [], `${id}.${property}=${value}`);
  }
  const detached = structuredClone(forest); detached[0].children.push(find(detached, 'vp').children.pop());
  assert.deepEqual(paths(base, detached), [], 'another position in same clause');
  assert.deepEqual(paths(base, [...forest, { id: 'lower', label: 'V', lineageId: 'verb' }]), [], 'duplicate exact source');
  assert.deepEqual(paths(base, [...forest, { id: 'object', label: 'DP' }]), [], 'duplicate exact target');
});

test('property prose, mismatching Case, missing literals and nonasserted outcomes remain neutral', () => {
  for (const label of ['government', 'verbal government', 'accusative properties under verbal government',
    'nominative Case under verbal government', 'Case assignment might use verbal government',
    'No Case under verbal government', 'Denied Case under verbal government', 'Possible Case under verbal government',
    'Case under verbal government if licensed', 'Case under verbal government; Case licensing is blocked', 'Case Assignment'])
    assert.deepEqual(paths({ ...base, relation: label }), [], label);
  for (const values of [{}, { case: '' }, { case: ['accusative', 'dative'] }, { case: 'accusative', abstractCase: 'dative' },
    ...['denied', 'failed', 'pending', 'unlicensed', 'unknown'].map(status => ({ case: 'accusative', status }))])
    assert.deepEqual(paths({ ...base, values }), [], JSON.stringify(values));
});
