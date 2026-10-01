import assert from 'node:assert/strict';
import test from 'node:test';
import { TIER2_FACET_RECIPES } from '../replay/relations/tier2FacetRecipes.ts';
import { compileRelationRenderPlan, planItemRelationRefs, visiblePlanFrameItems } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { buildPublicFacetFixture } from './helpers/tier2PublicFixtures.mjs';

const asArray = value => Array.isArray(value) ? value : [value];
const withoutOccurrence = (forest, id) => forest
  .filter(node => node.id !== id)
  .map(node => ({ ...node, children: withoutOccurrence(node.children || [], id) }));
const point = id => ({ x: [...id].reduce((total, char) => total + char.codePointAt(0), 0), y: id.length * 31 });

test('every primary Tier-2 family retains unchanged witnesses and expires on each missing required current witness', () => {
  for (const recipe of TIER2_FACET_RECIPES.filter(recipe => recipe.kind === 'claim')) {
    const fixture = buildPublicFacetFixture(recipe);
    const authored = structuredClone(fixture.derivationStages);
    const current = fixture.derivationStages[fixture.relationStageIndex];
    for (const requirement of recipe.anchors.filter(anchor => !anchor.optional && anchor.source !== 'prior')) {
      const id = asArray(fixture.fixture.relation.anchors[requirement.role])[0];
      const stages = [...fixture.derivationStages,
        { statement: 'The current witnesses remain.', stageRecord: 'The claim has no new authored moment.',
          workspaceForest: current.workspaceForest, relations: [] },
        { statement: 'One current witness is absent.', stageRecord: 'The old drawing no longer has its exact required occurrence.',
          workspaceForest: withoutOccurrence(current.workspaceForest, id), relations: [] }];
      const plan = compileRelationRenderPlan(stages);
      const own = frame => frame.items.filter(item => item.tier2FacetId === recipe.id);
      const context = `${recipe.id}: ${requirement.role}`;
      assert(own(plan.frames[fixture.relationStageIndex]).length, `${context}: missing initial drawing`);
      assert(own(plan.frames.at(-2)).length, `${context}: unchanged witnesses lost their drawing`);
      assert.deepEqual(own(plan.frames.at(-1)), [], `${context}: drawing survived a missing exact witness`);
    }
    assert.deepEqual(fixture.derivationStages, authored, `${recipe.id}: compilation changed the authored states`);
  }
});

test('every accepted Tier-2 outcome survives public fixture lowering and retains its literal, anchors and owning moment', () => {
  for (const recipe of TIER2_FACET_RECIPES.filter(recipe => recipe.acceptedOutcomeConcepts.length)) {
    for (const outcome of recipe.acceptedOutcomeConcepts) {
      const fixture = buildPublicFacetFixture(recipe);
      const stageIndex = fixture.relationStageIndex;
      const relation = fixture.derivationStages[stageIndex].relations[0];
      relation.values = { ...relation.values, outcome };
      const authored = structuredClone(fixture.derivationStages);
      const plan = compileRelationRenderPlan(fixture.derivationStages);
      const items = plan.frames[stageIndex].items.filter(item => item.tier2FacetId === recipe.id);
      const context = `${recipe.id}: ${outcome}`;
      assert(items.length, `${context}: an accepted outcome suppressed the family`);
      for (const item of items) {
        assert(planItemRelationRefs(item).some(ref => ref.stageIndex === stageIndex && ref.relationIndex === 0
          && ref.values?.outcome === outcome), `${context}: original outcome or owner was lost`);
      }
      const ownedBefore = visiblePlanFrameItems(plan, stageIndex, new Set())
        .filter(item => item.tier2FacetId === recipe.id);
      assert.deepEqual(ownedBefore, [], `${context}: drawing appeared before the owning moment`);
      const visibleAtMoment = visiblePlanFrameItems(plan, stageIndex, new Set([0]), 0);
      assert(visibleAtMoment.some(item => item.tier2FacetId === recipe.id), `${context}: owning moment lost the drawing`);
      const bound = bindRelationPlanFrame(plan, stageIndex, point);
      assert.deepEqual(bound.failed, [], `${context}: lowering requires an unavailable endpoint`);
      assert(bound.primitives.some(primitive => items.includes(plan.frames[stageIndex].items[primitive.itemIndex])),
        `${context}: accepted outcome bound no production primitive`);
      assert.deepEqual(fixture.derivationStages, authored, `${context}: lowering changed the authored outcome`);
    }
  }
});
