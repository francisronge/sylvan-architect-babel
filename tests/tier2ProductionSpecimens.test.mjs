import assert from 'node:assert/strict';
import test from 'node:test';
import { TIER2_FACET_RECIPES } from '../replay/relations/tier2FacetRecipes.ts';
import { buildSpecimens, selectPaintedSpecimens, specimenFile } from './helpers/tier2ProductionSpecimens.mjs';

// The specimens as tests/browser/tier2ProductionRecipes.test.mjs serves them.
const served = () => buildSpecimens().map(specimen => ({ ...specimen, file: specimenFile(specimen) }));

test('the production Tier 2 spec paints every X-bar specimen, and X-bar covers every committed Minimalism specimen', () => {
  const specimens = served(), { painted, coveredByXbar } = selectPaintedSpecimens(specimens);
  assert.equal(specimens.length, 2 * (TIER2_FACET_RECIPES.length + 2));
  assert.deepEqual(painted.map(specimen => specimen.id), specimens.filter(specimen => specimen.framework === 'xbar').map(specimen => specimen.id));
  assert.deepEqual(coveredByXbar, specimens.filter(specimen => specimen.framework === 'minimalism').map(specimen => specimen.id));
});

test('a Minimalism specimen that draws anything differently from X-bar is painted', () => {
  const specimens = served(), changed = specimens.find(specimen => specimen.framework === 'minimalism'
    && specimen.recipe === 'identity.occurrences' && specimen.variant === 'default');
  changed.bundle.analyses[0].derivationStages.at(-1).statement += ' Changed.';
  const { painted, coveredByXbar } = selectPaintedSpecimens(specimens);
  assert.deepEqual(painted.filter(specimen => specimen.framework === 'minimalism').map(specimen => specimen.id), [changed.id]);
  assert.equal(coveredByXbar.length, TIER2_FACET_RECIPES.length + 1);
});
