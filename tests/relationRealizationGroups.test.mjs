import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims, dispatchRelationClaimBatch, dispatchStageRelations } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan, visiblePlanFrameItems } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { getFrameRelations } from '../replay/replayCompiler.ts';

const forest = [{ id: 'root', label: 'XP', children: [
  { id: 'x7', label: 'X', word: '甲' },
  { id: 'y3', label: 'Y', word: '乙' },
  { id: 'z8', label: 'Z', word: '丙' },
  { id: 'q1', label: 'Q', word: '丁' }
] }];
const group = { nodeIds: ['x7', 'y3', 'z8'], tokenIndices: [0] };
const relation = { relation: 'An unfamiliar realization description', anchors: { contributors: [...group.nodeIds], context: 'root' },
  values: { surfaceForm: '甲乙丙', operation: 'The authored explanation is preserved.' } };
const stage = (r = relation, realizations = [group], workspaceForest = forest) => ({
  statement: 'The completed state.', stageRecord: 'The stage explanation.', workspaceForest, realizations, relations: [r]
});
const inspect = (r = relation, realizations = [group], workspaceForest = forest) => {
  const input = stage(r, realizations, workspaceForest), original = structuredClone(input);
  const dispatch = dispatchStageRelations([input])[0][0];
  const plan = compileRelationRenderPlan([input]);
  assert.deepEqual(input, original);
  return { dispatch, plan, plates: plan.frames[0].items.filter(item => item.kind === 'node-plaque' && item.plaqueStyle === 'realization') };
};

test('a typed surface in an asserted realization uses the exact contributor group', () => {
  const r = { relation: 'Finite verbal morphological realization', anchors: { contributors: [...group.nodeIds] },
    values: { surface: '주었다', morphologicalContent: 'The authored explanation stays available.' } };
  const { plates, dispatch } = inspect(r);
  assert.equal(plates.length, 1);
  assert.deepEqual(plates[0].anchorNodeIds, group.nodeIds);
  assert.deepEqual(plates[0].rows, [{ label: 'surface', value: '주었다' }]);
  assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === 'morphologicalContent').unrecoveredItemIndices, [0]);
  for (const name of ['An unfamiliar observation', 'Possible morphological realization', 'No morphological realization'])
    assert.equal(inspect({ ...r, relation: name }).plates.length, 0, name);
  for (const groups of [[], [{ nodeIds: ['x7', 'y3'], tokenIndices: [0] }], [group, group]])
    assert.equal(inspect(r, groups).plates.length, 0);
  assert.equal(inspect({ ...r, anchors: { items: [...group.nodeIds] } }).plates.length, 0);
  assert.equal(inspect({ ...r, relation: 'VocabularyInsertion' }).plates.length, 0);
});

test('an exact current realization group earns one PF plate owned by every contributor', () => {
  for (const contributors of ['contributors', 'realizationContributors', 'realization_participants']) {
    for (const surface of ['surfaceForm', 'realized_form', 'surface realization', 'inputToken', 'surface_token', 'surfaceWord', 'realization']) {
      const r = { relation: 'No registered name', anchors: { context: 'root', [contributors]: ['z8', 'x7', 'y3'] },
        values: { operation: 'Keep this explanation.', [surface]: '새로운 형태' } };
      const { dispatch, plan, plates } = inspect(r);
      assert.equal(plates.length, 1);
      assert.deepEqual(plates[0].anchorNodeIds, r.anchors[contributors]);
      assert.deepEqual(plates[0].rows, [{ label: surface, value: '새로운 형태' }]);
      assert.deepEqual(plates[0].realizationRowKinds, ['literal'], 'a surface string is not an invented rewrite rule');
      assert.deepEqual(plates[0].relationRef.anchors[contributors], r.anchors[contributors]);
      assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === contributors).unrecoveredItemIndices, []);
      assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === 'operation').unrecoveredItemIndices, [0]);
      assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === 'context').unrecoveredItemIndices, [0]);
      const points = new Map([['x7', { x: 10, y: 20 }], ['y3', { x: 110, y: 30 }], ['z8', { x: 210, y: 40 }], ['root', { x: 100, y: 0 }]]);
      const primitive = bindRelationPlanFrame(plan, 0, id => points.get(id)).primitives.find(item => item.type === 'plaque' && item.plaqueStyle === 'realization');
      assert.deepEqual(primitive.anchorPoints, r.anchors[contributors].map(id => points.get(id)));
      assert(plan.frames[0].items.some(item => item.kind === 'fallback'));
    }
  }
});

