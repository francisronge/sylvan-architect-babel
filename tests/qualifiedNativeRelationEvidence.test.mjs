import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const nominal = [{ id: 'dp', label: 'DP', children: [
  { id: 'd', label: 'D', word: 'a' }, { id: 'np', label: 'NP', children: [
    { id: 'ap', label: 'AP', children: [{ id: 'a', label: 'A', word: 'new' }] },
    { id: 'nb', label: 'N′', children: [{ id: 'n', label: 'N', word: 'book' }] }
  ] }
] }];
const inspect = (relation, workspaceForest = nominal, realizations) => {
  const stage = { statement: '', stageRecord: '', workspaceForest, relations: [relation], ...(realizations ? { realizations } : {}) };
  const original = structuredClone(stage);
  const dispatch = dispatchRelationClaims({ relation, currentForest: workspaceForest, currentRealizations: realizations, stageIndex: 0, relationIndex: 0 });
  const items = compileRelationRenderPlan([stage]).frames[0].items;
  assert.deepEqual(stage, original);
  return { dispatch, items };
};
const recovered = (relation, family, forest) => inspect(relation, forest).items.filter(item => item.familyId === family);

test('morphological and orthographic sequences belong to an exact contributor group with different token boundaries', () => {
  const forest = [{ id: 'word', label: 'V', children: [
    { id: 'root', label: 'V', word: 'read' }, { id: 'suffix', label: 'V', word: 'caus' }
  ] }];
  const relation = { relation: 'causative morphological realization', anchors: { root: 'root', suffix: 'suffix', wordDomain: 'word' },
    values: { morphologicalSequence: ['read', 'caus'], orthographicSequence: ['one', 'two', 'three'] } };
  const group = [{ nodeIds: ['root', 'suffix'], tokenIndices: [0, 1, 2] }];
  const plates = (r = relation, g = group, f = forest) => inspect(r, f, g).items.filter(item => item.plaqueStyle === 'realization');
  const plate = plates()[0];
  assert.deepEqual(new Set(plate.anchorNodeIds), new Set(['root', 'suffix']));
  assert.deepEqual(plate.rows.map(row => row.value), ['read', 'caus', 'one', 'two', 'three']);
  assert(!inspect(relation, forest, group).items.some(item => item.kind === 'rewrite'));
  for (const r of [
    { ...relation, relation: 'possible morphological realization' },
    { ...relation, values: { ...relation.values, orthographicSequence: ['one', 'two'] } },
    { ...relation, anchors: { ...relation.anchors, root: 'missing' } },
    { ...relation, anchors: { ...relation.anchors, wordDomain: 'suffix' } }
  ]) assert.equal(plates(r).length, 0, JSON.stringify(r));
  for (const g of [[], [{ nodeIds: ['root'], tokenIndices: [0, 1, 2] }],
    [{ nodeIds: ['root', 'root'], tokenIndices: [0, 1, 2] }]]) assert.equal(plates(relation, g).length, 0);
});

test('surface and unpronounced copies recover only their proved identity without another movement', () => {
  const forest = [{ id: 'high', label: 'D', lineageId: 'chain', word: 'it' },
    { id: 'low', label: 'D', lineageId: 'chain', word: 'it', silent: true }];
  const relation = { relation: 'copy pronunciation', anchors: { surfaceCopy: 'high', unpronouncedCopy: 'low' },
    values: { selection: 'the higher occurrence is retained' } };
  const { items, dispatch } = inspect(relation, forest);
  const identity = items.find(item => item.familyId === 'identity.occurrences');
  assert.deepEqual(new Set(identity.nodeIds), new Set(['high', 'low']));
  assert(!items.some(item => item.kind === 'directed-path'));
  assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === 'selection').unrecoveredItemIndices, [0]);
  for (const f of [forest.map(node => ({ ...node, lineageId: undefined })),
    [forest[0], { ...forest[1], lineageId: 'other' }], [...forest, { ...forest[0] }]])
    assert.equal(recovered(relation, 'identity.occurrences', f).length, 0);
});

test('nominal concord can retain corroborating modification context without making it another feature bearer', () => {
  const relation = { relation: 'Nominal concord and adjectival modification',
    anchors: { adjective: 'a', determiner: 'd', modifiedProjection: 'np', modifierPhrase: 'ap', noun: 'n' },
    values: { features: ['masculine', 'singular', 'accusative'], modification: 'new modifies book' } };
  const { items, dispatch } = inspect(relation);
  const vine = items.find(item => item.linkStyle === 'feature-sharing');
  assert.deepEqual(new Set(vine.pairs.flatMap(pair => [pair.fromNodeId, pair.toNodeId])), new Set(['a', 'd', 'n']));
  assert(vine.label.includes('accusative'));
  for (const key of ['modifiedProjection', 'modifierPhrase', 'modification'])
    assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === key).unrecoveredItemIndices, [0]);
  assert(!items.some(item => item.kind === 'directed-path'));
  for (const anchors of [
    { ...relation.anchors, modifiedProjection: 'nb' }, { ...relation.anchors, modifierPhrase: 'nb' },
    { ...relation.anchors, modifiedProjection: 'missing' }, { ...relation.anchors, controller: 'n' }
  ]) assert.equal(recovered({ ...relation, anchors }, 'feature-sharing.vines').length, 0);
});

