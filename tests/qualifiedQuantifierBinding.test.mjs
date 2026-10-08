import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const saved = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/qualified-quantifier-binding.json', import.meta.url)));
const forest = [{ id: 'ip', label: 'IP', children: [{ id: 'subject', label: 'DP', lineageId: 'subject' },
  { id: 'scope', label: 'VP', children: [{ id: 'quantifier', label: 'DP', lineageId: 'object' },
    { id: 'vp', label: 'VP', children: [{ id: 'verb', label: 'V' }, { id: 'variable', label: 'DP', lineageId: 'object' }] }] }
] }];
const base = { relation: 'quantifier scope', anchors: { boundObjectVariable: 'variable', universalDomain: 'scope',
  narrowScopeUniversal: 'quantifier', wideScopeIndefinite: 'subject', existentialDomain: 'ip' }, values: { scopeOrder: 'existential > universal' } };
const dispatch = (relation = base, currentForest = forest) => dispatchRelationClaims({ relation, currentForest, stageIndex: 0, relationIndex: 0 });
const binding = (r = base, f = forest) => dispatch(r, f).facets.filter(facet => facet.recipe.id === 'operator-binding');
const find = (f, id) => f.flatMap(function visit(n) { return [n, ...(n.children ?? []).flatMap(visit)]; }).find(n => n.id === id);

test('saved scope alternatives recover only the variable-backed universal and its matching domain', () => {
  for (const stage of saved.stages) {
    const relation = stage.relations[1], original = structuredClone(stage);
    const result = binding(relation, stage.workspaceForest);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].evidence.currentAnchors, { operator: ['lobj'], variable: ['lto'], 'scope.domain': [relation.anchors.universal_domain] });
    const unresolved = dispatch(relation, stage.workspaceForest).evidenceCoverage.fields.filter(f => f.unrecoveredItemIndices.length).map(f => f.key);
    assert(unresolved.includes('existential_domain'));
    assert(unresolved.includes(Object.keys(relation.anchors).find(k => k.endsWith('_indefinite'))));
    const items = compileRelationRenderPlan([{ ...stage, relations: [relation] }]).frames[0].items;
    const paths = items.filter(item => item.kind === 'operator-variable-binding');
    assert.equal(paths.length, 1);
    assert.equal(paths[0].scopeDomainNodeId, relation.anchors.universal_domain);
    assert.deepEqual(stage, original);
  }
});

test('typed quantifier roles use exact matching domain qualifiers rather than list order', () => {
  for (const role of ['universal', 'existential', 'indefinite', 'quantifier']) {
    for (const rank of ['wide', 'narrow']) {
      const relation = { relation: 'quantifier scope interpretation', anchors: {
        [`${rank} scope ${role}`]: 'quantifier', boundObjectVariable: 'variable', [`${role} domain`]: 'scope'
      } };
      assert.equal(binding(relation).length, 1, `${rank} ${role}`);
      assert.deepEqual(binding(relation)[0].evidence.currentAnchors['scope.domain'], ['scope']);
    }
  }
  const reordered = { ...base, anchors: Object.fromEntries(Object.entries(base.anchors).reverse()) };
  assert.deepEqual(binding(reordered)[0].evidence.currentAnchors, binding()[0].evidence.currentAnchors);
});

test('scope ordering and quantifier labels do not invent missing variable identity or binding', () => {
  for (const r of [
    { ...base, relation: 'quantifier scope possibilities' },
    { ...base, anchors: { universalDomain: 'scope', narrowScopeUniversal: 'quantifier', wideScopeIndefinite: 'subject' } },
    { ...base, anchors: { ...base.anchors, boundObjectVariable: 'missing' } },
    { ...base, anchors: { ...base.anchors, boundObjectVariable: 'quantifier' } },
    { ...base, anchors: { ...base.anchors, narrowScopeUniversal: ['quantifier', 'subject'] } },
    { ...base, anchors: { ...base.anchors, variable: 'subject' } },
    { ...base, anchors: { ...base.anchors, universalDomain: 'vp' } },
    { ...base, anchors: { ...base.anchors, universalDomain: 'missing' } },
    { ...base, anchors: { ...base.anchors, scopeDomain: 'ip' } }
  ]) assert.equal(binding(r).length, 0, JSON.stringify(r));
  const unlineaged = structuredClone(forest); delete find(unlineaged, 'quantifier').lineageId;
  assert.equal(binding(base, unlineaged).length, 0);
  const competing = structuredClone(forest); find(competing, 'subject').lineageId = 'object';
  assert.equal(binding(base, competing).length, 0, 'two operators match the same variable');
  const wrapped = structuredClone(forest); find(wrapped, 'scope').children[0] = { id: 'wrapper', label: 'DP', children: [find(wrapped, 'quantifier'), { id: 'sibling', label: 'D' }] };
  assert.equal(binding(base, wrapped).length, 0, 'same lineage without c-command');
  assert.equal(binding(base, [...forest, { id: 'variable', label: 'DP', lineageId: 'object' }]).length, 0, 'duplicate exact variable');
});

test('negative and provisional quantified interpretation remains neutral', () => {
  for (const label of ['No quantifier scope', 'Denied quantifier scope', 'Failed quantifier scope', 'Pending quantifier scope',
    'Possible quantifier scope', 'quantifier scope if licensed']) assert.equal(binding({ ...base, relation: label }).length, 0, label);
  for (const status of ['denied', 'failed', 'pending', 'unknown', 'unlicensed'])
    assert.equal(binding({ ...base, values: { ...base.values, status } }).length, 0, status);
});
