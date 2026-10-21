/** Specimens for tests/browser/tier2ProductionRecipes.test.mjs, and the subset
 * the browser paints; tests/tier2ProductionSpecimens.test.mjs checks the subset
 * provider-free. */
import assert from 'node:assert/strict';
import { normalizeParseBundle } from '../../server/babelParser/parseNormalization.js';
import { prepareReplay } from '../../replay/prepareReplay.ts';
import { compileRelationRenderPlan } from '../../replay/relations/renderPlanCompiler.ts';
import { TIER2_FACET_RECIPES } from '../../replay/relations/tier2FacetRecipes.ts';
import { buildPublicFacetFixture } from './tier2PublicFixtures.mjs';
import { productionDomChecks } from './tier2ProductionExpectations.mjs';

/** Every public recipe, plus the two movement route variants, in each framework. */
export function buildSpecimens() {
  const movement = TIER2_FACET_RECIPES.find(recipe => recipe.id === 'movement.path');
  const examples = [...TIER2_FACET_RECIPES.map(recipe => ({ recipe, options: {}, variant: 'default' })),
    { recipe: movement, options: { movementRoute: 'orthogonal' }, variant: 'orthogonal' },
    { recipe: movement, options: { crossWorkspace: true }, variant: 'cross-workspace' }];
  return ['xbar', 'minimalism'].flatMap(framework => examples.map(({ recipe, options, variant }) => {
    const { sentence, derivationStages, relationStageIndex } = buildPublicFacetFixture(recipe, options);
    const bundle = normalizeParseBundle({ derivationStages }, framework, sentence, 'grok', true);
    const analysis = bundle.analyses[0], activeLens = recipe.id === 'presentation.lens';
    const replay = prepareReplay({ sentence, inputTokens: bundle.inputTokens, derivationStages: analysis.derivationStages, includePlayback: true });
    const plan = activeLens ? compileRelationRenderPlan(analysis.derivationStages, { activeLens: true }) : replay.relationRenderPlan;
    const ownedItems = plan.frames[relationStageIndex].items.flatMap((item, index) => item.tier2FacetId === recipe.id ? [{ index, item }] : []);
    const frameIndex = replay.playbackSteps.findIndex(step => step.replayRelationIdentity?.stageIndex === relationStageIndex && step.replayRelationIdentity.relationIndex === 0);
    assert(frameIndex >= 0, `${recipe.id}: missing owning moment`);
    return { id: `recipe-${framework}-${recipe.id.replaceAll('.', '-')}${variant === 'default' ? '' : `-${variant}`}`,
      recipe: recipe.id, framework, variant, sentence, bundle, relationStageIndex, relationIndex: 0, frameIndex,
      activeLens, expectedPrimitives: [...new Set(ownedItems.flatMap(({ item }) => item.tier2OutputPieces || []))],
      productionDomChecks: productionDomChecks(recipe.id, variant, ownedItems) };
  }));
}

/** The address the spec's dev server serves a specimen's page from. */
export const specimenFile = specimen => `__tier2_fixture__?id=${encodeURIComponent(specimen.id)}`;

/* Everything a specimen gives the page and the checks, apart from its name, the
 * page address built from that name, its framework label and the analysis
 * provenance. The page renders the sentence, input tokens, derivation stages and
 * final forest; provenance never reaches TreeVisualizer
 * (tests/helpers/tier2ProductionEntry.tsx). */
const renderedContent = ({ id, file, framework, bundle, ...specimen }) => JSON.stringify({ ...specimen,
  bundle: { ...bundle, analyses: bundle.analyses.map(({ provenance, ...analysis }) => analysis) } });

/** Every specimen is built and compared. A Minimalism specimen whose rendered
 * content equals its X-bar twin's is painted by that twin, so the browser paints
 * X-bar always and Minimalism only where the framework changes what is drawn. */
export function selectPaintedSpecimens(specimens) {
  const xbar = new Map(specimens.filter(specimen => specimen.framework === 'xbar')
    .map(specimen => [`${specimen.recipe} ${specimen.variant}`, renderedContent(specimen)]));
  const coveredByXbar = specimens.filter(specimen => specimen.framework !== 'xbar'
    && xbar.get(`${specimen.recipe} ${specimen.variant}`) === renderedContent(specimen)).map(specimen => specimen.id);
  const covered = new Set(coveredByXbar);
  return { painted: specimens.filter(specimen => !covered.has(specimen.id)), coveredByXbar };
}
