import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { dispatchStageRelations } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan, planItemRelationRefs, visiblePlanFrameItems } from '../replay/relations/renderPlanCompiler.ts';

const saved = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/clause-context.json', import.meta.url)))
  .cases.find(record => record.name === 'archive-english-raising-xbar-astra-0');
const isMiaGap = item => item.badgeStyle === 'gap-notation'
  && item.badges.some(badge => badge.nodeId === 'miaTrace');
const gapItems = plan => plan.frames[1].items.filter(isMiaGap);
const gapFacet = dispatch => dispatch.facets.find(facet => facet.recipe.id === 'gap.notation');

test('unproved prior clause context cannot split an identical current gap drawing', () => {
  const stages = structuredClone(saved.derivationStages), original = structuredClone(stages);
  const dispatches = dispatchStageRelations(stages), movement = dispatches[1][0];
  assert.deepEqual(movement.evidence.priorAnchors['movement.landing'], []);
  assert(movement.claims.some(claim => claim.tier === 3 && claim.consumedEvidence.some(ref =>
    ref.field === 'priorAnchors' && ref.key === 'targetClause')));
  assert.deepEqual(gapFacet(movement).outputIdentities, gapFacet(dispatches[1][3]).outputIdentities);

  const plan = compileRelationRenderPlan(stages), gaps = gapItems(plan);
  assert.equal(gaps.length, 1);
  assert.deepEqual(planItemRelationRefs(gaps[0]).map(ref => ref.relationIndex), [0, 3]);
  for (const relationIndex of [0, 1, 2, 3]) {
    const played = new Set(Array.from({ length: relationIndex + 1 }, (_, index) => index));
    assert.equal(visiblePlanFrameItems(plan, 1, played, relationIndex).filter(isMiaGap).length, 1);
  }
  assert.deepEqual(stages, original);
});

test('an exact proved prior landing keeps its temporal ownership and distinct output identity', () => {
  const stages = structuredClone(saved.derivationStages);
  delete stages[1].relations[0].priorAnchors.targetClause;
  stages[1].relations[0].priorAnchors.landing = 'miaNP';
  const original = structuredClone(stages), dispatches = dispatchStageRelations(stages), movement = dispatches[1][0];
  assert.deepEqual(movement.evidence.priorAnchors['movement.landing'], ['miaNP']);
  assert(movement.facets.find(facet => facet.recipe.id === 'movement.path').evaluation.consumedEvidence.some(ref =>
    ref.field === 'priorAnchors' && ref.key === 'landing'));
  assert.notDeepEqual(gapFacet(movement).outputIdentities, gapFacet(dispatches[1][3]).outputIdentities);
  assert.equal(gapItems(compileRelationRenderPlan(stages)).length, 2);
  assert.deepEqual(stages, original);
});

test('a proved prior moved occurrence retains ownership when it names the preceding source', () => {
  const subject = { id: 'low', label: 'DP', lineageId: 'chain', children: [{ id: 'nameLow', label: 'N', word: 'Mia' }] };
  const verb = { id: 'verb', label: 'V', word: 'left' };
  const prior = [{ id: 'base', label: 'VP', children: [subject, verb] }];
  const current = [{ id: 'ip', label: 'IP', children: [
    { id: 'high', label: 'DP', lineageId: 'chain', children: [{ id: 'nameHigh', label: 'N', word: 'Mia' }] },
    { id: 'base', label: 'VP', children: [{ ...subject, silent: true }, verb] }
  ] }];
  const relation = { relation: 'Subject displacement', anchors: { source: 'low', target: 'high' },
    priorAnchors: { movedOccurrence: 'low' } };
  const stage = (workspaceForest, relations = []) => ({ statement: 'State', stageRecord: 'Record', workspaceForest, relations });
  const stages = [stage(prior), stage(current, [relation])], original = structuredClone(stages);
  const dispatch = dispatchStageRelations(stages)[1][0];
  assert.equal(dispatch.evidence.movement.targetNodeId, 'high');
  assert.deepEqual(dispatch.evidence.movement.priorAnchorKeys, ['movedOccurrence']);
  assert.deepEqual(dispatch.evidence.priorAnchors['movement.landing'], ['low']);
  assert(dispatch.facets.find(facet => facet.recipe.id === 'movement.path').evaluation.consumedEvidence.some(ref =>
    ref.field === 'priorAnchors' && ref.key === 'movedOccurrence'));
  assert.deepEqual(stages, original);
});
