import assert from 'node:assert/strict';
import test from 'node:test';
import { __test__ as parser } from '../server/babelParser.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { visiblePlanFrameItems, planItemRelationRefs } from '../replay/relations/renderPlanCompiler.ts';
import { TIER2_FACET_RECIPES } from '../replay/relations/tier2FacetRecipes.ts';
import { buildPublicFacetFixture } from './helpers/tier2PublicFixtures.mjs';

const movement = TIER2_FACET_RECIPES.find(recipe => recipe.id === 'movement.path');
for (const framework of ['xbar', 'minimalism']) for (const [name, options, kind] of [
  ['curve', {}, 'phrasal'], ['orthogonal', { movementRoute: 'orthogonal' }, 'roll-up'],
  ['cross-workspace', { crossWorkspace: true }, 'sideward']
]) {
  test(`${framework} ${name}: accepted movement outcomes retain their exact anchors and owning Replay moment`, () => {
    for (const outcome of movement.acceptedOutcomeConcepts) {
      const { sentence, derivationStages, relationStageIndex } = buildPublicFacetFixture(movement, options);
      const relation = derivationStages[relationStageIndex].relations[0];
      relation.values.outcome = outcome;
      const original = structuredClone(derivationStages);
      const bundle = parser.normalizeParseBundle({ derivationStages }, framework, sentence, 'grok', true);
      const replay = prepareReplay({ sentence, inputTokens: bundle.inputTokens, derivationStages: bundle.analyses[0].derivationStages, includePlayback: true });
      const moment = replay.playbackSteps.find(step => step.replayRelationIdentity?.stageIndex === relationStageIndex && step.replayRelationIdentity.relationIndex === 0);
      assert(moment, outcome);
      const items = visiblePlanFrameItems(replay.relationRenderPlan, relationStageIndex, new Set([0]), 0);
      const trajectories = items.filter(item => item.kind === 'trajectory');
      assert.equal(trajectories.length, 1, outcome);
      const path = trajectories[0];
      assert.equal(path.trajectoryKind, kind);
      assert.equal(path.outcome, ['licensed', 'successful', 'allowed', 'accepted', 'valid'].includes(outcome) ? 'licensed' : 'blocked');
      assert.deepEqual(path.relationRef.anchors, relation.anchors);
      assert.deepEqual(path.relationRef.values, relation.values);
      assert(!visiblePlanFrameItems(replay.relationRenderPlan, relationStageIndex, new Set()).some(item => item.kind === 'trajectory'), 'future path cannot appear early');
      const visible = new Set(moment.replayVisibleNodeIds);
      const binding = bindRelationPlanFrame(replay.relationRenderPlan, relationStageIndex, id => visible.has(id) ? { x: [...id].reduce((n,c)=>n+c.charCodeAt(0),0), y: id.length * 31 } : null);
      assert.deepEqual(binding.failed, [], outcome);
      assert(binding.primitives.some(item => item.type === 'trajectory-path'), outcome);
      assert.deepEqual(derivationStages, original);
    }
  });
  test(`${framework} ${name}: pending, absent and competing outcomes cannot acquire an asserted path`, () => {
    for (const outcome of ['pending', 'absent', 'not established', ['licensed', 'blocked']]) {
      const { sentence, derivationStages, relationStageIndex } = buildPublicFacetFixture(movement, options);
      derivationStages[relationStageIndex].relations[0].values.outcome = outcome;
      const replay = prepareReplay({ sentence, derivationStages, includePlayback: true });
      const items = visiblePlanFrameItems(replay.relationRenderPlan, relationStageIndex, new Set([0]), 0);
      assert(!items.some(item => item.kind === 'trajectory'), JSON.stringify(outcome));
      assert(items.some(item => item.kind === 'fallback'), 'the authored claim remains inspectable');
    }
  });
  test(`${framework} ${name}: an unfamiliar outcome stays literal and acquires no success/failure style`, () => {
    const { sentence, derivationStages, relationStageIndex } = buildPublicFacetFixture(movement, options);
    derivationStages[relationStageIndex].relations[0].values.outcome = 'author-specific assessment';
    const replay = prepareReplay({ sentence, derivationStages, includePlayback: true });
    const items = visiblePlanFrameItems(replay.relationRenderPlan, relationStageIndex, new Set([0]), 0);
    assert(items.some(item => item.kind === 'fallback'));
    assert(items.filter(item => item.kind === 'trajectory').every(item => item.outcome === undefined));
    assert(items.some(item => planItemRelationRefs(item).some(ref => ref.values?.outcome === 'author-specific assessment')));
  });
}
