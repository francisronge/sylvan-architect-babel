import assert from 'node:assert/strict';
import test from 'node:test';
import { __test__ } from '../server/babelParser.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { visiblePlanFrameItems } from '../replay/relations/renderPlanCompiler.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';

const sentence = 'Mia bought and Leo read books';
const leaf = (id, label, word, tokenIndex) => ({ id, label, word, tokenIndex, children: [] });
const node = (id, label, children) => ({ id, label, children });
const forest = () => [node('coord', 'CoordP', [
  node('left-clause', 'TP', [leaf('mia', 'D', 'Mia', 0), node('left-predicate', 'VP', [leaf('bought', 'V', 'bought', 1)])]),
  node('coord-bar', 'Coord′', [leaf('and', 'Coord', 'and', 2), node('right-clause', 'TP', [
    leaf('leo', 'D', 'Leo', 3), node('right-predicate', 'VP', [leaf('read', 'V', 'read', 4),
      node('shared-object', 'DP', [leaf('books', 'N', 'books', 5)])])
  ])])
])];
const stage = (relation, workspaceForest = forest()) => ({ statement: 'The object is shared.',
  stageRecord: 'Both predicates share the final object.', relations: [relation], workspaceForest });
const allNodes = tree => [tree, ...(tree.children ?? []).flatMap(allNodes)];
const normalizedReplay = (relation, framework) => {
  const authored = { derivationStages: [stage(relation)] }, before = structuredClone(authored);
  const bundle = __test__.normalizeParseBundle(authored, framework, sentence, 'grok', true);
  assert.deepEqual(authored, before, 'normalization cannot rewrite the sharing analysis');
  const analysis = bundle.analyses[0];
  assert.deepEqual(analysis.derivationStages[0].relations, [relation]);
  const nodes = analysis.derivationStages[0].workspaceForest.flatMap(allNodes);
  assert.equal(nodes.length, new Set(nodes.map(n => n.id)).size);
  assert.equal(nodes.filter(n => n.id === 'shared-object').length, 1);
  const replay = prepareReplay({ sentence, inputTokens: bundle.inputTokens,
    derivationStages: analysis.derivationStages, includePlayback: true });
  return { replay, nodes };
};
const bound = ({ replay, nodes }) => {
  const positions = new Map(nodes.map((node, index) => [node.id, { x: index * 100, y: index * 40 }]));
  const result = bindRelationPlanFrame(replay.relationRenderPlan, 0, id => positions.get(id) ?? null);
  assert.deepEqual(result.failed, []);
  return result.primitives;
};

for (const framework of ['xbar', 'minimalism']) {
  test(`${framework}: public single-occurrence multidominance reaches the existing shared-branch primitive`, () => {
    const anchors = { parents: ['left-predicate', 'right-predicate'], shared: 'shared-object' };
    const curated = normalizedReplay({ relation: 'Multidominance', anchors }, framework);
    for (const name of ['An independently named relation', '共有関係']) {
      const recovered = normalizedReplay({ relation: name, anchors }, framework);
      const item = recovered.replay.relationRenderPlan.frames[0].items.find(i => i.kind === 'shared-node');
      assert(item && item.tier2FacetId === 'multidominance');
      assert.deepEqual(item.parentNodeIds, anchors.parents);
      assert.equal(item.sharedNodeId, anchors.shared);
      assert(!visiblePlanFrameItems(recovered.replay.relationRenderPlan, 0, new Set()).some(i => i.kind === 'shared-node'));
      assert(visiblePlanFrameItems(recovered.replay.relationRenderPlan, 0, new Set([0])).some(i => i.kind === 'shared-node'));
      assert.deepEqual(bound(recovered), bound(curated));
      assert.equal(bound(recovered).filter(p => p.type === 'shared-branch').length, 2);
    }
  });

  test(`${framework}: explicit argument sharing crosses domains without duplicating the shared occurrence`, () => {
    const curated = normalizedReplay({ relation: 'ArgumentSharing',
      anchors: { domains: ['left-predicate', 'right-predicate'], shared: 'shared-object' }, values: { role: 'OBJ' } }, framework);
    const recovered = normalizedReplay({ relation: 'An independently named relation',
      anchors: { predicateDomains: ['left-predicate', 'right-predicate'], sharedArgument: 'shared-object' }, values: { role: 'OBJ' } }, framework);
    const domains = recovered.replay.relationRenderPlan.frames[0].items.filter(i => i.domainStyle === 'argument-domain');
    assert.equal(domains.length, 2);
    assert(domains.every(i => i.tier2FacetId === 'argument-sharing' && i.sharedNodeId === 'shared-object'));
    assert.deepEqual(bound(recovered), bound(curated));
  });
}

test('identity, generic arguments and unresolved or self-referential groups do not establish sharing', () => {
  const workspaceForest = forest();
  const nodes = workspaceForest.flatMap(allNodes);
  nodes.find(n => n.id === 'mia').lineageId = 'same-object';
  nodes.find(n => n.id === 'shared-object').lineageId = 'same-object';
  const controls = [
    { parents: ['left-predicate', 'right-predicate'], occurrences: ['mia', 'shared-object'] },
    { predicateDomains: ['left-predicate', 'right-predicate'], argument: 'shared-object' },
    { parents: ['left-predicate', 'missing'], shared: 'shared-object' },
    { parents: ['left-predicate', 'shared-object'], shared: 'shared-object' },
    { predicateDomains: ['left-predicate', 'left-predicate'], sharedArgument: 'shared-object' },
    { predicateDomains: ['left-predicate', 'shared-object'], sharedArgument: 'shared-object' }
  ];
  for (const anchors of controls) {
    const relation = { relation: 'An open identity claim', anchors, values: { explanation: 'The object is shared.' } };
    const result = dispatchRelationClaims({ relation, currentForest: workspaceForest, stageIndex: 0, relationIndex: 0 });
    assert(!result.facets.some(f => ['multidominance', 'argument-sharing'].includes(f.recipe.id)));
    assert.deepEqual(relation.anchors, anchors);
  }
});
