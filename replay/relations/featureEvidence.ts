import { isUnestablishedOutcomeLiteral, normalizeOutcomeLiteral } from './outcomeResolver.ts';
import type { Tier2FacetEvidence } from './tier2FacetTypes.ts';
import { buildTier2SynonymIndex, claimDeniesOrWithholds, normalizeTier2Synonym, relationRoleConcepts } from './tier2Synonyms.ts';

const synonyms = buildTier2SynonymIndex();

/** An unvalued or pending Case state supplies no assigned Case value. A Case
 * value is established only if a value token remains once the Case feature's
 * name ("Case", "uCase", "Case value"), brackets, separators and placeholders
 * ("_", "?", "-", "—", "∅") and state words are removed: words that only state
 * valuation ("valued", "is still"), "unvalued", and words that deny or withhold
 * (claimDeniesOrWithholds: "none", "pending", "not"). A state phrase that names
 * an unestablished outcome ("not determined") is no value either. Words that
 * qualify a remaining value stay with it, and unfamiliar Case names stay literal. */
export function isUnestablishedCaseValue(literal: string): boolean {
  const words = normalizeOutcomeLiteral(literal).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const stated = (word: string) => /^(?:[ui]?case|value|valued|assigned|licensed|is|still|currently|yet)$/u.test(word);
  // A prefix written apart ("u-Case") joins its feature name.
  const state = words.filter((word, index) => !stated(word) && !(index + 1 < words.length && stated(word + words[index + 1])));
  if (isUnestablishedOutcomeLiteral(state.join(' '))) return true;
  return !state.some(word => !/^unvalued$/u.test(word) && !claimDeniesOrWithholds(undefined, word));
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
