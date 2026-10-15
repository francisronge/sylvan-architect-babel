import { normalizeParseBundle } from '../../server/babelParser/parseNormalization.js';
import { prepareReplay } from '../../replay/prepareReplay.ts';
import { TIER2_FACET_RECIPES } from '../../replay/relations/tier2FacetRecipes.ts';
import { buildPublicFacetFixture } from './tier2PublicFixtures.mjs';

export function blockedOutcomeFixtures() {
  const movement = TIER2_FACET_RECIPES.find(recipe => recipe.id === 'movement.path');
  return ['xbar', 'minimalism'].flatMap(framework => [
    ['curve', {}], ['orthogonal', { movementRoute: 'orthogonal' }], ['cross-workspace', { crossWorkspace: true }]
  ].map(([route, options]) => {
    const fixture = buildPublicFacetFixture(movement, options);
    fixture.derivationStages[fixture.relationStageIndex].relations[0].values.outcome = 'blocked';
    const bundle = normalizeParseBundle({ derivationStages: fixture.derivationStages }, framework, fixture.sentence, 'grok', true);
    const steps = prepareReplay({ sentence: fixture.sentence, inputTokens: bundle.inputTokens,
      derivationStages: bundle.analyses[0].derivationStages, includePlayback: true }).playbackSteps;
    const moment = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === fixture.relationStageIndex
      && step.replayRelationIdentity?.relationIndex === 0);
    if (moment < 1) throw new Error(`Missing blocked movement moment for ${framework}/${route}`);
    const relation = fixture.derivationStages[fixture.relationStageIndex].relations[0];
    return { id: `${framework}-${route}`, framework, route, bundle, moment, final: steps.length - 1,
      owner: `${fixture.relationStageIndex}:0`, from: relation.anchors['movement.source'], to: relation.anchors['movement.landing'],
      kind: { curve: 'phrasal', orthogonal: 'roll-up', 'cross-workspace': 'sideward' }[route] };
  }));
}
