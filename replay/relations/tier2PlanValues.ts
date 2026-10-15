import { extractMovementIndex, isTraceLike } from '../replaySurfaceNotation.ts';
import type { Tier2ResolvedFacet } from './relationClaims.ts';
import type { Tier2FacetEvidence } from './tier2FacetTypes.ts';

export const flatten = (value: readonly string[] | string | undefined): string[] => (
  (value === undefined ? [] : Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? ''))
);

export const gapBadgeText = (surface: string, index?: string): string => {
  if (!index?.trim()) return surface;
  // The index can already be carried by a trace inside a category annotation.
  const authored = [surface, ...Array.from(surface.matchAll(/\[([^\[\]]+)\]/gu), match => match[1])
    .filter(isTraceLike)].map(extractMovementIndex);
  return authored.includes(index.trim().toLowerCase()) ? surface : `${surface}_${index}`;
};

export const unique = (items: readonly string[]): string[] => (
  items.filter((item, index) => items.indexOf(item) === index)
);

export const currentIds = (evidence: Tier2FacetEvidence, role: string): string[] => (
  flatten(evidence.currentAnchors[role])
);

export const valueItems = (evidence: Tier2FacetEvidence, name: string): string[] => (
  flatten(evidence.values[name])
);

export const singleValue = (evidence: Tier2FacetEvidence, name: string, fallback = ''): string => {
  const items = valueItems(evidence, name);
  return items.length === 1 ? items[0] : fallback;
};

export const authoredRows = (evidence: Tier2FacetEvidence): Array<{ label: string; value: string }> => (
  (evidence.authoredValues || []).flatMap(({ key, items }) =>
    items.map((value) => ({ label: key, value })))
);

/** Only explicitly interpreted feature rows earn a collection connector. */
export const featureDependencyRows = (
  evidence: Tier2FacetEvidence,
  rows = authoredRows(evidence)
): Array<{ label: string; value: string }> => [...new Map(rows.filter(row =>
  evidence.authoredValues?.some(entry => entry.key === row.label && entry.concepts.includes('feature.rows')))
  .map(row => [JSON.stringify(row), row])).values()];

export const outcomeState = (
  facet: Tier2ResolvedFacet
): 'licensed' | 'blocked' | 'failed' | undefined => {
  const concept = facet.evaluation.outcomeConcept;
  if (!concept) return undefined;
  if (['licensed', 'successful', 'allowed', 'accepted', 'valid'].includes(concept)) {
    return 'licensed';
  }
  return facet.recipe.id === 'binding.dependency' ? 'failed' : 'blocked';
};
