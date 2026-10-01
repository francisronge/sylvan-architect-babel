import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const lower = { id: 'low', label: 'DP', lineageId: 'argument', word: 'which' };
const core = { id: 'core', label: 'v', children: [
  { id: 'phaseHead', label: 'v[transitive]', silent: true },
  { id: 'predicate', label: 'VP', children: [{ id: 'verb', label: 'V', word: 'read' }, lower] }
] };
const priorForest = [core];
const forest = [{ id: 'edgeProjection', label: 'v', children: [
  { ...lower, id: 'high' }, structuredClone(core)
] }];
const relation = {
  relation: 'Internal Merge',
  anchors: { higherOccurrence: 'high', lowerOccurrence: 'low', phaseHead: 'phaseHead' },
  priorAnchors: { source: 'low' }, values: { landingSite: 'outer edge of transitive v' }
};
const dispatch = (record = relation, currentForest = forest) => dispatchRelationClaims({
  relation: record, currentForest, priorForest, stageIndex: 1, relationIndex: 0
});
const recipes = (record = relation, currentForest = forest) => dispatch(record, currentForest).claims
  .filter(claim => claim.tier === 2).map(claim => claim.facet.recipe.id);
const plans = (record = relation, currentForest = forest) => compileRelationRenderPlan([
  { statement: '', stageRecord: '', relations: [], workspaceForest: priorForest },
  { statement: '', stageRecord: '', relations: [record], workspaceForest: currentForest }
]).frames[1].items;

test('an explicit phase-edge landing retains its movement and exact outline ownership', () => {
  const original = structuredClone({ relation, forest });
  assert.deepEqual(recipes(), ['movement.path', 'phase.edge']);
  const claim = dispatch().claims.find(claim => claim.facet?.recipe.id === 'phase.edge');
  assert.deepEqual(claim.consumedEvidence.map(ref => [ref.field, ref.key, ref.itemIndices]), [
    ['anchors', 'higherOccurrence', [0]]
  ]);
  const residual = dispatch().claims.find(claim => claim.tier === 3);
  assert(residual.consumedEvidence.some(ref => ref.field === 'anchors' && ref.key === 'phaseHead'));
  assert(residual.consumedEvidence.some(ref => ref.field === 'values' && ref.key === 'landingSite'));
  const marks = plans().filter(item => item.kind === 'domain-mark');
  assert.equal(marks.length, 1);
  assert.equal(marks[0].rootNodeId, 'high');
  assert.deepEqual(marks[0].memberNodeIds, ['high']);
  assert.equal(marks[0].domainStyle, 'transfer-edge');
  assert.deepEqual({ relation, forest }, original);
});

test('phase-edge meaning can be explicit in the operation or in its typed trigger', () => {
  for (const record of [
    { ...relation, relation: 'internalMergeToPhaseEdge', values: {} },
    { ...relation, relation: 'phase-edge-movement', values: {} },
    { ...relation, relation: 'Phase-edge Internal Merge', values: {} },
    { ...relation, relation: 'wh movement through the phase edge', values: {} },
    { ...relation, relation: 'Successive-cyclic Internal Merge', values: { trigger: 'v edge feature' } },
    { ...relation, anchors: { edgeOccurrence: 'high', source: 'low', phaseHead: 'phaseHead' }, values: { trigger: 'v-edge feature' } },
    { ...relation, values: { landingPosition: 'embedded little-v edge' } }
  ]) assert(recipes(record).includes('phase.edge'), JSON.stringify(record));
  const cForest = structuredClone(forest);
  cForest[0].label = 'CP'; cForest[0].children[1].label = 'C′';
  cForest[0].children[1].children[0].label = 'C';
  assert(recipes({ ...relation, values: { landingSite: 'embedded declarative C edge' } }, cForest).includes('phase.edge'));
});

test('new edge recovery does not infer phasehood, Transfer, or a whole-domain overlay', () => {
  for (const record of [
    { ...relation, anchors: { higherOccurrence: 'high', lowerOccurrence: 'low' } },
    { ...relation, values: {} },
    { ...relation, values: { locality: 'Reach the phase edge before transfer of the complement.' } },
    { ...relation, values: { landingSite: 'matrix T edge' } },
    { ...relation, values: { trigger: 'edge feature supporting later focus movement' } },
    { ...relation, relation: 'An inquiry about Internal Merge' }
  ]) assert(!recipes(record).includes('phase.edge'), JSON.stringify(record));
  assert(!recipes().some(recipe => ['phase.domain', 'transfer.domain', 'transfer.access'].includes(recipe)));
});