test('Replay, direct, batch, and stage dispatch use the same current realization evidence', () => {
  const input = { relation, currentForest: forest, currentRealizations: [group], stageIndex: 0, relationIndex: 0 };
  const direct = dispatchRelationClaims(input);
  const batch = dispatchRelationClaimBatch({ ...input, relations: [relation] })[0].dispatch;
  const staged = inspect().dispatch;
  for (const result of [direct, batch, staged]) assert(result.facets.some(facet => facet.recipe.id === 'pf.structured'));
  const frame = { workspaceForest: forest, change: { details: { derivationStageRelations: [relation] } },
    after: { workspaceForest: forest, realizations: [group] } };
  assert.deepEqual(getFrameRelations(frame)[0].pronunciationNodeIds, group.nodeIds);
  assert.equal(getFrameRelations({ ...frame, after: { workspaceForest: forest } })[0].pronunciationNodeIds, undefined);
  assert.deepEqual(getFrameRelations({ ...frame, after: { workspaceForest: forest } }, { stageIndex: 0, stageNumber: 1, realizations: [group] })[0].pronunciationNodeIds, group.nodeIds);
});

test('a contributor may also realize a different token without changing the exact group attachment', () => {
  const { plates } = inspect(relation, [group, { nodeIds: ['z8', 'q1'], tokenIndices: [1] }]);
  assert.equal(plates.length, 1);
  assert.deepEqual(plates[0].anchorNodeIds, group.nodeIds);
  assert.deepEqual(plates[0].rows, [{ label: 'surfaceForm', value: relation.values.surfaceForm }]);
});

test('partial, competing, unresolved, or unassociated groups cannot select a PF plate attachment', () => {
  for (const realizations of [
    [],
    [{ nodeIds: ['x7', 'y3'], tokenIndices: [0] }],
    [{ nodeIds: ['x7', 'y3', 'z8', 'q1'], tokenIndices: [0] }],
    [{ nodeIds: ['x7'], tokenIndices: [0] }, { nodeIds: ['y3', 'z8'], tokenIndices: [1] }],
    [group, { ...group }],
    [group, { ...group, tokenIndices: [1] }],
    [group, { nodeIds: ['q1'], tokenIndices: [0] }],
    [{ ...group, tokenIndices: [] }],
    [{ ...group, tokenIndices: [-1] }],
    [{ ...group, tokenIndices: [0, 0] }]
  ]) assert.equal(inspect(relation, realizations).plates.length, 0, JSON.stringify(realizations));
  for (const r of [
    { ...relation, anchors: { contributors: ['x7', 'y3', 'y3'] } },
    { ...relation, anchors: { contributors: group.nodeIds, realizationParticipants: group.nodeIds } },
    { ...relation, anchors: { contributors: group.nodeIds, output: 'q1' } },
    { ...relation, values: { prose: 'The surface form is 甲乙丙.' } },
    { ...relation, values: { surfaceForm: ['甲', '乙'] } },
    { ...relation, values: { surfaceForm: '甲乙丙', realizedForm: 'different' } },
    { ...relation, values: { surfaceForm: '' } },
    { ...relation, relation: 'VocabularyInsertion' }
  ]) assert.equal(inspect(r).plates.length, 0, JSON.stringify(r));
  const missing = structuredClone(forest);
  missing[0].children = missing[0].children.filter(node => node.id !== 'z8');
  assert.equal(inspect(relation, [group], missing).plates.length, 0);
});

