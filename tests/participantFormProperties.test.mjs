import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const leaf = (id, label, word) => ({ id, label, word, children: [] });
const forest = [leaf('particle', 'I[future]', 'θα'), leaf('verb', 'V[perfective, nonpast]', 'διαβάσει')];
const relation = { relation: 'future-and-dependent-verb-licensing', anchors: { particle: 'particle', verb: 'verb' },
  values: { verbForm: 'dependent perfective nonpast', interpretation: 'future with perfective aspect' } };
const inspect = (record = relation, workspaceForest = forest) => {
  const stage = { statement: 'Current state', stageRecord: '', workspaceForest, relations: [record] };
  const before = structuredClone(stage);
  const plan = compileRelationRenderPlan([stage]);
  const dispatch = dispatchRelationClaims({ relation: record, currentForest: workspaceForest, stageIndex: 0, relationIndex: 0 });
  assert.deepEqual(stage, before);
  return { items: plan.frames[0].items, dispatch };
};
const rowPlaques = (record, nodes, label) => inspect(record, nodes).items.filter(item =>
  item.kind === 'node-plaque' && item.rows.some(row => row.label === label));

test('an exact participant-qualified form is a property, without an inferred licensing path or rewrite', () => {
  const { items, dispatch } = inspect();
  const plaques = items.filter(item => item.kind === 'node-plaque');
  assert.equal(plaques.length, 1);
  assert.deepEqual(plaques[0].anchorNodeIds, ['verb']);
  assert.deepEqual(plaques[0].rows, [{ label: 'verbForm', value: 'dependent perfective nonpast' }]);
  assert(!items.some(item => item.kind === 'directed-path' || item.plaqueStyle === 'realization'));
  for (const key of ['particle', 'interpretation']) {
    assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === key)?.unrecoveredItemIndices, [0]);
  }
});

test('form properties retain exact participant and item ownership', () => {
  const record = { relation: 'Current properties', anchors: { verb: ['verb', 'other'] },
    values: { verbForm: ['perfective nonpast', 'past participle'] } };
  const plaques = rowPlaques(record, [...forest, leaf('other', 'V', 'written')], 'verbForm');
  assert.deepEqual(plaques.map(item => [item.anchorNodeIds, item.rows]), [
    [['verb'], [{ label: 'verbForm', value: 'perfective nonpast' }]],
    [['other'], [{ label: 'verbForm', value: 'past participle' }]]
  ]);
});

test('unqualified or competing form owners and unequal property lists stay neutral', () => {
  for (const record of [
    { ...relation, values: { form: 'past participle' } },
    { ...relation, anchors: { verb: 'verb', lexicalVerb: 'other' } },
    { ...relation, anchors: { verb: ['verb', 'other'] } },
    { ...relation, values: { verbForm: ['past participle', 'bare'] } },
    { ...relation, anchors: { verb: 'missing' } }
  ]) assert.equal(rowPlaques(record, [...forest, leaf('other', 'V', 'written')], 'verbForm').length, 0);
  assert.equal(rowPlaques(relation, [...forest, { ...forest[1] }], 'verbForm').length, 0);
});

test('a form requirement or denied form does not become a current property', () => {
  for (const name of ['required verb form', 'verb form requirement', 'possible verb form',
    'no verb form licensing', 'failed verb form realization', 'verb form not established',
    'denied verb form licensing', 'rejected verb form licensing', 'absence of verb form licensing',
    'whether there is verb form licensing', 'verb form licensing was never established']) {
    assert.equal(rowPlaques({ ...relation, relation: name }, forest, 'verbForm').length, 0, name);
  }
  for (const qualifier of ['requiredVerb', 'requestedVerb', 'expectedVerb', 'selectedVerb', 'previousVerb']) {
    const record = { relation: 'A form description', anchors: { [qualifier]: 'verb' },
      values: { [`${qualifier}Form`]: 'past participle' } };
    assert.equal(rowPlaques(record, forest, `${qualifier}Form`).length, 0, qualifier);
  }
  assert.equal(rowPlaques({ ...relation, values: { ...relation.values, status: 'unestablished' } }, forest, 'verbForm').length, 0);
  for (const name of ['failed Case licensing; current verb form', 'current verb form without agreement']) {
    assert.equal(rowPlaques({ ...relation, relation: name }, forest, 'verbForm').length, 1, name);
  }
});

const realization = { relation: 'lexical realization across input-token boundaries',
  anchors: { lexicalVerb: 'verb' }, values: { form: '読んだ', inflection: 'past' } };
const lexicalForest = [leaf('verb', 'V[past]', '読んだ')];

test('an explicit lexical input association can name its sole lexical host with an open role', () => {
  const record = { relation: 'Lexical input association', anchors: { determiner: 'd' },
    values: { lexicalForm: 'कौन-सी', inputParts: ['कौन', 'सी'] } };
  const nodes = [leaf('d', 'D', 'कौन-सी')];
  const { items } = inspect(record, nodes);
  const plates = items.filter(item => item.plaqueStyle === 'realization');
  assert.equal(plates.length, 1);
  assert.deepEqual(plates[0].anchorNodeIds, ['d']);
  assert(plates[0].rows.some(row => row.label === 'lexicalForm' && row.value === 'कौन-सी'));
  const hasPlate = (r, f = nodes) => inspect(r, f).items.some(item => item.plaqueStyle === 'realization');
  for (const name of ['A lexical observation', 'Possible lexical input association', 'No lexical input association', 'VocabularyInsertion'])
    assert.equal(hasPlate({ ...record, relation: name }), false, name);
  for (const anchors of [{ determiner: ['d'] }, { determiner: 'd', context: 'd' }, { determiner: 'missing' }])
    assert.equal(hasPlate({ ...record, anchors }), false);
  for (const f of [[{ id: 'd', label: 'D' }], [...nodes, ...nodes],
    [{ ...nodes[0], children: [leaf('nested', 'N', 'noun')] }]]) assert.equal(hasPlate(record, f), false);
});

