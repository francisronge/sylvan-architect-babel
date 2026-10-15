import type { SyntaxNode } from '../../types.ts';
import { scopeEvidence, uniqueCurrentOwners } from './evidenceScopes.ts';
import { establishesAssignment } from './outcomeResolver.ts';
import type { Tier2FacetEvidence } from './tier2FacetTypes.ts';
import { normalizeTier2Synonym, relationLabelClauses } from './tier2Synonyms.ts';

/** An asserted idiomatic interpretation can name its participating pieces with
 * ordinary syntactic roles. One exact enclosing domain proves their grouping;
 * unrelated context or nested competing pieces cannot be silently included. */
export function recoverIdiomDomain(evidence: Tier2FacetEvidence) {
  const claims = relationLabelClauses(evidence.relationName).filter(clause => /\b(?:idiom|idiomatic)\b/u.test(clause));
  if (claims.length !== 1 || !/^(?:(?:lexically )?licensed )?(?:idiom|idiomatic) interpretation$/u.test(claims[0])
    || !establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  if (anchors.some(entry => entry.concepts.includes('chunks'))) return [];
  const domains = anchors.filter(entry => /^(?:construction|interpretation|cointerpretation|idiom|idiomatic) domain$/u.test(normalizeTier2Synonym(entry.key)));
  if (domains.length !== 1 || domains[0].items.length !== 1) return [];
  const chunks = anchors.filter(entry => entry !== domains[0]);
  if (chunks.length < 2 || chunks.some(entry => entry.items.length !== 1)
    || !uniqueCurrentOwners(evidence, anchors.flatMap(entry => entry.items))) return [];
  const nodes = new Map<string, SyntaxNode>();
  const visit = (node: SyntaxNode) => { nodes.set(node.id, node); node.children?.forEach(visit); };
  evidence.currentForest.forEach(visit);
  const contains = (node: SyntaxNode, id: string): boolean => node.id === id || Boolean(node.children?.some(child => contains(child, id)));
  const domain = nodes.get(domains[0].items[0])!;
  if (chunks.some(entry => !contains(domain, entry.items[0]))
    || chunks.some(entry => chunks.some(other => entry !== other && contains(nodes.get(entry.items[0])!, other.items[0])))) return [];
  return [scopeEvidence(evidence, 'idiom.chunks', [
    { entry: domains[0], concept: 'interpretation.domain' }, ...chunks.map(entry => ({ entry, concept: 'chunks' }))
  ])];
}