test('a literal surface token attaches to the complete exact group without a prescribed contributor role', () => {
  for (const anchors of [{ items: group.nodeIds }, { article: 'x7', nominal: ['y3', 'z8'] }]) {
    const { plates } = inspect({ relation: 'A novel name', anchors, values: { surfaceToken: 'whole token' } });
    assert.equal(plates.length, 1);
    assert.deepEqual(plates[0].anchorNodeIds, group.nodeIds);
  }
  for (const anchors of [{ article: 'x7', nominal: 'y3' }, { article: 'x7', nominal: ['y3', 'z8'], context: 'root' }]) {
    assert.equal(inspect({ relation: 'A novel name', anchors, values: { surfaceToken: 'whole token' } }).plates.length, 0);
  }
});

test('an explicitly realized carrier can associate its contained contributors with one PF plate', () => {
  const realizations = [{ nodeIds: ['root'], tokenIndices: [0] }];
  const r = { ...relation, anchors: { contributors: group.nodeIds, nominal: 'root' } };
  const { dispatch, plates } = inspect(r, realizations);
  assert.equal(plates.length, 1);
  assert.deepEqual(plates[0].anchorNodeIds, ['root', ...group.nodeIds]);
  for (const key of ['contributors', 'nominal']) assert.deepEqual(dispatch.evidenceCoverage.fields.find(f => f.key === key).unrecoveredItemIndices, []);
  for (const anchors of [
    { contributors: group.nodeIds },
    { contributors: group.nodeIds, nominal: 'root', carrier: 'root' },
    { contributors: [...group.nodeIds, 'outside'], nominal: 'root' }
  ]) assert.equal(inspect({ ...relation, anchors }, realizations, [...forest, { id: 'outside', label: 'Z' }]).plates.length, 0);
});

test('independent sibling claims keep their own drawing and the realization plate remains one complete group', () => {
  const r = { ...relation, anchors: { ...relation.anchors, controller: 'q1', controlledSubject: 'x7' } };
  const { dispatch, plates } = inspect(r);
  assert.equal(plates.length, 1);
  assert.deepEqual(plates[0].anchorNodeIds, group.nodeIds);
  assert(dispatch.facets.some(facet => facet.recipe.id === 'control.dependency'));
  for (const name of ['Agree', 'CaseAssignment']) {
    for (const complete of [true, false]) {
      const anchors = name === 'Agree' ? { probe: 'q1', ...(complete ? { goal: 'x7' } : {}) }
        : { assigner: 'q1', ...(complete ? { bearer: 'x7' } : {}) };
      const registered = { relation: name, anchors: { ...anchors, contributors: [...group.nodeIds] },
        values: { surfaceForm: '甲乙丙', ...(name === 'Agree' ? { features: 'plural' } : { case: 'nominative' }) } };
      const result = inspect(registered);
      assert.equal(result.dispatch.primaryClaim.tier, complete ? 1 : 3);
      assert.equal(result.plates.length, 1, JSON.stringify(registered));
      assert.deepEqual(result.plates[0].anchorNodeIds, group.nodeIds);
    }
  }
});


test('named morphology participants with an exact group retain realization literals without a fusion claim', () => {
  const r = { relation: 'An independently chosen label', anchors: { preposition: 'x7', article: 'y3' },
    values: { realization: 'combined spelling', operation: 'No syntactic fusion is asserted.' } };
  const realizations = [{ nodeIds: ['y3', 'x7'], tokenIndices: [0] }];
  const { plates, dispatch } = inspect(r, realizations);
  assert.equal(plates.length, 1);
  assert.deepEqual(plates[0].anchorNodeIds, ['x7', 'y3']);
  assert.deepEqual(plates[0].rows, [{ label: 'realization', value: 'combined spelling' }]);
  assert(!dispatch.facets.some(f => f.recipe.id === 'pf.fusion'));
  assert.deepEqual(dispatch.evidenceCoverage.fields.find(f => f.key === 'operation').unrecoveredItemIndices, [0]);
  for (const groups of [[], [{ nodeIds: ['x7'], tokenIndices: [0] }], [...realizations, ...realizations]]) assert.equal(inspect(r, groups).plates.length, 0);
});

