import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const authored = (annotatedVerb = false) => {
  const tense = annotatedVerb ? 'present' : 'past';
  return {
    relation: {
      relation: 'finiteTenseLicensing',
      anchors: annotatedVerb ? { finiteHead: 'finite', verb: 'lexical' } : { inflection: 'finite', lexicalVerb: 'lexical' },
      values: annotatedVerb
        ? { morphologicalTreatment: 'whole-word lexical inflection without overt V-to-I movement', tense }
        : { realization: 'Lexically inflected persuaded; abstract I has no independent pronunciation.', tense }
    },
    forest: [{ id: 'clause', label: 'IP', children: [
      { id: 'subject', label: 'DP', word: 'Mira' },
      { id: 'ibar', label: 'I′', children: [
        { id: 'finite', label: `I [finite, ${tense}]`, silent: true, children: [] },
        { id: 'vp', label: 'VP', children: [{ id: 'vbar', label: 'V′', children: [
          { id: 'lexical', label: annotatedVerb ? `V [raising, ${tense}]` : 'V', word: annotatedVerb ? 'seem' : 'persuaded', children: [] },
          { id: 'object', label: 'DP', word: 'Joel' }
        ] }] }
      ] }
    ] }]
  };
};
const node = (data, id) => {
  const visit = current => current.id === id ? current : current.children?.map(visit).find(Boolean);
  return data.forest.map(visit).find(Boolean);
};
const dispatch = ({ relation, forest }) => dispatchRelationClaims({ relation, currentForest: forest, stageIndex: 0, relationIndex: 0 });
const items = ({ relation, forest }) => compileRelationRenderPlan([{
  statement: 'The finite head licenses the lexical form.', stageRecord: '', workspaceForest: forest, relations: [relation]
}]).frames[0].items;
const plate = data => items(data).find(item => item.tier2FacetId === 'pf.structured');
const contextOwned = data => dispatch(data).claims.some(claim => claim.tier === 2
  && claim.facet.recipe.id === 'pf.structured'
  && claim.facet.evidence?.authoredCurrentAnchors.some(entry => entry.concepts.includes('pf.context')));

test('explicit inflected-form licensing owns finite context while preserving the existing PF plate', () => {
  const data = authored();
  const original = structuredClone(data);
  const withoutContext = structuredClone(data);
  delete withoutContext.relation.anchors.inflection;
  const actual = plate(data), previous = plate(withoutContext);
  assert.equal(contextOwned(data), true);
  assert.equal(items(data).some(item => item.kind === 'fallback'), false);
  assert.deepEqual(actual.anchorNodeIds, ['lexical']);
  assert.deepEqual(actual.rows, previous.rows);
  assert.equal(actual.replacementGroup, previous.replacementGroup);
  assert.deepEqual(actual.tier2OutputIdentities, previous.tier2OutputIdentities);
  assert.deepEqual(actual.tier2WitnessNodeIds, ['lexical']);
  assert.equal(items(data).some(item => ['trajectory', 'directed-path', 'undirected-link'].includes(item.kind)), false);
  assert.deepEqual(data, original, 'ownership must not rewrite the authored record');
});

test('matching authored head and verb tense recover whole-word treatment as a literal PF row', () => {
  const data = authored(true);
  assert.equal(contextOwned(data), true);
  assert.equal(items(data).some(item => item.kind === 'fallback'), false);
  assert.deepEqual(plate(data).anchorNodeIds, ['lexical']);
  assert.deepEqual(plate(data).rows, [
    { label: 'morphologicalTreatment', value: data.relation.values.morphologicalTreatment },
    { label: 'tense', value: 'present' }
  ]);
  assert.deepEqual(plate(data).realizationRowKinds, ['literal', 'literal']);
  assert.equal(items(data).some(item => ['trajectory', 'directed-path', 'undirected-link'].includes(item.kind)), false);
});

