import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const leaf = (id, word, extra = {}) => ({ id, label: 'V', word, children: [], ...extra });
const stage = (workspaceForest, relations = []) => ({ statement: 'Authored state', stageRecord: '', workspaceForest, relations });
const prior = [leaf('stem', '書く')], current = [leaf('stem', '書い')];
const relation = changes => ({ relation: 'past-conditioned stem allomorphy',
  anchors: { stem: 'stem' }, priorAnchors: { lexicalForm: 'stem' },
  values: { lexicalCitationForm: '書く', surfaceStem: '書い', process: 'i-onbin before past た' }, ...changes });
const inspect = (r = relation(), now = current, before = prior) => {
  const result = dispatchRelationClaims({ relation: r, currentForest: now, priorForest: before ?? undefined, stageIndex: 1, relationIndex: 0 });
  const items = compileRelationRenderPlan([stage(before ?? []), stage(now, [r])]).frames[1].items;
  return { result, items, rewrites: items.filter(item => item.tier2FacetId === 'pf.rewrite') };
};

test('exact authored citation and surface stem words recover the existing rewrite plate', () => {
  const r = relation(), original = structuredClone(r), { result, items, rewrites } = inspect(r);
  assert.equal(rewrites.length, 1);
  assert.deepEqual(rewrites[0].rows, [{ label: '書く', value: '書い' }]);
  assert.deepEqual(rewrites[0].realizationRowKinds, ['rewrite']);
  assert.deepEqual(rewrites[0].anchorNodeIds, ['stem']);
  const refs = result.facets.find(facet => facet.recipe.id === 'pf.rewrite').evaluation.consumedEvidence;
  assert.deepEqual(refs, [
    { field: 'priorAnchors', key: 'lexicalForm', itemIndices: [0] },
    { field: 'anchors', key: 'stem', itemIndices: [0] },
    { field: 'values', key: 'lexicalCitationForm', itemIndices: [0] },
    { field: 'values', key: 'surfaceStem', itemIndices: [0] }
  ]);
  assert.deepEqual(items.find(item => item.kind === 'fallback').relationRef.values, { process: 'i-onbin before past た' });
  assert(!items.some(item => item.tier2FacetId === 'pf.structured'));
  assert.deepEqual(r, original);
});

test('stem rewrite remains separate from an entire inflectional complex and its past allomorph', () => {
  const before = [{ id: 'complex', label: 'I⁰', children: [leaf('stem', '読む'), { id: 'past', label: 'I⁰[past]', children: [] }] }];
  const now = [{ id: 'complex', label: 'I⁰', children: [leaf('stem', '読ん'), { id: 'past', label: 'I⁰[past]', word: 'だ', children: [] }] }];
  const r = relation({ relation: 'past-tense morphological realization',
    anchors: { inflectionalDomain: 'complex', pastExponent: 'past', stem: 'stem' },
    priorAnchors: { abstractPast: 'past', inflectionalDomain: 'complex', lexicalVerb: 'stem' },
    values: { lexicalVerb: '読む', stemAllomorph: '読ん', pastAllomorph: 'だ', surfaceWord: '読んだ' } });
  const { items, rewrites } = inspect(r, now, before);
  assert.deepEqual(rewrites.map(item => item.rows), [[{ label: '読む', value: '読ん' }]]);
  assert.deepEqual(items.find(item => item.tier2FacetId === 'pf.structured').rows, [{ label: 'surfaceWord', value: '読んだ' }]);
  assert.equal(items.find(item => item.kind === 'fallback').relationRef.values.pastAllomorph, 'だ');
  assert(!items.some(item => item.tier2FacetId === 'pf.fission' || item.tier2FacetId === 'pf.correspondence'));
});

