import assert from 'node:assert/strict';
import test from 'node:test';
import { __test__ } from '../server/babelParser.js';
import { buildTier2FacetEvidence, dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { recoverPFRewrite } from '../replay/relations/pfRewrite.ts';

const leaf = (id, word) => ({ id, label: 'V', word, children: [] });
const forest = [{ id: 'root', label: 'XP', children: [leaf('input', 'go'), leaf('output', 'went'), leaf('subject', 'they')] }];
const relation = changes => ({ relation: 'An explicit realization mapping',
  anchors: { input: 'input', output: 'output' }, values: { input: 'go', output: 'went' }, ...changes });
const dispatch = (r, currentForest = forest, priorForest) => dispatchRelationClaims({
  relation: r, stageIndex: priorForest ? 1 : 0, relationIndex: 0, currentForest, priorForest });
const stage = (r, workspaceForest = forest) => ({ statement: 'The authored state.', stageRecord: 'The exact authored relation.',
  relations: [r], workspaceForest: structuredClone(workspaceForest) });
const compile = r => {
  const bundle = __test__.normalizeParseBundle({ derivationStages: [stage(r)] }, 'xbar', 'go went they', 'grok', true);
  return compileRelationRenderPlan(bundle.analyses[0].derivationStages).frames[0].items;
};
const rewrites = items => items.filter(item => item.tier2FacetId === 'pf.rewrite');

test('a recovered pair owns the exact original scalar fields and no synthesized mapping literal', () => {
  const r = relation();
  const before = structuredClone(r);
  const result = dispatch(r);
  assert.equal(result.facets.length, 1);
  const facet = result.facets[0];
  assert.equal(facet.recipe.id, 'pf.rewrite');
  assert.deepEqual(facet.evidence.authoredValues.map(entry => [entry.key, entry.items]), [
    ['input', ['go']], ['output', ['went']]
  ]);
  assert.deepEqual(facet.evaluation.consumedEvidence, [
    { field: 'anchors', key: 'input', itemIndices: [0] },
    { field: 'anchors', key: 'output', itemIndices: [0] },
    { field: 'values', key: 'input', itemIndices: [0] },
    { field: 'values', key: 'output', itemIndices: [0] }
  ]);
  const items = compile(r);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].rows, [{ label: 'go', value: 'went' }]);
  assert.deepEqual(items[0].anchorNodeIds, ['output']);
  assert.deepEqual(r, before);
});

test('same-name alias fields preserve literal forms independent of displayed terminal words', () => {
  const r = relation({ anchors: { underlyingForm: 'input', surfaceForm: 'output' },
    values: { underlyingForm: '√GO + T[past]', surfaceForm: '∅' } });
  const items = compile(r);
  assert.equal(rewrites(items).length, 1);
  assert.deepEqual(rewrites(items)[0].rows, [{ label: '√GO + T[past]', value: '∅' }]);
  assert.deepEqual(dispatch(r).facets[0].evaluation.consumedEvidence.map(ref => ref.key),
    ['underlyingForm', 'surfaceForm', 'underlyingForm', 'surfaceForm']);
});

test('a prior input is retained under its original prior-anchor field', () => {
  const r = relation({ anchors: { output: 'output' }, priorAnchors: { input: 'input' } });
  const current = [leaf('output', 'went')], prior = [leaf('input', 'go')];
  const facets = dispatch(r, current, prior).facets;
  assert.equal(facets.length, 1);
  assert(facets[0].evaluation.consumedEvidence.some(ref => ref.field === 'priorAnchors'
    && ref.key === 'input' && JSON.stringify(ref.itemIndices) === '[0]'));
  const items = compileRelationRenderPlan([stage({ relation: 'context', anchors: {} }, prior), stage(r, current)]).frames[1].items;
  assert.equal(rewrites(items).length, 1);
  assert.deepEqual(rewrites(items)[0].rows, [{ label: 'go', value: 'went' }]);
});

test('the exact corroborating row has one owner while an independent property and repeated text survive', () => {
  const r = relation({ anchors: { input: 'input', output: 'output', subject: 'subject' },
    values: { input: 'go', output: 'went', mapping: 'go -> went', subjectFeatures: 'plural', note: 'went' } });
  const items = compile(r);
  assert.equal(rewrites(items).length, 1);
  assert.deepEqual(items.filter(item => item.tier2FacetId === 'plaque.structured').map(item => [item.anchorNodeIds, item.rows]),
    [[['subject'], [{ label: 'subjectFeatures', value: 'plural' }]]]);
  assert.deepEqual(items.find(item => item.kind === 'fallback').relationRef.values, { note: 'went' });
  const owners = dispatch(r).facets.flatMap(facet => facet.evaluation.consumedEvidence
    .filter(ref => ref.field === 'values' && ref.key === 'mapping').map(() => facet.recipe.id));
  assert.deepEqual(owners, ['pf.rewrite']);
});

test('a generic PF plaque keeps only its independent rows when it shares the rewrite output host', () => {
  const r = relation({ anchors: { underlyingForm: 'input', surfaceForm: 'output' },
    values: { underlyingForm: 'go', surfaceForm: 'went', 'PF rows': ['audible', 'went'] } });
  const items = compile(r);
  assert.equal(rewrites(items).length, 1);
  const properties = items.filter(item => item.tier2FacetId === 'pf.structured');
  assert.equal(properties.length, 1);
  assert.deepEqual(properties[0].rows, [{ label: 'PF rows', value: 'audible' }, { label: 'PF rows', value: 'went' }]);
  assert.deepEqual(properties[0].anchorNodeIds, ['output']);
  const result = dispatch(r);
  assert.deepEqual(result.facets.filter(facet => facet.recipe.id === 'pf.structured')
    .flatMap(facet => facet.evaluation.consumedEvidence.filter(ref => ref.field === 'values')),
  [{ field: 'values', key: 'PF rows', itemIndices: [0, 1] }]);
});

