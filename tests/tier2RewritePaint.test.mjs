import assert from 'node:assert/strict';
import test from 'node:test';
import { __test__ } from '../server/babelParser.js';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { preparePfPlaqueTextLayout } from '../replay/relations/plaqueTextLayout.ts';

const forest = [{ id: 'root', label: 'XP', children: [
  { id: 'underlying', label: 'V', word: 'go', children: [] },
  { id: 'surface', label: 'V', word: 'went', children: [] }
] }];
const record = relation => ({ derivationStages: [{ statement: 'The rule supplies the exponent.',
  stageRecord: 'The input and output of the realization rule are specified.',
  relations: [relation], workspaceForest: structuredClone(forest) }] });
const openRewrite = value => ({ relation: 'An authored realization mapping',
  anchors: { input: 'underlying', output: 'surface' }, values: { mapping: value } });
const compile = relation => {
  const authored = record(relation);
  const bundle = __test__.normalizeParseBundle(authored, 'xbar', 'go went', 'grok', true);
  return compileRelationRenderPlan(bundle.analyses[0].derivationStages).frames[0].items;
};
const layout = item => preparePfPlaqueTextLayout(item.rows.map((row, rowIndex) => ({
  ...row, kind: item.realizationRowKinds[rowIndex], rowIndex, isFinal: rowIndex === item.rows.length - 1
})));
const native = (input, output) => compile({ relation: 'VocabularyInsertion',
  anchors: { terminal: 'surface' }, values: { input, output } })[0];

test('a public open rewrite paints the same input, arrow and output columns as native insertion', () => {
  for (const arrow of ['->', '→']) {
    const relation = openRewrite(`  go ${arrow} went  `);
    const before = structuredClone(relation);
    const plate = compile(relation).find(item => item.tier2FacetId === 'pf.rewrite');
    assert.deepEqual(plate.rows, [{ label: 'go', value: 'went' }]);
    assert.deepEqual(plate.realizationRowKinds, ['rewrite']);
    assert.deepEqual(plate.anchorNodeIds, ['surface']);
    const paint = layout(plate);
    assert.deepEqual(paint.rows[0].parts.map(part => part.kind), ['input', 'arrow', 'output']);
    assert.deepEqual(paint, layout(native('go', 'went')));
    assert.deepEqual(relation, before);
  }
});

test('rewrite columns retain symbolic, complex and zero-valued authored literals', () => {
  for (const [input, output] of [['T[past, plural]', '-en'], ['√READ + T', 'read'], ['D', '∅']]) {
    const plate = compile(openRewrite(`${input} → ${output}`)).find(item => item.tier2FacetId === 'pf.rewrite');
    assert.deepEqual(plate.rows, [{ label: input, value: output }]);
    assert.deepEqual(layout(plate), layout(native(input, output)));
  }
});

test('explicit original columns and their optional corroborating row paint one native rewrite', () => {
  for (const mapping of [undefined, 'go -> went', 'go → went']) {
    const values = { input: 'go', output: 'went', ...(mapping ? { mapping } : {}) };
    for (const fields of [values, Object.fromEntries(Object.entries(values).reverse())]) {
      const relation = { relation: 'An explicit realization mapping',
        anchors: { input: 'underlying', output: 'surface' }, values: fields };
      const before = structuredClone(relation);
      const items = compile(relation);
      const plaques = items.filter(item => item.kind === 'node-plaque');
      assert.equal(plaques.length, 1);
      assert.equal(plaques[0].tier2FacetId, 'pf.rewrite');
      assert.deepEqual(layout(plaques[0]), layout(native('go', 'went')));
      assert.equal(items.some(item => item.kind === 'fallback'), false);
      assert.deepEqual(relation, before);
    }
  }
});

test('ambiguous or incomplete rewrite rows remain exact neutral evidence without an invented arrow', () => {
  for (const value of ['go ->', '-> went', 'go -> went -> gone', 'go → went -> gone',
    'go -> went\n', 'go\n-> went', 'go => went', 'go ⇄ went', 'go --> went',
    'go ->> went', 'go <-> went', 'go ⇄ move -> went', 'a descriptive literal']) {
    const items = compile(openRewrite(value));
    assert.equal(items.some(item => item.tier2FacetId === 'pf.rewrite'), false, value);
    assert.equal(items.some(item => item.plaqueStyle === 'realization'), false, value);
    const fallback = items.find(item => item.kind === 'fallback');
    assert.deepEqual(fallback?.relationRef.values, { mapping: value }, value);
  }
});

test('rewrite rows keep authored order and unrelated PF rows remain literal', () => {
  const values = ['go -> went', 'D → ∅'];
  const plate = compile(openRewrite(values)).find(item => item.tier2FacetId === 'pf.rewrite');
  assert.deepEqual(plate.rows, [{ label: 'go', value: 'went' }, { label: 'D', value: '∅' }]);
  assert.deepEqual(plate.realizationRowKinds, ['rewrite', 'rewrite']);
  const literal = compile({ relation: 'An authored surface realization', anchors: { output: 'surface' },
    values: { 'PF rows': 'go -> went' } }).find(item => item.tier2FacetId === 'pf.structured');
  assert.deepEqual(literal.rows, [{ label: 'PF rows', value: 'go -> went' }]);
  assert.deepEqual(literal.realizationRowKinds, ['literal']);
  assert.deepEqual(layout(literal).rows[0].parts.map(part => part.kind), ['literal']);
});

test('valid mapping items paint in authored order while an uninterpretable sibling stays neutral', () => {
  const value = ['go -> went', 'unchanged descriptive row', 'D → ∅'];
  const items = compile(openRewrite(value));
  const plaques = items.filter(item => item.tier2FacetId === 'pf.rewrite');
  assert.equal(plaques.length, 1);
  assert.deepEqual(plaques[0].rows, [{ label: 'go', value: 'went' }, { label: 'D', value: '∅' }]);
  assert.deepEqual(plaques[0].realizationRowKinds, ['rewrite', 'rewrite']);
  const fallback = items.find(item => item.kind === 'fallback');
  assert.deepEqual([fallback?.relationRef.values?.mapping].flat(), [value[1]]);
});
