import { isUnestablishedOutcomeLiteral, normalizeOutcomeLiteral } from './outcomeResolver.ts';
import type { Tier2FacetEvidence } from './tier2FacetTypes.ts';
import { buildTier2SynonymIndex, claimDeniesOrWithholds, normalizeTier2Synonym, relationRoleConcepts } from './tier2Synonyms.ts';

const synonyms = buildTier2SynonymIndex();

/** Babel does not parse prose (lead decision, 30 Oct 2026). A Case value
 * establishes a Case only if it holds a value token, once the Case feature's
 * name ("Case", "uCase", "Case value") and words that only state valuation
 * ("valued", "is still") are set aside, and nothing in it states that the Case
 * is unset or denied: no placeholder ("_", "?", "∅", a lone dash), no
 * "unvalued", no deny-or-withhold word of #296 (claimDeniesOrWithholds:
 * "not", "no", "pending", "without") and no unestablished outcome
 * ("undetermined"). Any of these anywhere leaves the row on its plaque with no
 * Case path, even beside a Case name ("no nominative Case"). Unfamiliar Case
 * names stay literal. */
export function isUnestablishedCaseValue(literal: string): boolean {
  const written = String(literal ?? '').normalize('NFKC');
  if (/[_?∅]/u.test(written) || written.split(/[\s,;:=()[\]{}]+/u).some(chunk => /^[-–—]+$/u.test(chunk))) return true;
  const words = normalizeOutcomeLiteral(written).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.some(word => /^unvalued$/u.test(word) || claimDeniesOrWithholds(undefined, word) || isUnestablishedOutcomeLiteral(word))) return true;
  const stated = (word: string) => /^(?:[ui]?case|value|valued|assigned|licensed|is|still|currently|yet)$/u.test(word);
  // A prefix written apart ("u-Case") joins its feature name.
  const value = words.filter((word, index) => !stated(word) && !(index + 1 < words.length && stated(word + words[index + 1])));
  return !value.length || isUnestablishedOutcomeLiteral(value.join(' '));
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
