import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { buildTier2SynonymIndex, relationRoleConcepts } from './tier2Synonyms.ts';

const synonyms = buildTier2SynonymIndex();

/** Agreement-host inference does not establish Case direction. Scoped claims
 * have already bound their participants independently; unscoped mixed claims
 * must still establish both Case endpoints without the feature-row evidence. */
export function hasIndependentCaseEndpoints(evidence: Tier2FacetEvidence): boolean {
  if (!evidence.authoredCurrentAnchors || evidence.associatedAnchorKeys) return true;
  const context = {
    relation: evidence.relationName, forest: evidence.currentForest,
    anchors: Object.fromEntries(evidence.authoredCurrentAnchors.map(entry => [entry.key, entry.items])),
    values: Object.fromEntries((evidence.authoredValues ?? []).filter(entry => !entry.concepts.includes('feature.rows'))
      .map(entry => [entry.key, entry.items]))
  };
  return ['feature.source', 'feature.target'].every(role => {
    const proven = evidence.authoredCurrentAnchors!.filter(entry => relationRoleConcepts(synonyms, entry.key, context).includes(role))
      .flatMap(entry => entry.items);
    return (evidence.currentAnchors[role] ?? []).every(id => proven.includes(id));
  });
}
