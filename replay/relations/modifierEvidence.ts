import { scopeEvidence, uniqueCurrentOwners } from './evidenceScopes.ts';
import { establishesAssignment } from './outcomeResolver.ts';
import type { Tier2FacetEvidence } from './tier2FacetTypes.ts';
import { normalizeTier2Synonym, relationLabelClauses } from './tier2Synonyms.ts';

/** An asserted modifier names its actual attachment scope. The ordinary
 * branch recipe still requires those exact nodes to be sisters; a deep lexical
 * head cannot stand in for the actual attachment host. */
export function recoverModifierAttachment(evidence: Tier2FacetEvidence) {
  if (!establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const qualifiedHost = (key: string) => /^modified (?:clause|domain|projection)$/u.test(normalizeTier2Synonym(key));
  const modifierRole = (key: string) => /^(?:(?:relative|attributive|adjectival|adverbial|temporal) )?(?:modifier(?: phrase| constituent| pp)?|adjunct)$/u.test(normalizeTier2Synonym(key));
  const explicitAttachment = anchors.some(entry => qualifiedHost(entry.key))
    && anchors.some(entry => modifierRole(entry.key));
  const clauses = relationLabelClauses(evidence.relationName).filter(clause => explicitAttachment
    || /\brelative (?:clause|head|adjunction|restriction)\b|\bmodification$|^event time interpretation$/u.test(clause));
  if (clauses.length !== 1 || /\b(?:no|not|without|denied|rejected|required|requested|expected|possible|potential|hypothetical|conditional|pending|unresolved|failed|blocked|unlicensed|if|unless|whether)\b/u.test(clauses[0])) return [];
  const relative = /^(?:(?:restrictive|nonrestrictive) )?relative (?:clause (?:restriction|modification|attachment|adjunction)|head interpretation|adjunction|restriction(?: of (?:an? )?(?:external )?nominal head)?)$/u.test(clauses[0]);
  const modification = explicitAttachment || /^(?:[\p{L}\p{N}]+ )*modification$|^event time interpretation$/u.test(clauses[0]);
  if (!relative && !modification) return [];
  let hosts = anchors.filter(entry => entry.concepts.includes('host') || /^nominal (?:head|host)$/u.test(normalizeTier2Synonym(entry.key))
    || qualifiedHost(entry.key)
    || modification && /^(?:scope|head|predicate|event predicate)$/u.test(normalizeTier2Synonym(entry.key)));
  const declaredHosts = hosts.filter(entry => qualifiedHost(entry.key) || entry.concepts.includes('host'));
  if (declaredHosts.length === 1) {
    const host = declaredHosts[0];
    const context = hosts.filter(entry => entry !== host);
    const nodes = new Map<string, typeof evidence.currentForest[number]>();
    const visit = (node: typeof evidence.currentForest[number]) => { nodes.set(node.id, node); node.children?.forEach(visit); };
    evidence.currentForest.forEach(visit);
    const contains = (node: typeof evidence.currentForest[number], id: string): boolean => node.id === id || Boolean(node.children?.some(child => contains(child, id)));
    if (context.length && (host.items.length !== 1 || !uniqueCurrentOwners(evidence, [...host.items, ...context.flatMap(entry => entry.items)])
      || context.some(entry => normalizeTier2Synonym(entry.key) !== 'nominal head' || entry.items.length !== 1
        || !contains(nodes.get(host.items[0])!, entry.items[0])))) return [];
    hosts = declaredHosts;
  }
  const modifiers = anchors.filter(entry => entry.concepts.includes('pair.member') || modifierRole(entry.key)
    || clauses[0] === 'event time interpretation' && normalizeTier2Synonym(entry.key) === 'temporal expression');
  if (hosts.length !== 1 || modifiers.length !== 1 || hosts[0].items.length !== 1 || modifiers[0].items.length !== 1) return [];
  if (!uniqueCurrentOwners(evidence, [...hosts[0].items, ...modifiers[0].items])) return [];
  return [scopeEvidence(evidence, 'pair-merge', [
    { entry: hosts[0], concept: 'host' }, { entry: modifiers[0], concept: 'pair.member' }
  ])];
}
