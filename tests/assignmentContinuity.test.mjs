import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchStageRelations } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan, planItemRelationRefs } from '../replay/relations/renderPlanCompiler.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';

const n = (id, children = [], fields = {}) => ({ id, label: id, children, ...fields });
const before = [n('VP', [n('v', [], { label: 'V', word: 'read', lineageId: 'verb' }), n('object', [], { label: 'DP', word: 'books' })])];
const after = [n('IP', [n('complex', [n('raised', [], { label: 'V', word: 'read', lineageId: 'verb' }), n('tense', [], { label: 'I' })], { label: 'I' }),
  n('VP', [n('trace', [], { label: 'V', word: 'read', lineageId: 'verb', silent: true }), before[0].children[1]])])];
const stage = (workspaceForest, relations) => ({ workspaceForest, relations, statement: 'Authored state', stageRecord: 'The authored analysis.' });
const assignment = (role = 'Theme') => ({ relation: 'An open assignment', anchors: { predicate: 'v', argument: 'object' }, values: { thetaRole: role } });
const movement = { relation: 'An open movement', anchors: { source: 'trace', raisedHead: 'raised', trace: 'trace' }, priorAnchors: { source: 'v' } };
const restatement = { relation: 'An open restatement', anchors: { chain: ['raised', 'trace'], argument: 'object' }, values: { thetaRole: 'Theme' } };
const continued = stages => dispatchStageRelations(stages).at(-1).at(-1).facets
  .filter(f => f.evidence && ['theta-grid', 'feature.dependency'].includes(f.recipe.id));

test('an explicit earlier assignment follows the proven lower occurrence, independent of list order and pronunciation', () => {
  for (const chain of [['raised', 'trace'], ['trace', 'raised']]) for (const pronounced of [false, true]) {
    const forest = structuredClone(after);
    forest[0].children[1].children[0].silent = !pronounced;
    const stages = [stage(before, [assignment()]), stage(forest, [movement, { ...restatement, anchors: { ...restatement.anchors, chain } }])];
    const original = structuredClone(stages);
    const facets = continued(stages);
    assert.equal(facets.length, 1);
    assert.deepEqual(facets[0].evidence.currentAnchors, { predicate: ['trace'], 'theta.arguments': ['object'] });
    assert.deepEqual(facets[0].evaluation.consumedEvidence.find(ref => ref.key === 'chain').itemIndices, [chain.indexOf('trace')]);
    const d = dispatchStageRelations(stages)[1][1];
    assert.deepEqual(d.evidenceCoverage.fields.find(f => f.key === 'chain').unrecoveredItemIndices, []);
    assert.deepEqual(d.facets.find(f => f.recipe.id === 'identity.occurrences').evidence.currentAnchors.occurrences, chain);
    const grid = compileRelationRenderPlan(stages).frames[1].items.find(item => item.plaqueStyle === 'theta-grid' && planItemRelationRefs(item).some(ref => ref.stageIndex === 1));
    assert.deepEqual(grid.anchorNodeIds, ['trace']);
    assert.deepEqual(grid.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label })), [{ nodeId: 'object', label: 'Theme' }]);
    assert.deepEqual(stages, original);
  }
});

test('history does not supply unproved identity, changed values, future evidence or a malformed exact claim', () => {
  const wrongLineage = structuredClone(after);
  wrongLineage[0].children[1].children[0].lineageId = 'different';
  for (const stages of [
    [stage(before, []), stage(after, [movement, restatement])],
    [stage(before, [assignment()]), stage(after, [restatement])],
    [stage(before, [assignment('Agent')]), stage(after, [movement, restatement])],
    [stage(before, [assignment()]), stage(wrongLineage, [movement, restatement])],
    [stage(before, [assignment()]), stage(after, [restatement, movement])],
    [stage(before, [assignment()]), stage(after, [movement, { ...restatement, relation: 'ThetaAssignment' }])]
  ]) assert.equal(continued(stages).length, 0, JSON.stringify(stages));
});

