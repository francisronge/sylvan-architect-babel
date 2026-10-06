import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { buildTier2SynonymIndex, normalizeTier2Synonym, relationRoleConcepts } from './tier2Synonyms.ts';
import { isUnestablishedOutcomeLiteral, normalizeOutcomeLiteral } from './outcomeResolver.ts';

const synonyms = buildTier2SynonymIndex();

/** An unvalued or pending Case state supplies no assigned Case value. Match
 * complete state expressions only; unfamiliar Case names remain literal. */
export function isUnestablishedCaseValue(literal: string): boolean {
  const state = normalizeOutcomeLiteral(literal)
    .replace(/^(?:case(?: value)? (?:is )?)?(?:(?:still|currently) )?/u, '');
  return isUnestablishedOutcomeLiteral(state)
    || /^(?:unvalued|unassigned|not (?:yet )?(?:valued|assigned|licensed))$/u.test(state);
}

/** Agreement-host inference and movement endpoints do not establish Case
 * direction. Scoped claims have already bound their participants independently;
 * other claims must prove both Case endpoints without feature-row inference. */
export function hasIndependentCaseEndpoints(evidence: Tier2FacetEvidence): boolean {
  if (!evidence.authoredCurrentAnchors || evidence.associatedAnchorKeys) return true;
  const movementFields = new Set(Object.keys(evidence.movement?.roles ?? {}));
  const context = {
    relation: evidence.relationName, forest: evidence.currentForest,
    anchors: Object.fromEntries(evidence.authoredCurrentAnchors.map(entry => [entry.key, entry.items])),
    values: {
      ...Object.fromEntries((evidence.authoredValues ?? []).filter(entry => !entry.concepts.includes('feature.rows'))
        .map(entry => [entry.key, entry.items.length === 1 ? entry.items[0] : entry.items])),
      // A proved assignment label can supply Case without an authored value field.
      ...(!evidence.authoredValues?.some(entry => entry.concepts.includes('case.literal'))
        && evidence.values['case.literal']?.length ? { 'case.literal': evidence.values['case.literal'] } : {})
    }
  };
  return ['feature.source', 'feature.target'].every(role => {
    const proven = evidence.authoredCurrentAnchors!.filter(entry =>
      !(movementFields.has(normalizeTier2Synonym(entry.key)) && ['source', 'target'].includes(normalizeTier2Synonym(entry.key)))
      && relationRoleConcepts(synonyms, entry.key, context).includes(role))
      .flatMap(entry => entry.items);
    return (evidence.currentAnchors[role] ?? []).every(id => proven.includes(id));
  });
}