test('a containing PF host cannot duplicate the rewrite column, while independent whole-word rows survive', () => {
  const before = [{ id: 'complex', label: 'I⁰', children: [...prior, { id: 'past', label: 'I⁰[past]', word: 'た', children: [] }] }];
  const now = [{ id: 'complex', label: 'I⁰', children: [...current, { id: 'past', label: 'I⁰[past]', word: 'た', children: [] }] }];
  const r = relation({ anchors: { morphologicalDomain: 'complex', stem: 'stem' },
    values: { ...relation().values, surfaceWord: '書いた', 'PF rows': ['書い', 'independent authored row'] } });
  const { result, items, rewrites } = inspect(r, now, before);
  assert.equal(rewrites.length, 1);
  const plaque = items.find(item => item.tier2FacetId === 'pf.structured');
  assert.deepEqual(plaque.anchorNodeIds, ['complex']);
  assert.deepEqual(plaque.rows, [
    { label: 'surfaceWord', value: '書いた' }, { label: 'PF rows', value: '書い' }, { label: 'PF rows', value: 'independent authored row' }
  ]);
  assert.equal(result.facets.filter(facet => facet.evaluation.consumedEvidence.some(ref => ref.field === 'values' && ref.key === 'surfaceStem')).length, 1);
  const unrelated = { ...r, anchors: { surfaceForm: 'other', stem: 'stem' } };
  const other = { id: 'other', label: 'I⁰', children: [leaf('otherStem', 'other')] };
  const separate = inspect(unrelated, [...now, other], [...before, other]);
  assert(separate.items.some(item => item.tier2FacetId === 'pf.structured' && item.rows.some(row => row.label === 'surfaceStem')),
    'a different physical host is not swallowed by coincident literal spelling');
});

test('prior and current witnesses must resolve uniquely and actually change as declared', () => {
  for (const [now, before] of [
    [current, null], [current, []], [current, [leaf('stem', 'wrong')]],
    [[leaf('stem', 'wrong')], prior], [prior, prior],
    [[...current, leaf('stem', '書い')], prior], [current, [...prior, leaf('stem', '書く')]],
    [[{ ...current[0], children: [leaf('part', '書い')] }], prior],
    [[{ ...current[0], lineageId: 'new' }], [{ ...prior[0], lineageId: 'old' }]]
  ]) assert.equal(inspect(relation(), now, before).rewrites.length, 0);
  const changedId = relation({ anchors: { stem: 'raised' } });
  assert.equal(inspect(changedId, [leaf('raised', '書い')]).rewrites.length, 0);
  assert.equal(inspect(changedId, [leaf('raised', '書い', { lineageId: 'v' })], [leaf('stem', '書く', { lineageId: 'v' })]).rewrites.length, 1);
});

test('competing carriers, literal alternatives, absent columns and conflicting mappings stay literal', () => {
  for (const changes of [
    { anchors: { stem: ['stem', 'other'] } },
    { anchors: { stem: 'stem', lexicalVerb: 'other' } },
    { priorAnchors: { lexicalForm: 'stem', lexicalVerb: 'other' } },
    { priorAnchors: {} },
    { values: { lexicalCitationForm: ['書く', '書き'], surfaceStem: '書い' } },
    { values: { lexicalCitationForm: '書く', surfaceStem: '書い', stemAllomorph: '書き' } },
    { values: { lexicalCitationForm: '書く' } },
    { values: { lexicalCitationForm: '書く', surfaceStem: '書い', mapping: '書く -> 書き' } }
  ]) assert.equal(inspect(relation(changes)).rewrites.length, 0, JSON.stringify(changes));
});

test('token segmentation, joint realization and unasserted allomorphs are not a stem rewrite', () => {
  for (const name of ['orthographic input association', 'joint morphological realization',
    'Possible stem allomorphy', 'No stem allomorphy', 'whether stem allomorphy',
    'past-conditioned stem allomorphy is pending', 'stem allomorphy; failed stem allomorphy'])
    assert.equal(inspect(relation({ relation: name })).rewrites.length, 0, name);
  for (const outcome of ['pending', 'failed', 'hypothetical'])
    assert.equal(inspect(relation({ values: { ...relation().values, outcome } })).rewrites.length, 0, outcome);
  assert.equal(inspect(relation({ relation: 'failed agreement; past-conditioned stem allomorphy' })).rewrites.length, 1);
});

test('allomorph evidence cannot salvage malformed exact VocabularyInsertion', () => {
  const { result, rewrites } = inspect(relation({ relation: 'VocabularyInsertion' }));
  assert.equal(result.primaryClaim.tier, 3);
  assert.equal(rewrites.length, 0);
});