test('an explicitly ordered surface sequence belongs to its entire exact realization group', () => {
  const r = { relation: 'Contextual realization', anchors: { lexicalRoot: 'x7', inflection: 'y3' },
    values: { surfaceSequence: ['甲', '乙', '丙'] } };
  const realizations = [{ nodeIds: ['x7', 'y3'], tokenIndices: [2, 3, 4] }];
  const { plates, dispatch } = inspect(r, realizations);
  assert.equal(plates.length, 1);
  assert.deepEqual(plates[0].anchorNodeIds, ['x7', 'y3']);
  assert.deepEqual(plates[0].rows.map(row => row.value), r.values.surfaceSequence);
  assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === 'surfaceSequence').unrecoveredItemIndices, []);
  for (const groups of [[], [{ ...realizations[0], tokenIndices: [2] }], [{ ...realizations[0], nodeIds: ['x7'] }]]) {
    assert.equal(inspect(r, groups).plates.length, 0);
  }
  for (const values of [{ surfaceSequence: ['甲', '', '丙'] }, { surfaceForm: ['甲', '乙', '丙'] },
    { surfaceSequence: ['甲', '乙', '丙'], surfaceForm: 'competing form' }]) {
    assert.equal(inspect({ ...r, values }, realizations).plates.length, 0);
  }
});

test('an explicitly anchored complete realization group takes precedence over its recognized stem', () => {
  for (const anchors of [{ stem: 'x7', pastSuffix: 'y3' },
    { stem: 'x7', participle: 'y3', agreement: 'z8' }]) {
    const nodeIds = Object.values(anchors), realizations = [{ nodeIds, tokenIndices: [0] }];
    const input = { relation: 'Word realization', anchors, values: { surfaceWord: 'the complete word' } };
    const { plates, dispatch } = inspect(input, realizations);
    assert.equal(plates.length, 1);
    assert.deepEqual(plates[0].anchorNodeIds, nodeIds);
    assert.deepEqual(plates[0].rows, [{ label: 'surfaceWord', value: 'the complete word' }]);
    assert(plates[0].realizationRowKinds.every(kind => kind === 'literal'));
    for (const key of Object.keys(anchors)) {
      assert.deepEqual(dispatch.evidenceCoverage.fields.find(field => field.key === key).unrecoveredItemIndices, []);
    }
    const partial = { ...input, anchors: { stem: 'x7' } };
    assert(!inspect(partial, realizations).plates.some(plate => plate.anchorNodeIds.length === nodeIds.length),
      'an unanchored contributor is never added to the claim');
  }
});

const transferStages = (gap = 1) => {
  const workspaceForest = [{ id: 'r', label: 'XP', children: ['oldA', 'oldB', 'newA', 'newB', 'other']
    .map(id => ({ id, label: 'X', word: id })) }];
  const group = nodeIds => ({ nodeIds, tokenIndices: [0] });
  const before = { statement: 'Before.', stageRecord: 'The old association.', workspaceForest,
    realizations: [group(['oldA', 'oldB'])], relations: [{ relation: 'Initial spelling',
      anchors: { contributors: ['oldA', 'oldB'] }, values: { surfaceForm: 'same word' } }] };
  const after = { ...before, statement: 'After.', realizations: [group(['newA', 'newB'])],
    relations: [{ relation: 'New spelling', anchors: { contributors: ['newA', 'newB'] },
      priorAnchors: { arbitraryWitnesses: ['oldB', 'oldA'] }, values: { surfaceForm: 'same word' } }] };
  return [before, ...Array.from({ length: gap }, () => ({ ...before, relations: [] })), after].map(stage => structuredClone(stage));
};
const pfPlates = items => items.filter(item => item.kind === 'node-plaque' && item.tier2FacetId === 'pf.structured');

