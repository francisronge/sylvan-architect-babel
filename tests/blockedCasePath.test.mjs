import assert from 'node:assert/strict';
import test from 'node:test';
import { __test__ as parser } from '../server/babelParser.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { TIER2_FACET_RECIPES } from '../replay/relations/tier2FacetRecipes.ts';
import { buildPublicFacetFixture } from './helpers/tier2PublicFixtures.mjs';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { visiblePlanFrameItems } from '../replay/relations/renderPlanCompiler.ts';

const recipe = TIER2_FACET_RECIPES.find(recipe => recipe.id === 'feature.dependency');
const point = id => ({ x: id.length * 17, y: [...id].reduce((total, character) => total + character.codePointAt(0), 0) });

for (const framework of ['xbar', 'minimalism']) {
  test(`${framework}: failed Case retains its literal and owning moment without a successful assignment arrow`, () => {
    for (const outcome of ['licensed', 'blocked', 'failed', 'unlicensed']) {
      const fixture = buildPublicFacetFixture(recipe);
      const relation = fixture.derivationStages[fixture.relationStageIndex].relations[0];
      delete relation.values['feature.rows'];
      relation.values = { ...relation.values, 'case.literal': 'nominative', outcome };
      const original = structuredClone(fixture.derivationStages);
      const bundle = parser.normalizeParseBundle({ derivationStages: fixture.derivationStages }, framework,
        fixture.sentence, 'grok', true);
      const replay = prepareReplay({ sentence: fixture.sentence, inputTokens: bundle.inputTokens,
        derivationStages: bundle.analyses[0].derivationStages, includePlayback: true });
      const frame = replay.relationRenderPlan.frames[fixture.relationStageIndex];
      const assignment = frame.items.find(item => item.pathStyle === 'case-assignment');
      assert(assignment, outcome);
      assert.equal(assignment.label, 'nominative');
      assert.equal(assignment.relationRef.values.outcome, outcome);
      assert(!visiblePlanFrameItems(replay.relationRenderPlan, fixture.relationStageIndex, new Set())
        .some(item => item.pathStyle === 'case-assignment'), 'Case appears only at its authored moment');
      const bound = bindRelationPlanFrame(replay.relationRenderPlan, fixture.relationStageIndex, point);
      const path = bound.primitives.find(primitive => primitive.shapeStyle === 'case-assignment');
      assert(path, outcome);
      assert.equal(path.stroke, 'solid', 'the native Case curve remains a solid Case curve');
      assert.equal(path.arrowhead, outcome === 'licensed');
      assert.equal(path.blocked === true, outcome !== 'licensed');
      assert.equal(path.tip?.kind, outcome === 'licensed' ? undefined : 'cross');
      assert.deepEqual(bound.failed, []);
      assert.deepEqual(fixture.derivationStages, original);
    }
  });
}
