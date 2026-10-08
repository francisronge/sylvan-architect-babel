import { establishesAssignment } from './assignmentContinuity.ts';
import { scopeEvidence, uniqueCurrentOwners, type EvidenceScope } from './evidenceScopes.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym, relationLabelClauses } from './tier2Synonyms.ts';

/** An asserted focus association qualifies its named operator. Neither a bare
 * operator role nor a general scope interpretation establishes this pairing. */
export function typedFocusAssociation(evidence: Tier2FacetEvidence): { applies: boolean; scope?: EvidenceScope } {
  const clauses = relationLabelClauses(evidence.relationName).filter(clause => /\b(?:focus|additive|restrictive|exclusive) association\b/u.test(clause));
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const operatorRole = (key: string) => /^(?:(?:additive|restrictive|exclusive) )?operator$|^(?:additive|restrictive|exclusive) (?:adverb|modifier)$/u.test(normalizeTier2Synonym(key));
  if (!clauses.length || !anchors.some(entry => operatorRole(entry.key))) return { applies: false };
  const unresolved = { applies: true };
  if (clauses.length !== 1 || !/^(?:(?:restrictive|additive|exclusive) )?(?:(?:subject|object|constituent) )?(?:focus )?association$/u.test(clauses[0])
    || !establishesAssignment(evidence)) return unresolved;
  const operators = anchors.filter(entry => operatorRole(entry.key)
    || entry.concepts.includes('association.particle'));
  const focused = anchors.filter(entry => /^focused (?:constituent|phrase|subject|object)$/u.test(normalizeTier2Synonym(entry.key)));
  const restrictions = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'restriction');
  const explicit = anchors.filter(entry => entry.concepts.includes('association.associate')
    || clauses[0] === 'additive association' && normalizeTier2Synonym(entry.key) === 'added subject');
  // An explicitly named restriction can be the associate within a containing
  // focused phrase. Do not choose between competing restrictions or associates.
  const associates = explicit.length ? explicit : restrictions.length ? restrictions : focused;
  if (!explicit.length && restrictions.length && focused.length) {
    const nodes = evidence.currentForest.flatMap(function walk(node) { return [node, ...(node.children ?? []).flatMap(walk)]; });
    const contains = (node: typeof nodes[number], id: string): boolean => node.id === id || Boolean(node.children?.some(child => contains(child, id)));
    const carrier = focused.length === 1 && focused[0].items.length === 1
      ? nodes.filter(node => node.id === focused[0].items[0]) : [];
    if (carrier.length !== 1 || restrictions.length !== 1 || restrictions[0].items.length !== 1
      || !contains(carrier[0], restrictions[0].items[0])
      || !operators.every(entry => entry.items.every(id => contains(carrier[0], id)))) return unresolved;
  }
  if (operators.length !== 1 || associates.length !== 1 || operators[0].items.length !== 1
    || associates[0].items.length !== 1 || !uniqueCurrentOwners(evidence, [...operators[0].items, ...associates[0].items])) return unresolved;
  return { applies: true, scope: scopeEvidence(evidence, 'focus.association', [
    { entry: operators[0], concept: 'association.particle' }, { entry: associates[0], concept: 'association.associate' }
  ]) };
}

export function recoverFocusAssociation(evidence: Tier2FacetEvidence) {
  const scope = typedFocusAssociation(evidence).scope;
  return scope ? [scope] : [];
}
