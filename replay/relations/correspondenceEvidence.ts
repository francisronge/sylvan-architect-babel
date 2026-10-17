import type { SyntaxNode } from '../../types.ts';
import { scopeEvidence, uniqueCurrentOwners } from './evidenceScopes.ts';
import { establishesAssignment } from './outcomeResolver.ts';
import type { Tier2FacetEvidence } from './tier2FacetTypes.ts';
import { isExplicitTier2Role, normalizeTier2Synonym, relationLabelClauses } from './tier2Synonyms.ts';

const correspondenceClaim = /^(?:(?:vp|np|dp|pp|cp|tp|ip|phrasal|predicate|verbal|nominal|right node raising|pf|gapping) )*(?:ellipsis|deletion|correspondence)(?: (?:licensing|antecedence|identity|alignment|structural identity))?$/u;
const antecedentRole = /^(?:antecedent(?: (?:[a-z]+p|domain|phrase|constituent))?|(?:overt )?identity source)$/u;
const indexRows = (evidence: Tier2FacetEvidence) => (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('index'));

/** A named antecedent and elided domain supply one exact correspondence.
 * Silence still belongs to the separate ellipsis recipe; this link does not
 * infer deletion, a licensing arrow, or pair independently ordered lists. */
export function recoverEllipsisCorrespondence(evidence: Tier2FacetEvidence) {
  const clauses = relationLabelClauses(evidence.relationName)
    .filter(clause => /\b(?:ellipsis|deletion|correspondence)\b/u.test(clause));
  if (!clauses.length || clauses.some(clause => !correspondenceClaim.test(clause))
    || !establishesAssignment(evidence)) return [];
  const fields = evidence.authoredCurrentAnchors ?? [];
  const sources = fields.filter(entry => antecedentRole.test(normalizeTier2Synonym(entry.key))
    || entry.concepts.includes('correspondence.source'));
  const targets = fields.filter(entry => isExplicitTier2Role('ellipsis.site', entry.key) || normalizeTier2Synonym(entry.key) === 'silent domain'
    || entry.concepts.includes('correspondence.target') || normalizeTier2Synonym(entry.key) === 'target');
  if (sources.length !== 1 || targets.length !== 1 || sources[0] === targets[0]
    || sources[0].items.length !== 1 || targets[0].items.length !== 1
    || sources[0].items[0] === targets[0].items[0]) return [];
  const indices = indexRows(evidence);
  if (indices.length > 1 || indices.some(entry => entry.items.length !== 1)) return [];
  // Existing exact-role recovery already owns this pair.
  if (sources[0].concepts.includes('correspondence.source')
    && targets[0].concepts.includes('correspondence.target')) return [];
  const ids = [sources[0].items[0], targets[0].items[0]], counts = new Map<string, number>();
  const visit = (node: SyntaxNode) => {
    if (ids.includes(node.id)) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
    node.children?.forEach(visit);
  };
  evidence.currentForest.forEach(visit);
  if (ids.some(id => counts.get(id) !== 1)) return [];
  return [scopeEvidence(evidence, 'correspondence.alignment', [
    { entry: sources[0], concept: 'correspondence.source' },
    { entry: targets[0], concept: 'correspondence.target' }
  ], indices.map(entry => ({ entry, concept: 'index' })))];
}

/** A named silent domain earns the deletion depiction only through the normal
 * recipe's authored-silence check; the ellipsis assertion alone is insufficient. */
export function recoverNamedEllipsisSite(evidence: Tier2FacetEvidence) {
  const clauses = relationLabelClauses(evidence.relationName).filter(clause => /\bellipsis\b/u.test(clause));
  if (clauses.length !== 1 || !correspondenceClaim.test(clauses[0]) || !establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const hasAntecedent = anchors.some(entry => antecedentRole.test(normalizeTier2Synonym(entry.key)) && entry.items.length === 1);
  const sites = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'silent domain'
    || hasAntecedent && normalizeTier2Synonym(entry.key) === 'target');
  if (sites.length !== 1 || sites[0].items.length !== 1 || !uniqueCurrentOwners(evidence, sites[0].items)) return [];
  return [scopeEvidence(evidence, 'ellipsis.site', [{ entry: sites[0], concept: 'ellipsis.site' }])];
}
