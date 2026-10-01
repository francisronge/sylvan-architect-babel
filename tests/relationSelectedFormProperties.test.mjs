import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const lexicalHead = { id: 'participle', label: 'V [past participle]', word: 'written' };
const forest = [
  { id: 'auxiliary', label: 'I', word: 'has' },
  { id: 'vp', label: 'VP', children: [lexicalHead, { id: 'object', label: 'DP', word: 'it' }] }
];
const relation = {
  relation: 'perfect auxiliary licensing',
  anchors: { finiteAuxiliary: 'auxiliary', participle: 'participle' },
  values: { auxiliaryTense: 'present', selectedVerbForm: 'past participle' }
};
const items = (record = relation, workspaceForest = forest) => compileRelationRenderPlan([
  { statement: 'Completed state', stageRecord: '', workspaceForest, relations: [record] }
]).frames[0].items;
const selectedPlate = (record = relation, workspaceForest = forest) => items(record, workspaceForest)
  .find(item => item.kind === 'node-plaque' && item.rows.some(row => row.label === 'selectedVerbForm'));
const withHead = head => [forest[0], { ...forest[1], children: [head, forest[1].children[1]] }];

test('the selected form becomes an exact property only with a matching current lexical annotation', () => {
  const before = structuredClone(relation), drawings = items();
  const plate = selectedPlate();
  assert.deepEqual(plate?.anchorNodeIds, ['participle']);
  assert.deepEqual(plate.rows, [{ label: 'selectedVerbForm', value: 'past participle' }]);
  const auxiliary = drawings.find(item => item.kind === 'node-plaque' && item.anchorNodeIds.includes('auxiliary'));
  assert.deepEqual(auxiliary?.rows, [{ label: 'auxiliaryTense', value: 'present' }]);
  assert(!drawings.some(item => item.kind === 'directed-path' || item.plaqueStyle === 'realization'));
  assert.deepEqual(relation, before);

  const dispatch = dispatchRelationClaims({ relation, currentForest: forest, stageIndex: 0, relationIndex: 0 });
  const field = dispatch.evidenceCoverage.fields.find(field => field.field === 'values' && field.key === 'selectedVerbForm');
  assert.deepEqual(field?.unrecoveredItemIndices, []);
});

test('selected-form recovery handles explicit head roles and annotation punctuation without rewriting the literal', () => {
  for (const label of ['V⁰[past participle, passive]', 'V0 [form: past participle]', 'V [passive; past participle]',
    'V (past participle)', 'V⁰ (form: past participle)', 'V (past participle) [passive]']) {
    const record = { ...relation, anchors: { finiteAuxiliary: 'auxiliary', selectedVerb: 'participle' } };
    assert.deepEqual(selectedPlate(record, withHead({ ...lexicalHead, label }))?.anchorNodeIds, ['participle'], label);
  }
});

test('a general selectedForm has a property owner when its explicit participial head confirms the form', () => {
  const record = {
    relation: 'Perfect auxiliary selection',
    anchors: { auxiliary: 'auxiliary', participialHead: 'participle', selectedPredicate: 'vp' },
    values: { construction: 'present perfect', selectedForm: 'past participle' }
  };
  const nodes = withHead({ ...lexicalHead, label: 'V (past participle)' });
  const before = structuredClone({ record, nodes }), drawings = items(record, nodes);
  const plaques = drawings.filter(item => item.kind === 'node-plaque');
  assert.equal(plaques.length, 1);
  assert.deepEqual(plaques[0].anchorNodeIds, ['participle']);
  assert.deepEqual(plaques[0].rows, [{ label: 'selectedForm', value: 'past participle' }]);
  assert(!drawings.some(item => item.kind === 'directed-path' || item.plaqueStyle === 'realization'));
  const dispatch = dispatchRelationClaims({ relation: record, currentForest: nodes, stageIndex: 0, relationIndex: 0 });
  assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === 'selectedForm')?.unrecoveredItemIndices, []);
  for (const key of ['auxiliary', 'selectedPredicate', 'construction'])
    assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === key)?.unrecoveredItemIndices, [0]);
  assert.deepEqual({ record, nodes }, before);
});

test('general selected forms still require a unique selected lexical head and its own positive annotation', () => {
  const base = {
    relation: 'Perfect auxiliary selection',
    anchors: { auxiliary: 'auxiliary', participialHead: 'participle', selectedPredicate: 'vp' },
    values: { selectedForm: 'past participle' }
  };
  const hasForm = (record, nodes) => items(record, nodes).some(item => item.kind === 'node-plaque'
    && item.rows.some(row => row.label === 'selectedForm'));
  for (const label of ['V', 'V (bare infinitive)', 'V (not past participle)', 'V (required form: past participle)',
    'V (past participle; unrealized)', 'V (past participle or bare)', 'VP (past participle)', 'N (past participle)'])
    assert.equal(hasForm(base, withHead({ ...lexicalHead, label })), false, label);
  for (const anchors of [
    { auxiliary: 'auxiliary', selectedPredicate: 'vp' },
    { auxiliary: 'auxiliary', lexicalVerb: 'participle' },
    { ...base.anchors, selectedVerb: 'other' },
    { ...base.anchors, participialHead: ['participle', 'other'] },
    { ...base.anchors, participialHead: 'missing' }
  ]) assert.equal(hasForm({ ...base, anchors }, [...forest, { id: 'other', label: 'V (past participle)', word: 'read' }]), false);
  // An annotation elsewhere in the selected projection cannot supply the
  // explicitly anchored head's missing form.
  assert.equal(hasForm(base, [forest[0], { id: 'vp', label: 'VP (past participle)', children: [
    { ...lexicalHead, label: 'V' }, forest[1].children[1]
  ] }]), false);
});

test('a requested, missing, conflicting, or nonlexical form never becomes an actual-form plaque', () => {
  for (const head of [
    { ...lexicalHead, label: 'V' },
    { ...lexicalHead, label: 'V [bare infinitive]' },
    { ...lexicalHead, label: 'V [requires past participle]' },
    { ...lexicalHead, label: 'V [required form: past participle]' },
    { ...lexicalHead, label: 'V [past participle; unrealized]' },
    { ...lexicalHead, label: 'V [not past participle]' },
    { ...lexicalHead, label: 'V [past participle or bare]' },
    { ...lexicalHead, label: 'VP [past participle]' },
    { ...lexicalHead, label: 'N [past participle]' },
    { ...lexicalHead, word: '' },
    { ...lexicalHead, children: [{ id: 'nested', label: 'V [past participle]', word: 'written' }] }
  ]) assert.equal(selectedPlate(relation, withHead(head)), undefined, JSON.stringify(head));

  for (const key of ['requiredForm', 'requiredVerbForm', 'requestedVerbForm']) {
    const record = { ...relation, values: { [key]: 'past participle' } };
    assert(!items(record).some(item => item.kind === 'node-plaque' && item.rows.some(row => row.label === key)), key);
  }
});

test('selected-form association refuses competing participants and ambiguous or missing occurrences', () => {
  for (const record of [
    { ...relation, anchors: { ...relation.anchors, selectedVerb: 'other' } },
    { ...relation, anchors: { ...relation.anchors, participle: ['participle', 'other'] } },
    { ...relation, anchors: { ...relation.anchors, participle: 'missing' } },
    { ...relation, values: { selectedVerbForm: ['past participle', 'bare'] } }
  ]) assert.equal(selectedPlate(record, [...forest, { id: 'other', label: 'V [bare]', word: 'write' }]), undefined);
  assert.equal(selectedPlate(relation, [...forest, { ...lexicalHead }]), undefined);
});
