import { establishesAssignment } from './assignmentContinuity.ts';
import { scopeEvidence, uniqueCurrentOwners } from './evidenceScopes.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym, relationLabelClauses } from './tier2Synonyms.ts';

/** An asserted modifier names its actual attachment scope. The ordinary
 * branch recipe still requires those exact nodes to be sisters; a deep lexical
 * head cannot stand in for the actual attachment host. */
export function recoverModifierAttachment(evidence: Tier2FacetEvidence) {
  if (!establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const qualifiedHost = (key: string) => /^modified (?:clause|domain)$/u.test(normalizeTier2Synonym(key));
  const explicitAttachment = anchors.some(entry => qualifiedHost(entry.key))
    && anchors.some(entry => /^(?:modifier|adjunct)$/u.test(normalizeTier2Synonym(entry.key)));
  const clauses = relationLabelClauses(evidence.relationName).filter(clause => explicitAttachment
    || /\brelative (?:clause|head|adjunction)\b|\bmodification$|^event time interpretation$/u.test(clause));
  if (clauses.length !== 1 || /\b(?:no|not|without|denied|rejected|required|requested|expected|possible|potential|hypothetical|conditional|pending|unresolved|failed|blocked|unlicensed|if|unless|whether)\b/u.test(clauses[0])) return [];
  const relative = /^(?:(?:restrictive|nonrestrictive) )?relative (?:clause (?:restriction|modification|attachment|adjunction)|head interpretation|adjunction)$/u.test(clauses[0]);
  const modification = explicitAttachment || /^(?:[\p{L}\p{N}]+ )*modification$|^event time interpretation$/u.test(clauses[0]);
  if (!relative && !modification) return [];
  const hosts = anchors.filter(entry => entry.concepts.includes('host') || /^nominal (?:head|host)$/u.test(normalizeTier2Synonym(entry.key))
    || qualifiedHost(entry.key)
    || modification && /^(?:scope|head|predicate|event predicate)$/u.test(normalizeTier2Synonym(entry.key)));
  const modifiers = anchors.filter(entry => entry.concepts.includes('pair.member') || /^(?:relative )?(?:modifier|adjunct)$/u.test(normalizeTier2Synonym(entry.key))
    || clauses[0] === 'event time interpretation' && normalizeTier2Synonym(entry.key) === 'temporal expression');
  if (hosts.length !== 1 || modifiers.length !== 1 || hosts[0].items.length !== 1 || modifiers[0].items.length !== 1) return [];
  if (!uniqueCurrentOwners(evidence, [...hosts[0].items, ...modifiers[0].items])) return [];
  return [scopeEvidence(evidence, 'pair-merge', [
    { entry: hosts[0], concept: 'host' }, { entry: modifiers[0], concept: 'pair.member' }
  ])];
}