test('denied or provisional edge assertions cannot be painted as an established position', () => {
  for (const label of ['possible Internal Merge', 'failed Internal Merge', 'no Internal Merge',
    'Internal Merge to phase edge is pending', 'Internal Merge; phase edge not established'])
    assert(!recipes({ ...relation, relation: label }).includes('phase.edge'), label);
  for (const status of ['failed', 'blocked', 'pending', 'not established', 'could be reached'])
    assert(!recipes({ ...relation, values: { ...relation.values, status } }).includes('phase.edge'), status);
  assert(recipes({ ...relation, relation: 'Internal Merge; failed agreement' }).includes('phase.edge'));
});

test('an exact unique phase head and landing are required', () => {
  for (const anchors of [
    { ...relation.anchors, phaseHead: 'missing' },
    { ...relation.anchors, phaseHead: ['phaseHead', 'verb'] },
    { ...relation.anchors, higherOccurrence: ['high', 'low'] },
    { ...relation.anchors, higherOccurrence: 'missing' },
    { ...relation.anchors, 'phase head': 'verb' }
  ]) {
    assert(!recipes({ ...relation, anchors }).includes('phase.edge'), JSON.stringify(anchors));
  }
  const duplicate = structuredClone(forest); duplicate.push({ id: 'phaseHead', label: 'v' });
  assert(!recipes(relation, duplicate).includes('phase.edge'));
  for (const label of ['v′', 'vP', 'v+V']) {
    const changed = structuredClone(forest); changed[0].children[1].children[0].label = label;
    assert(!recipes(relation, changed).includes('phase.edge'), label);
  }
});

test('the landing must be attached along the named head projection, not elsewhere', () => {
  const wrongHead = { ...relation, anchors: { ...relation.anchors, phaseHead: 'verb' } };
  assert(!recipes(wrongHead).includes('phase.edge'));
  const interrupted = structuredClone(forest); interrupted[0].children[1].label = 'TP';
  assert(!recipes(relation, interrupted).includes('phase.edge'));
  const detached = [forest[0].children[0], forest[0].children[1]];
  assert(!recipes(relation, detached).includes('phase.edge'));
});

test('unrelated authored material remains neutral and exact malformed Tier 1 claims are not repaired', () => {
  const record = { ...relation, values: { ...relation.values, dependency: 'wh', future: 'Transfer later' } };
  const residual = dispatch(record).claims.find(claim => claim.tier === 3);
  assert(residual.consumedEvidence.some(ref => ref.field === 'values' && ref.key === 'future'));
  assert(residual.consumedEvidence.some(ref => ref.field === 'values' && ref.key === 'dependency'));
  assert(!recipes({ ...relation, relation: 'Phase' }).includes('phase.edge'));
  assert(recipes({ relation: 'edge accessibility', anchors: { phaseEdge: 'high' } }).includes('phase.edge'),
    'previously explicit phase-edge records still use their ordinary recipe');
});

test('an explicit Transfer composition continues to own its edge outline', () => {
  const record = { relation: 'Transferred domain and outside access',
    anchors: { phaseEdge: 'high', transferDomain: 'predicate', accessSource: 'outside', accessTarget: 'low' },
    values: { outcome: 'blocked' }
  };
  const current = [...forest, { id: 'outside', label: 'D', word: 'probe' }];
  const result = dispatch(record, current);
  assert(result.facets.some(facet => facet.recipe.id === 'transfer.domain'));
  assert(result.facets.some(facet => facet.recipe.id === 'transfer.access'));
  assert(!result.facets.some(facet => facet.recipe.id === 'phase.edge'));
  assert(result.diagnostics.some(diagnostic => diagnostic.collision === 'transfer-owns-edge'));
  assert.equal(plans(record, current).filter(item => item.kind === 'domain-mark'
    && item.domainStyle === 'transfer-edge' && item.rootNodeId === 'high').length, 1);
});