test('modifier recovery uses the named sister projection and never substitutes a deep lexical head', () => {
  const relation = { relation: 'attributive modification',
    anchors: { modifiedProjection: 'nb', modifier: 'ap', nominalHead: 'n' }, values: { interpretation: 'a new book' } };
  const { items, dispatch } = inspect(relation);
  assert.deepEqual(items.find(item => item.linkStyle === 'pair-merge').pairs, [{ fromNodeId: 'ap', toNodeId: 'nb' }]);
  assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === 'nominalHead').unrecoveredItemIndices, [0]);
  for (const invalid of [
    { ...relation, relation: 'possible attributive modification' },
    { ...relation, relation: 'PairMerge' },
    { ...relation, anchors: { ...relation.anchors, modifiedProjection: 'n' } },
    { ...relation, anchors: { ...relation.anchors, modifiedProjection: 'np' } },
    { ...relation, anchors: { ...relation.anchors, nominalHead: 'd' } },
    { ...relation, anchors: { ...relation.anchors, host: 'dp' } }
  ]) assert.equal(recovered(invalid, 'pair-merge.fork').length, 0, JSON.stringify(invalid));
  const relativeForest = [{ id: 'nr', label: 'N′', children: [
    { id: 'cp', label: 'CP' }, { id: 'head', label: 'N', word: 'book' }
  ] }];
  const relative = { relation: 'relative restriction of an external nominal head',
    anchors: { nominalHead: 'head', relativeModifier: 'cp' } };
  assert.equal(recovered(relative, 'pair-merge.fork', relativeForest).length, 1);
});

test('an asserted predicated property binds the exact subject and preserves the mediator as context', () => {
  const forest = [{ id: 'predp', label: 'PredP', children: [
    { id: 'subject', label: 'DP' }, { id: 'complement', label: 'PredP', children: [
      { id: 'pred', label: 'Pred' }, { id: 'property', label: 'DegP' }
    ] }
  ] }];
  const relation = { relation: 'subjectPredication', anchors: { predicationHead: 'pred', property: 'property', subject: 'subject' },
    values: { subjectRole: 'bearer of the height property' } };
  const { items, dispatch } = inspect(relation, forest);
  assert.deepEqual(items.find(item => item.familyId === 'predication.paths').pairs,
    [{ fromNodeId: 'subject', toNodeId: 'property' }]);
  assert(!items.some(item => item.familyId === 'theta.grid'));
  assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === 'predicationHead').unrecoveredItemIndices, [0]);
  for (const invalid of [
    { ...relation, relation: 'property selection' }, { ...relation, relation: 'possible subject predication' },
    { ...relation, relation: 'Predication' }, { ...relation, values: { status: 'pending' } },
    { ...relation, anchors: { ...relation.anchors, predicate: 'pred' } },
    { ...relation, anchors: { ...relation.anchors, property: 'missing' } }
  ]) assert.equal(recovered(invalid, 'predication.paths', forest).length, 0, JSON.stringify(invalid));
});

test('an explicitly realized head owns PF rows while the containing head and lexical predicate remain context', () => {
  const forest = [{ id: 'complex', label: 'C', children: [
    { id: 'finite', label: 'T', word: 'does' }, { id: 'c', label: 'C', silent: true }
  ] }, { id: 'v', label: 'V', word: 'seem' }];
  const relation = { relation: 'do-support realization',
    anchors: { containingHead: 'complex', matrixLexicalVerb: 'v', realizedHead: 'finite' },
    values: { features: ['present', 'third-person singular'], matrixVerbForm: 'bare', surfaceForm: 'does' } };
  const { items, dispatch } = inspect(relation, forest);
  const plate = items.find(item => item.plaqueStyle === 'realization');
  assert.deepEqual(plate.anchorNodeIds, ['finite']);
  assert.deepEqual(plate.rows.map(row => row.value), ['present', 'third-person singular', 'does']);
  assert(!items.some(item => item.kind === 'rewrite' || item.kind === 'directed-path'));
  for (const key of ['containingHead', 'matrixLexicalVerb', 'matrixVerbForm'])
    assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === key).unrecoveredItemIndices, [0]);
  for (const invalid of [
    { ...relation, relation: 'required realization' }, { ...relation, relation: 'A description' },
    { ...relation, relation: 'VocabularyInsertion' }, { ...relation, anchors: { ...relation.anchors, realizedHead: 'missing' } },
    { ...relation, anchors: { ...relation.anchors, realizedTerminal: 'v' } },
    { ...relation, anchors: { ...relation.anchors, realizedHead: ['finite', 'v'] } }
  ]) assert.equal(recovered(invalid, 'pf.realization', forest).length, 0, JSON.stringify(invalid));
});