test('a complete PF transfer replaces its exact live predecessor at the new moment across stage gaps', () => {
  for (const gap of [0, 1, 3]) for (const splitPrior of [false, true]) {
    const stages = transferStages(gap), last = stages.length - 1;
    if (splitPrior) stages[last].relations[0].priorAnchors = { oldArticle: 'oldA', oldNominal: 'oldB' };
    const original = structuredClone(stages), plan = compileRelationRenderPlan(stages);
    const beforeMoment = pfPlates(visiblePlanFrameItems(plan, last, new Set()));
    assert.equal(beforeMoment.length, 1);
    assert.equal(beforeMoment[0].relationRef.stageIndex, 0);
    const afterMoment = pfPlates(visiblePlanFrameItems(plan, last, new Set([0])));
    assert.equal(afterMoment.length, 1);
    assert.equal(afterMoment[0].relationRef.stageIndex, last);
    assert.equal(pfPlates(visiblePlanFrameItems(plan, last, null)).length, 1);
    const earlier = pfPlates(plan.frames[last].items).find(item => item.relationRef.stageIndex === 0);
    assert.deepEqual([earlier.supersededAt.stageIndex, earlier.supersededAt.relationIndex], [last, 0]);
    assert.equal(pfPlates(plan.frames[0].items)[0].supersededAt, undefined);
    assert(!plan.frames[last].items.some(item => item.kind === 'fallback' && item.relationRef.stageIndex === last),
      'proved prior group witnesses belong to the PF claim, not a second neutral drawing');
    assert.deepEqual(stages, original);
  }
});

test('PF transfer recovery is identical in direct, batch and staged dispatch', () => {
  const stages = transferStages(), current = stages.at(-1), prior = stages.at(-2);
  const input = { stageIndex: 2, relationIndex: 0, relation: current.relations[0],
    currentForest: current.workspaceForest, priorForest: prior.workspaceForest,
    currentRealizations: current.realizations, priorRealizations: prior.realizations };
  const outputs = [dispatchRelationClaims(input), dispatchRelationClaimBatch({ ...input, relations: current.relations })[0].dispatch,
    dispatchStageRelations(stages)[2][0]];
  for (const output of outputs) {
    const facet = output.facets.find(facet => facet.recipe.id === 'pf.structured');
    assert.deepEqual(facet.evaluation.consumedEvidence.find(ref => ref.field === 'priorAnchors'),
      { field: 'priorAnchors', key: 'arbitraryWitnesses' });
    assert.deepEqual(JSON.parse(facet.facetIdentity).priorAnchors['rewrite.output'].map(node => node.id), ['oldB', 'oldA']);
  }
});

test('incomplete or unrelated PF witnesses do not retire independent history', () => {
  const mutations = [
    stages => { delete stages.at(-1).relations[0].priorAnchors; },
    stages => { stages.at(-1).relations[0].priorAnchors = { partial: ['oldA'] }; },
    stages => { stages.at(-1).relations[0].priorAnchors = { repeated: ['oldA', 'oldA'] }; },
    stages => { stages.at(-1).relations[0].priorAnchors = { extra: ['oldA', 'oldB', 'other'] }; },
    stages => { stages.at(-1).relations[0].priorAnchors = { unresolved: ['oldA', 'missing'] }; },
    stages => { stages.at(-1).realizations[0].tokenIndices = [1]; },
    stages => { stages[1].realizations = []; },
    stages => { stages[1].realizations.push({ nodeIds: ['other'], tokenIndices: [0] }); },
    stages => { stages[1].workspaceForest[0].children.push({ id: 'oldA', label: 'X' }); },
    stages => { stages[0].relations.push({ ...structuredClone(stages[0].relations[0]), values: { surfaceForm: 'competing word' } }); }
  ];
  for (const mutate of mutations) {
    const stages = transferStages(); mutate(stages);
    const plan = compileRelationRenderPlan(stages), old = pfPlates(plan.frames.at(-1).items)
      .filter(item => item.relationRef.stageIndex === 0);
    assert(old.length > 0);
    assert(old.every(item => item.supersededAt === undefined), String(mutate));
    assert(pfPlates(visiblePlanFrameItems(plan, 2, null)).some(item => item.relationRef.stageIndex === 0));
  }
});

test('a later exact PF transfer can continue an already replaced group without reviving the first plate', () => {
  const stages = transferStages();
  stages.push(structuredClone(stages[0]));
  stages[3].relations[0].priorAnchors = { exactPrior: ['newA', 'newB'] };
  const plan = compileRelationRenderPlan(stages);
  assert.deepEqual(pfPlates(visiblePlanFrameItems(plan, 3, null)).map(item => item.relationRef.stageIndex), [3]);
  assert.deepEqual(pfPlates(visiblePlanFrameItems(plan, 3, new Set())).map(item => item.relationRef.stageIndex), [2]);
});
