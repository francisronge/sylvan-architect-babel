import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const saved = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/relative-restriction-binding.json', import.meta.url)));
const relation = saved.stage.relations[saved.relationIndex];
const forest = [{ id: 'np', label: 'NP', children: [{ id: 'cp', label: 'CP', children: [
  { id: 'op', label: 'D', lineageId: 'argument' },
  { id: 'ip', label: 'IP', children: [{ id: 'subject', label: 'DP' },
    { id: 'vp', label: 'VP', children: [{ id: 'verb', label: 'V' }, { id: 'variable', label: 'DP', lineageId: 'argument' }] }] }
] }, { id: 'noun', label: 'N' }] }];
const base = { relation: 'Externally headed relative restriction',
  anchors: { externalHead: 'noun', objectVariable: 'variable', operator: 'op', relativeClause: 'cp' },
  values: { interpretation: 'authored interpretation' } };
const dispatch = (r = base, f = forest) => dispatchRelationClaims({ relation: r, currentForest: f, stageIndex: 0, relationIndex: 0 });
const binding = (r = base, f = forest) => dispatch(r, f).facets.filter(facet => facet.recipe.id === 'operator-binding');
const find = (f, id) => f.flatMap(function visit(n) { return [n, ...(n.children ?? []).flatMap(visit)]; }).find(n => n.id === id);

test('saved Turkish restriction earns the existing variable-binding path from exact operator evidence', () => {
  const before = structuredClone(saved.stage);
  const result = binding(relation, saved.stage.workspaceForest);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].evidence.currentAnchors, { operator: ['objectOperatorEdge'], variable: ['objectOperatorBase'] });
  const items = compileRelationRenderPlan([saved.stage]).frames[0].items;
  assert(items.some(item => item.kind === 'operator-variable-binding'));
  assert.deepEqual(saved.stage, before);
});

test('relative semantic clauses and qualified variables share the same structurally proved binding rule', () => {
  for (const label of ['relative interpretation', 'relative abstraction', 'relative restriction', 'restrictive relative interpretation',
    'nonrestrictive relative restriction', 'internally headed relative restriction', 'externally headed relative restriction', 'relative head interpretation']) {
    for (const key of ['objectVariable', 'subjectVariable', 'embeddedVariable', 'boundVariable', 'variablePosition']) {
      const anchors = { ...base.anchors }; delete anchors.objectVariable; anchors[key] = 'variable';
      assert.equal(binding({ ...base, relation: label, anchors }).length, 1, `${label}: ${key}`);
    }
  }
  assert.equal(binding({ ...base, anchors: { relativeOperator: 'op', objectVariable: 'variable' } }).length, 1);
});

test('relative interpretation prose and names alone establish no binding', () => {
  for (const r of [
    { ...base, relation: 'relative clause properties' },
    { ...base, relation: 'a discussion of relative restriction' },
    { ...base, anchors: { externalHead: 'noun', operator: 'op', relativeClause: 'cp' } },
    { ...base, anchors: { nominalHead: 'noun', objectPosition: 'variable', operator: 'op' } },
    { ...base, anchors: { ...base.anchors, variable: 'subject' } },
    { ...base, anchors: { ...base.anchors, relativeOperator: 'subject' } },
    { ...base, anchors: { ...base.anchors, operator: ['op', 'subject'] } },
    { ...base, anchors: { ...base.anchors, operator: 'missing' } },
    { ...base, anchors: { ...base.anchors, objectVariable: 'op' } }
  ]) assert.equal(binding(r).length, 0, JSON.stringify(r));
});

test('qualified relative variables require unique lineage and c-command in the current forest', () => {
  for (const lineageId of ['', 'unrelated', undefined]) {
    const changed = structuredClone(forest); find(changed, 'variable').lineageId = lineageId;
    assert.equal(binding(base, changed).length, 0);
  }
  const detached = structuredClone(forest); detached.push(find(detached, 'cp').children.shift());
  assert.equal(binding(base, detached).length, 0, 'same lineage in another workspace');
  const nested = structuredClone(forest); find(nested, 'cp').children[0] = { id: 'wrapper', label: 'DP', children: [find(nested, 'op'), { id: 'other', label: 'D' }] };
  assert.equal(binding(base, nested).length, 0, 'operator does not c-command outside its branching wrapper');
  assert.equal(binding(base, [...forest, { id: 'op', label: 'D', lineageId: 'argument' }]).length, 0, 'duplicate exact ID');
  const ambiguous = { ...base, anchors: { operator: 'op', relativeOperator: 'subject', objectVariable: 'variable' } };
  assert.equal(binding(ambiguous).length, 0);
});

test('denied, failed and provisional relative claims remain neutral', () => {
  for (const prefix of ['No', 'Not', 'Denied', 'Failed', 'Blocked', 'Unlicensed', 'Possible', 'Pending', 'Required', 'Expected'])
    assert.equal(binding({ ...base, relation: `${prefix} ${base.relation}` }).length, 0, prefix);
  for (const suffix of ['if licensed', 'is pending', 'was denied'])
    assert.equal(binding({ ...base, relation: `${base.relation} ${suffix}` }).length, 0, suffix);
  for (const status of ['denied', 'failed', 'pending', 'unknown', 'unlicensed'])
    assert.equal(binding({ ...base, values: { ...base.values, status } }).length, 0, status);
});