test('unproved, contradictory, ambiguous and nonlocal participants retain their residual ownership', () => {
  const negatives = [
    ['missing finite head', data => { data.relation.anchors.inflection = 'missing'; }],
    ['duplicate finite head', data => { data.forest.push(structuredClone(node(data, 'finite'))); }],
    ['duplicate lexical host', data => { data.forest.push(structuredClone(node(data, 'lexical'))); }],
    ['nonfinite head', data => { node(data, 'finite').label = 'I [-finite, past]'; }],
    ['mismatched source tense', data => { node(data, 'finite').label = 'I [finite, present]'; }],
    ['conflicting source tense', data => { node(data, 'finite').label = 'I [finite, past, present]'; }],
    ['mismatched annotated host', data => { node(data, 'lexical').label = 'V [present]'; }],
    ['phrase instead of head', data => { node(data, 'finite').label = 'IP [finite, past]'; }],
    ['compound instead of abstract head', data => { node(data, 'finite').label = 'I+V [finite, past]'; }],
    ['pronounced finite head', data => { node(data, 'finite').silent = false; node(data, 'finite').word = 'did'; }],
    ['wrong host category', data => { node(data, 'lexical').label = 'N'; }],
    ['unpronounced host', data => { node(data, 'lexical').silent = true; }],
    ['different inflected form', data => { data.relation.values.realization = 'Lexically inflected left; no separate affix.'; }],
    ['provisional form', data => { data.relation.values.realization = 'Possibly lexically inflected persuaded.'; }],
    ['missing form proof', data => { delete data.relation.values.realization; }],
    ['blank tense', data => { data.relation.values.tense = ''; }],
    ['multiple tense values', data => { data.relation.values.tense = ['past', 'present']; }],
    ['multiple head anchors', data => { data.relation.anchors.inflection = ['finite', 'subject']; }],
    ['competing head field', data => { data.relation.anchors.finiteHead = 'finite'; }],
    ['competing lexical host', data => { data.relation.anchors.inflectedVerb = 'object'; }],
    ['failed claim', data => { data.relation.relation = 'failed finite tense licensing'; }],
    ['provisional claim', data => { data.relation.relation = 'possible finite tense licensing'; }],
    ['negative outcome', data => { data.relation.values.status = 'unlicensed'; }],
    ['unfamiliar claim', data => { data.relation.relation = 'unrelated association'; }],
    ['disconnected host', data => { const verb = structuredClone(node(data, 'lexical')); node(data, 'vbar').children.shift(); data.forest.push(verb); }],
    ['embedded-clause host', data => { const verb = node(data, 'lexical'); node(data, 'vp').children = [{ id: 'embedded', label: 'CP', children: [verb] }]; }]
  ];
  for (const [label, change] of negatives) {
    const data = authored(); change(data);
    assert.equal(contextOwned(data), false, label);
  }
  for (const change of [
    data => { node(data, 'lexical').label = 'V [raising, past]'; },
    data => { data.relation.values.morphologicalTreatment = 'whole-word lexical inflection not established'; },
    data => { data.relation.values.morphologicalTreatment = ['whole-word lexical inflection', 'affix lowering']; }
  ]) {
    const data = authored(true); change(data);
    assert.equal(contextOwned(data), false, JSON.stringify(data.relation));
  }
});

test('verified finite context does not consume or print independent unknown siblings', () => {
  const data = authored();
  data.relation.anchors.foreignWitness = 'object';
  data.relation.values.foreignOperation = 'an independently authored operation';
  const result = dispatch(data);
  assert.equal(contextOwned(data), true);
  const residual = result.claims.find(claim => claim.tier === 3);
  assert.ok(residual);
  assert.deepEqual(result.primaryRelation.anchors, { foreignWitness: 'object' });
  assert.deepEqual(result.primaryRelation.values, { foreignOperation: 'an independently authored operation' });
  assert.equal(plate(data).rows.some(row => row.label === 'foreignOperation'), false);
  assert.equal(items(data).some(item => item.kind === 'fallback'), true);
});