test('a lexical realization plate retains the separately authored inflection row', () => {
  const { items, dispatch } = inspect(realization, lexicalForest);
  const plaques = items.filter(item => item.kind === 'node-plaque' && item.plaqueStyle === 'realization');
  assert.equal(plaques.length, 1);
  assert.deepEqual(plaques[0].anchorNodeIds, ['verb']);
  assert.deepEqual(plaques[0].rows, [{ label: 'form', value: '読んだ' }, { label: 'inflection', value: 'past' }]);
  assert.deepEqual(plaques[0].realizationRowKinds, ['literal', 'literal']);
  assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === 'inflection')?.unrecoveredItemIndices, []);
  assert(!items.some(item => item.kind === 'directed-path'));
});

test('inflection rows require an asserted realization and a uniquely identified lexical host', () => {
  for (const record of [
    { ...realization, relation: 'A description' },
    { ...realization, relation: 'Required lexical realization' },
    { ...realization, relation: 'Possible lexical realization' },
    { ...realization, relation: 'Failed lexical realization' },
    { ...realization, anchors: { lexicalVerb: 'verb', verb: 'other' } },
    { ...realization, anchors: { contributors: ['verb', 'other'] } },
    { ...realization, anchors: { lexicalVerb: 'missing' } },
    { ...realization, values: { requiredInflection: 'past' } }
  ]) assert.equal(rowPlaques(record, [...lexicalForest, leaf('other', 'V', 'borrowed')], 'inflection').length, 0, JSON.stringify(record));
});

const auxiliarySupport = { relation: 'Auxiliary support',
  anchors: { finiteHead: 'auxiliary', lexicalPredicate: 'predicate' },
  values: { form: 'does', strategy: 'lexical do-support', tense: 'present' } };
const auxiliaryForest = [leaf('auxiliary', 'T', 'does'), leaf('predicate', 'V', 'think')];

test('whole-word auxiliary support retains its exact form and tense in one PF property plate', () => {
  const { items, dispatch } = inspect(auxiliarySupport, auxiliaryForest);
  const plaques = items.filter(item => item.kind === 'node-plaque');
  assert.equal(plaques.length, 1);
  assert.equal(plaques[0].plaqueStyle, 'realization');
  assert.deepEqual(plaques[0].anchorNodeIds, ['auxiliary']);
  assert.deepEqual(plaques[0].rows, [{ label: 'form', value: 'does' }, { label: 'tense', value: 'present' }]);
  assert(!items.some(item => item.kind === 'directed-path' || item.kind === 'rewrite'));
  for (const key of ['lexicalPredicate', 'strategy'])
    assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === key)?.unrecoveredItemIndices, [0]);
});

test('auxiliary form recovery requires affirmative support and one matching explicit lexical host', () => {
  const hasForm = (record, nodes = auxiliaryForest) => rowPlaques(record, nodes, 'form').length > 0;
  for (const name of ['Possible auxiliary support', 'Required auxiliary support', 'Failed auxiliary support',
    'No auxiliary support', 'Denied auxiliary support', 'Auxiliary support was never established',
    'Whether there is auxiliary support', 'Auxiliary support; no auxiliary support', 'A description'])
    assert.equal(hasForm({ ...auxiliarySupport, relation: name }), false, name);
  for (const values of [{ form: 'do' }, { form: '' }, { form: ['does', 'do'] },
    { requiredForm: 'does' }, { form: 'does', status: 'pending' }])
    assert.equal(hasForm({ ...auxiliarySupport, values }), false);
  for (const anchors of [{ lexicalPredicate: 'predicate' }, { head: 'auxiliary' },
    { ...auxiliarySupport.anchors, auxiliary: 'other' },
    { ...auxiliarySupport.anchors, finiteHead: ['auxiliary', 'other'] },
    { ...auxiliarySupport.anchors, finiteHead: 'missing' }])
    assert.equal(hasForm({ ...auxiliarySupport, anchors }, [...auxiliaryForest, leaf('other', 'T', 'does')]), false);
  for (const nodes of [
    [...auxiliaryForest, { ...auxiliaryForest[0] }],
    [leaf('auxiliary', 'T', 'do'), auxiliaryForest[1]],
    [{ id: 'auxiliary', label: 'T', word: 'does', children: [leaf('nested', 'T', 'does')] }, auxiliaryForest[1]]
  ]) assert.equal(hasForm(auxiliarySupport, nodes), false);
  assert.equal(hasForm({ ...auxiliarySupport, relation: 'Lexical do-support' }), true);
  assert.equal(hasForm({ ...auxiliarySupport, relation: 'failed Case licensing; auxiliary support' }), true);
});
