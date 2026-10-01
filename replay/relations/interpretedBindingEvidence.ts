import { establishesAssignment } from './assignmentContinuity.ts';
import { scopeEvidence, uniqueCurrentOwners } from './evidenceScopes.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym } from './tier2Synonyms.ts';

/** Named operators and variable positions in an asserted interpretation pair
 * by exact current lineage. Scope order remains text; this adds neither a
 * movement nor a correspondence chosen from independent list order. */
export function typedInterpretedBinding(evidence: Tier2FacetEvidence): boolean {
  return /^(?:(?:restrictive )?relative (?:interpretation|abstraction)|relative head interpretation|quantifier scope interpretation|tough predication linkage)$/u
    .test(normalizeTier2Synonym(evidence.relationName))
    && Boolean(evidence.authoredCurrentAnchors?.some(entry => /^(?:embedded variable|object variable|variable position|(?:wide|narrow) scope operator|(?:subject|object) variable position)$/u
      .test(normalizeTier2Synonym(entry.key))));
}
export function recoverInterpretedOperatorBinding(evidence: Tier2FacetEvidence) {
  const label = normalizeTier2Synonym(evidence.relationName);
  const relative = /^(?:(?:restrictive )?relative (?:interpretation|abstraction)|relative head interpretation)$/u.test(label);
  const quantified = label === 'quantifier scope interpretation';
  const tough = label === 'tough predication linkage';
  if ((!relative && !quantified && !tough) || !establishesAssignment(evidence)) return [];
  if (tough) {
    const dependencies = (evidence.authoredValues ?? []).filter(entry => normalizeTier2Synonym(entry.key) === 'dependency type');
    if (dependencies.length !== 1 || dependencies[0].items.length !== 1
      || !/\boperator bound(?: object)? variable\b/u.test(normalizeTier2Synonym(dependencies[0].items[0]))
      || /\b(?:no|not|without|denied|rejected|failed|blocked|unlicensed|possible|potential|hypothetical|conditional|pending|unresolved|if|unless|whether|required|expected)\b/u
        .test(normalizeTier2Synonym(dependencies[0].items[0]))) return [];
  }
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const operators = anchors.filter(entry => relative || tough ? normalizeTier2Synonym(entry.key) === 'operator'
    : /^(?:wide|narrow) scope operator$/u.test(normalizeTier2Synonym(entry.key)));
  const variables = anchors.filter(entry => tough ? normalizeTier2Synonym(entry.key) === 'embedded variable'
    : relative ? /^(?:object variable|variable position)$/u.test(normalizeTier2Synonym(entry.key))
    : /^(?:subject|object) variable position$/u.test(normalizeTier2Synonym(entry.key)));
  if (anchors.some(entry => !operators.includes(entry) && (entry.concepts.includes('operator')
    || /^(?:relative|quantifier) operator$/u.test(normalizeTier2Synonym(entry.key)))
    || !variables.includes(entry) && entry.concepts.includes('variable'))) return [];
  if (!operators.length || operators.length !== variables.length || [...operators, ...variables].some(entry => entry.items.length !== 1)
    || !uniqueCurrentOwners(evidence, [...operators, ...variables].flatMap(entry => entry.items))) return [];
  const nodes = new Map<string, typeof evidence.currentForest[number]>();
  const visit = (node: typeof evidence.currentForest[number]) => { nodes.set(node.id, node); node.children?.forEach(visit); };
  evidence.currentForest.forEach(visit);
  const pairs = operators.map(operator => variables.filter(variable => nodes.get(operator.items[0])?.lineageId
    && nodes.get(operator.items[0])?.lineageId === nodes.get(variable.items[0])?.lineageId));
  if (pairs.some(pair => pair.length !== 1) || new Set(pairs.flat()).size !== variables.length) return [];
  const domains = anchors.filter(entry => entry.concepts.includes('scope.domain'));
  if (domains.length > 1 || domains.some(entry => entry.items.length !== 1 || !uniqueCurrentOwners(evidence, entry.items))) return [];
  const indices = (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('index')
    || (relative || tough) && normalizeTier2Synonym(entry.key) === 'variable index');
  if (indices.length > 1 || indices.some(entry => entry.items.length !== 1 || !entry.items[0].trim())
    || operators.length > 1 && indices.length) return [];
  return operators.map((operator, index) => scopeEvidence(evidence, 'operator-binding', [
    { entry: operator, concept: 'operator' }, { entry: pairs[index][0], concept: 'variable' },
    ...domains.map(entry => ({ entry, concept: 'scope.domain' }))
  ], indices.map(entry => ({ entry, concept: 'index' }))));
}
