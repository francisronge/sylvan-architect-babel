import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const forest = [{ id: 'nominal', label: 'N', children: [
  { id: 'relative', label: 'C', children: [
    { id: 'operator', label: 'D[relative]', silent: true },
    { id: 'clause', label: 'C', children: [
      { id: 'c', label: 'C', silent: true }, { id: 'v', label: 'V', children: [
        { id: 'verb', label: 'V', word: 'read' }, { id: 'variable', label: 'D', silent: true }
      ] }
    ] }
  ] },
  { id: 'noun', label: 'N', word: 'books' }
] }];
const relation = { relation: 'relative-clause restriction',
  anchors: { modifier: 'relative', nominalHead: 'noun', operator: 'operator', argumentVariable: 'variable' },
  values: { attachment: 'externally headed prenominal relative', interpretation: 'books someone read' }
};
const dispatch = (record = relation, currentForest = forest) => dispatchRelationClaims({ relation: record, currentForest, stageIndex: 0, relationIndex: 0 });
const recipes = (record = relation, currentForest = forest) => dispatch(record, currentForest).claims
  .filter(claim => claim.tier === 2).map(claim => claim.facet.recipe.id);
const plan = (record = relation, currentForest = forest) => compileRelationRenderPlan([
  { statement: '', stageRecord: '', relations: [record], workspaceForest: currentForest }
]).frames[0].items;

test('relative restriction paints the exact modifier fork alongside independent operator binding', () => {
  const before = structuredClone({ relation, forest });
  assert(recipes().includes('pair-merge'));
  assert(recipes().includes('operator-binding'));
  const claim = dispatch().claims.find(claim => claim.facet?.recipe.id === 'pair-merge');
  assert.deepEqual(claim.consumedEvidence.map(ref => [ref.field, ref.key, ref.itemIndices]), [
    ['anchors', 'nominalHead', [0]], ['anchors', 'modifier', [0]]
  ]);
  const fork = plan().find(item => item.kind === 'undirected-link' && item.linkStyle === 'pair-merge');
  assert.deepEqual(fork?.pairs, [{ fromNodeId: 'relative', toNodeId: 'noun' }]);
  assert.deepEqual({ relation, forest }, before);
});

test('restrictive relative-head interpretation does not require a prescribed attachment value', () => {
  const record = { relation: 'restrictive relative-head interpretation', anchors: { modifier: 'relative', nominalHead: 'noun' } };
  assert(recipes(record).includes('pair-merge'));
  const reverse = structuredClone(forest); reverse[0].children.reverse();
  assert(recipes(record, reverse).includes('pair-merge'), 'the authored branch order is preserved in either orientation');
});

test('relative modifier recovery does not replace a deep head with a parent or draw uncertain attachments', () => {
  const deepHead = structuredClone(forest);
  deepHead[0].children[1] = { id: 'nounProjection', label: 'NP', children: [deepHead[0].children[1]] };
  assert(!recipes(relation, deepHead).includes('pair-merge'));
  for (const record of [
    { ...relation, relation: 'possible relative-clause restriction' },
    { ...relation, relation: 'relative-clause restriction denied' },
    { ...relation, relation: 'an inquiry about relative-clause restriction' },
    { ...relation, relation: 'operator interpretation' },
    { ...relation, values: { ...relation.values, status: 'failed' } },
    { ...relation, anchors: { ...relation.anchors, host: 'clause' } },
    { ...relation, anchors: { ...relation.anchors, nominalHead: 'missing' } },
    { ...relation, anchors: { ...relation.anchors, nominalHead: ['noun', 'verb'] } }
  ]) assert(!recipes(record).includes('pair-merge'), JSON.stringify(record));
  assert(recipes({ ...relation, relation: 'relative-clause restriction; failed agreement' }).includes('pair-merge'));
});

test('the scope does not repair malformed exact Tier 1 claims or consume explanatory residue', () => {
  assert(!recipes({ ...relation, relation: 'PairMerge' }).includes('pair-merge'));
  const residual = dispatch().claims.find(claim => claim.tier === 3);
  assert(residual.consumedEvidence.some(ref => ref.key === 'attachment'));
  assert(residual.consumedEvidence.some(ref => ref.key === 'interpretation'));
});