test('contextual, denied, provisional and conflicting label clauses do not assert a PF mapping', () => {
  const names = ['Input and output context', 'A realization description', 'Possible realization mapping',
    'No realization mapping; an explicit realization mapping',
    'Not a realization mapping; an explicit realization mapping',
    'Not established realization mapping; an explicit realization mapping',
    'failed PF rewrite, but an explicit realization mapping',
    'An explicit realization mapping; realization mapping is pending'];
  for (const name of names) {
    const r = relation({ relation: name });
    const evidence = buildTier2FacetEvidence({ relation: r, currentForest: forest });
    assert.equal(recoverPFRewrite(evidence).length, 0, name);
    const items = compile(r);
    assert.equal(rewrites(items).length, 0, name);
    for (const [key, value] of Object.entries(r.values)) assert(items.some(item => item.relationRef.values?.[key] === value), name);
  }
  const independent = compile(relation({ relation: 'failed agreement; an explicit realization mapping' }));
  assert.equal(rewrites(independent).length, 1, 'an unrelated denied claim does not negate the mapping');
});

test('negative and unresolved statuses cannot produce a rewrite from either scalar or arrow rows', () => {
  for (const status of ['failed', 'blocked', 'pending', 'not established']) {
    for (const mapping of [undefined, 'go -> went']) {
      const r = relation({ values: { input: 'go', output: 'went', status, ...(mapping ? { mapping } : {}) } });
      const items = compile(r);
      assert.equal(rewrites(items).length, 0, JSON.stringify(r));
      assert(items.some(item => item.kind === 'fallback' && item.relationRef.values?.status === status));
    }
  }
});

test('a positive status qualifies one original mapping without becoming another drawn row', () => {
  for (const mapping of [undefined, 'go -> went']) {
    const r = relation({ values: { input: 'go', output: 'went', status: 'successful', ...(mapping ? { mapping } : {}) } });
    const items = compile(r);
    assert.equal(items.length, 1);
    assert.equal(rewrites(items).length, 1);
    assert.deepEqual(rewrites(items)[0].rows, [{ label: 'go', value: 'went' }]);
    assert.deepEqual(rewrites(items)[0].realizationRowKinds, ['rewrite']);
    assert(dispatch(r).facets[0].evaluation.consumedEvidence.some(ref => ref.field === 'values' && ref.key === 'status'));
  }
});

test('missing, mismatched or competing columns cannot be paired by position or spelling', () => {
  const variants = [
    { values: { source: 'go', output: 'went' } },
    { values: { input: ['go', 'go'], output: 'went' } },
    { values: { input: 'go', output: '' } },
    { anchors: { input: ['input', 'subject'], output: 'output' } },
    { anchors: { input: 'input', underlyingForm: 'subject', output: 'output' } },
    { anchors: { input: 'input', output: 'missing' } },
    { anchors: { input: 'input' } }
  ];
  for (const changes of variants) {
    const r = relation(changes);
    assert.equal(dispatch(r).facets.some(facet => facet.recipe.id === 'pf.rewrite'), false, JSON.stringify(changes));
  }
  assert.equal(dispatch(relation(), [...forest, leaf('input', 'go')]).facets.some(facet => facet.recipe.id === 'pf.rewrite'), false);
});

test('contradictory mapping rows remain neutral while independently matching rows retain their positions', () => {
  const r = relation({ values: { input: 'go', output: 'went', mapping: ['go -> went', 'walk -> walked', 'go -> went'] } });
  const result = dispatch(r);
  const rewrite = result.facets.find(facet => facet.recipe.id === 'pf.rewrite');
  assert.deepEqual(rewrite.evaluation.consumedEvidence.find(ref => ref.field === 'values' && ref.key === 'mapping').itemIndices, [0, 2]);
  assert.equal(rewrite.evidence.authoredValues.length, 1, 'the repeated row does not consume original scalar columns');
  const items = compile(r);
  assert.deepEqual(rewrites(items)[0].rows, [{ label: 'go', value: 'went' }, { label: 'go', value: 'went' }]);
  assert.deepEqual(items.find(item => item.kind === 'fallback').relationRef.values, { mapping: ['walk -> walked'] });
  const conflict = compile(relation({ values: { input: 'go', output: 'went', mapping: 'walk -> walked' } }));
  assert.equal(rewrites(conflict).length, 0);
  assert.deepEqual(conflict.find(item => item.kind === 'fallback').relationRef.values, { mapping: 'walk -> walked' });
});

test('an invalid mapping cannot masquerade as a same-name property or repair a malformed exact recipe', () => {
  const r = relation({ anchors: { input: 'input', output: 'output', mapping: 'subject' },
    values: { mapping: 'go -> went -> gone' } });
  const items = compile(r);
  assert.equal(items.some(item => item.kind === 'node-plaque'), false);
  assert.deepEqual(items.find(item => item.kind === 'fallback').relationRef.values, r.values);
  const native = relation({ relation: 'VocabularyInsertion' });
  assert.equal(dispatch(native).facets.some(facet => facet.recipe.id === 'pf.rewrite'), false);
});