test('several explicit restatements stay simultaneous and retain original value ownership', () => {
  const forest = [n('root', [n('a'), n('b'), n('c'), n('d')])];
  const assignments = [
    { relation: 'First', anchors: { predicate: 'a', argument: 'b' }, values: { thetaRole: 'Agent' } },
    { relation: 'Second', anchors: { predicate: 'c', argument: 'd' }, values: { thetaRole: 'Theme' } }
  ];
  const summary = { relation: 'Together', anchors: { sources: ['c', 'a'], participants: ['b', 'd'] }, values: { participants: ['Agent', 'Theme'] } };
  const stages = [stage(forest, assignments), stage(forest, [summary])];
  const facets = continued(stages);
  assert.equal(facets.length, 2);
  assert.equal(new Set(facets.map(facet => facet.facetIdentity)).size, 2);
  assert.deepEqual(facets.map(f => f.evidence.currentAnchors), [
    { predicate: ['a'], 'theta.arguments': ['b'] }, { predicate: ['c'], 'theta.arguments': ['d'] }
  ]);
  const plan = compileRelationRenderPlan(stages);
  const grids = plan.frames[1].items.filter(item => item.plaqueStyle === 'theta-grid' && planItemRelationRefs(item).some(ref => ref.stageIndex === 1));
  assert.equal(grids.length, 2);
  assert(grids.every(item => planItemRelationRefs(item).some(ref => ref.stageIndex === 1 && ref.relationIndex === 0)));
  const moments = prepareReplay({ derivationStages: stages, sentence: '', includePlayback: true }).playbackSteps
    .filter(step => step.replayFrameIndex === 1 && step.replayKind === 'relation');
  assert.equal(moments.length, 1);
  const noHistory = [stage(forest, []), stage(forest, [summary])];
  assert.equal(continued(noHistory).length, 0, 'equal-length arrays do not prove assignments');
  const ambiguous = [stage(forest, [...assignments, { relation: 'Competing source', anchors: { predicate: 'c', argument: 'b' }, values: { thetaRole: 'Agent' } }]), stage(forest, [summary])];
  assert.equal(continued(ambiguous).length, 1, 'only the independently unambiguous Theme claim survives');
});

test('an unchanged assignment reuses its earlier exact drawing across tiers, with both relation owners', () => {
  const first = { relation: 'ThetaAssignment', anchors: { predicate: 'v', Theme: 'object' } };
  const later = { relation: 'Restatement', anchors: { verbalChain: 'v', thetaPosition: 'object' }, values: { thetaPosition: 'Theme' } };
  const stages = [stage(before, [first]), stage(before, [later])];
  assert.equal(dispatchStageRelations(stages)[0][0].primaryClaim.tier, 1);
  assert.equal(continued(stages).length, 1);
  const plan = compileRelationRenderPlan(stages);
  const grids = plan.frames[1].items.filter(item => item.plaqueStyle === 'theta-grid');
  assert.equal(grids.length, 1);
  assert.deepEqual(planItemRelationRefs(grids[0]).map(ref => [ref.stageIndex, ref.relationIndex]), [[0, 0], [1, 0]]);
  const badges = plan.frames[1].items.filter(item => item.badgeStyle === 'theta-role');
  assert.equal(badges.length, 1);
  assert.deepEqual(planItemRelationRefs(badges[0]).map(ref => ref.stageIndex), [0, 1]);
  const changed = [stage(before, [first]), stage(before, [{ ...later, values: { thetaPosition: 'Agent' } }])];
  assert.equal(continued(changed).length, 0, 'a changed literal is a new claim, not the old assignment');
});

test('failed or unknown assignments do not establish history or silently become positive role grids', () => {
  for (const outcome of ['failed', 'blocked', 'unknown']) {
    const failed = { ...assignment(), values: { ...assignment().values, outcome } };
    assert.equal(continued([stage(before, [failed]), stage(after, [movement, restatement])]).length, 0);
    const denied = { ...restatement, values: { ...restatement.values, outcome } };
    assert.equal(continued([stage(before, [assignment()]), stage(after, [movement, denied])]).length, 0);
  }
});
