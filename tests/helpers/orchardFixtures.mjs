import assert from 'node:assert/strict';
import * as cards from '../../docs/design/visual-relations-lab-cards.ts';

// The Orchard's cards, its archived archetype codes and every exported tree by
// name, read from the lab's card data module.
export const loadOrchardFixtures = async () => {
  assert.ok(Array.isArray(cards.rawCases), 'the Orchard must export executable fixtures');
  const trees = new Map(Object.entries(cards)
    .filter(([, value]) => value && typeof value === 'object' && typeof value.id === 'string' && typeof value.label === 'string'));
  assert.ok(trees.size > 30, `expected executable Orchard trees, got ${trees.size}`);
  return { rawCases: cards.rawCases, archivedExampleArchetypes: cards.archivedExampleArchetypes, trees };
};
