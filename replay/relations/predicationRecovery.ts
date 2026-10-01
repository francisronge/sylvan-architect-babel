import { establishesAssignment } from './assignmentContinuity.ts';
import { scopeEvidence, uniqueCurrentOwners, type EvidenceScope } from './evidenceScopes.ts';
import { normalizeTier2Synonym, relationLabelClauses } from './tier2Synonyms.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { categoryLabel } from '../categoryLabel.ts';

/** Qualified predication roles identify an asserted interpretation without
 * treating its contextual nominal head or embedded variable as another end. */
function recoverQualifiedPredication(evidence: Tier2FacetEvidence): EvidenceScope[] {
  const label = normalizeTier2Synonym(evidence.relationName);
  const tough = label === 'tough predication linkage';
  const relative = label === 'relative predication';
  if (!tough && !relative) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const externalRelative = relative && !anchors.some(entry => normalizeTier2Synonym(entry.key) === 'modified nominal')
    && anchors.some(entry => normalizeTier2Synonym(entry.key) === 'nominal head');
  const predicates = anchors.filter(entry => normalizeTier2Synonym(entry.key) === (tough ? 'adjectival predicate' : externalRelative ? 'operator' : 'relative operator'));
  const predicands = anchors.filter(entry => normalizeTier2Synonym(entry.key) === (tough ? 'matrix subject' : externalRelative ? 'nominal head' : 'modified nominal'));
  if (predicates.length !== 1 || predicands.length !== 1 || [...predicates, ...predicands].some(entry => entry.items.length !== 1)
    || anchors.some(entry => ![predicates[0], predicands[0]].includes(entry)
      && (entry.concepts.some(concept => ['predicate', 'predicand'].includes(concept))
        || relative && (entry.concepts.includes('operator') || /^(?:relative )?operator$/u.test(normalizeTier2Synonym(entry.key)))
        || /^(?:bearer|recipient)$/u.test(normalizeTier2Synonym(entry.key))))) return [];
  const context = relative ? anchors.filter(entry => normalizeTier2Synonym(entry.key) === (externalRelative ? 'relative clause' : 'nominal head')) : [];
  if (context.length > 1 || externalRelative && context.length !== 1 || context.some(entry => entry.items.length !== 1)
    || !uniqueCurrentOwners(evidence, [...predicates, ...predicands, ...context].flatMap(entry => entry.items))) return [];
  const nodes = new Map<string, typeof evidence.currentForest[number]>();
  const parents = new Map<string, typeof evidence.currentForest[number] | undefined>();
  const visit = (node: typeof evidence.currentForest[number], parent?: typeof evidence.currentForest[number]) => {
    nodes.set(node.id, node); parents.set(node.id, parent); node.children?.forEach(child => visit(child, node));
  };
  evidence.currentForest.forEach(node => visit(node));
  const predicate = nodes.get(predicates[0].items[0])!, predicand = nodes.get(predicands[0].items[0])!;
  const nominal = (node: typeof evidence.currentForest[number]) => ['D', 'DP', 'N', 'NP'].includes(categoryLabel(node.label));
  const contains = (node: typeof evidence.currentForest[number], id: string): boolean => node.id === id
    || Boolean(node.children?.some(child => contains(child, id)));
  if (!nominal(predicand) || (tough ? !['A', 'AP'].includes(categoryLabel(predicate.label)) : !nominal(predicate))) return [];
  if (externalRelative) {
    const clause = nodes.get(context[0].items[0])!, parent = parents.get(predicand.id);
    if (!['C', 'CP'].includes(categoryLabel(clause.label)) || !contains(clause, predicate.id)
      || !parent || parent !== parents.get(clause.id) || !nominal(parent)) return [];
  } else if (relative && (!contains(predicand, predicate.id)
    || context.some(entry => !nominal(nodes.get(entry.items[0])!) || !contains(predicand, entry.items[0])))) return [];
  const predication = scopeEvidence(evidence, 'predication.dependency', [
    { entry: predicates[0], concept: 'predicate' }, { entry: predicands[0], concept: 'predicand' }
  ]);
  return [predication, ...(externalRelative ? [scopeEvidence(evidence, 'pair-merge', [
    { entry: predicands[0], concept: 'host' }, { entry: context[0], concept: 'pair.member' }
  ])] : [])];
}

/** A predication claim identifies what its predicate is predicated of.
 * Bare bearer/recipient roles do not establish predication on their own. */
export function recoverPredication(evidence: Tier2FacetEvidence): EvidenceScope[] {
  if (!establishesAssignment(evidence)) return [];
  const qualified = recoverQualifiedPredication(evidence);
  if (qualified.length) return qualified;
  const clauses = relationLabelClauses(evidence.relationName).filter(clause => /\b(?:predication|predicative)\b/u.test(clause));
  if (clauses.length !== 1 || /\b(?:no|not|without|possible|potential|hypothetical|pending|unresolved|failed|blocked|unlicensed)\b/u.test(clauses[0])
    || !(/^(?:[\p{L}]+ )?predication(?: (?:relation|dependency))?$/u.test(clauses[0])
      || /^predicative (?:subject|object) role$/u.test(clauses[0]))) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const predicates = anchors.filter(entry => entry.concepts.includes('predicate'));
  const predicands = anchors.filter(entry => entry.concepts.includes('predicand')
    || /^(?:bearer|recipient)$/u.test(normalizeTier2Synonym(entry.key)));
  if (predicates.length !== 1 || predicands.length !== 1 || predicates[0].items.length !== 1 || predicands[0].items.length !== 1) return [];
  return [scopeEvidence(evidence, 'predication.dependency', [
    { entry: predicates[0], concept: 'predicate' }, { entry: predicands[0], concept: 'predicand' }
  ])];
}
