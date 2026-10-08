import { establishesAssignment } from './assignmentContinuity.ts';
import { scopeEvidence, uniqueCurrentOwners } from './evidenceScopes.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym } from './tier2Synonyms.ts';

const relativeInterpretation = (label: string) => /^(?:(?:restrictive|nonrestrictive|externally headed|internally headed) )?relative(?: head)? (?:interpretation|abstraction|restriction)$/u.test(label);
const relativeVariableRole = (role: string) => /^(?:(?:subject|object|embedded|bound) )?variable(?: position)?$/u.test(role);
const relativeOperatorRole = (role: string) => /^(?:relative )?operator$/u.test(role);
const quantifierScope = (label: string) => /^quantifier scope(?: interpretation)?$/u.test(label);
const qualifiedQuantifier = (role: string) => /^(?:wide|narrow) scope (universal|existential|indefinite|quantifier)$/u.exec(role)?.[1];
const quantifiedVariableRole = (role: string) => /^(?:bound )?(?:subject|object) variable(?: position)?$/u.test(role);

/** Named operators and variable positions in an asserted interpretation pair
 * by exact current lineage. Scope order remains text; this adds neither a
 * movement nor a correspondence chosen from independent list order. */
export function typedInterpretedBinding(evidence: Tier2FacetEvidence): boolean {
  const label = normalizeTier2Synonym(evidence.relationName);
  return (relativeInterpretation(label) || quantifierScope(label) || label === 'tough predication linkage')
    && Boolean(evidence.authoredCurrentAnchors?.some(entry => {
      const role = normalizeTier2Synonym(entry.key);
      if (relativeInterpretation(label)) return role !== 'variable' && relativeVariableRole(role);
      return quantifierScope(label) && Boolean(qualifiedQuantifier(role) || quantifiedVariableRole(role))
        || /^(?:embedded variable|object variable|variable position|(?:wide|narrow) scope operator|(?:subject|object) variable position)$/u.test(role);
    }));
}
export function recoverInterpretedOperatorBinding(evidence: Tier2FacetEvidence) {
  const label = normalizeTier2Synonym(evidence.relationName);
  const relative = relativeInterpretation(label);
  const quantified = quantifierScope(label);
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
  const qualifiedScope = quantified && anchors.some(entry => qualifiedQuantifier(normalizeTier2Synonym(entry.key)));
  const operators = anchors.filter(entry => relative ? relativeOperatorRole(normalizeTier2Synonym(entry.key))
    : tough ? normalizeTier2Synonym(entry.key) === 'operator'
    : /^(?:wide|narrow) scope operator$/u.test(normalizeTier2Synonym(entry.key))
      || qualifiedScope && Boolean(qualifiedQuantifier(normalizeTier2Synonym(entry.key))));
  const variables = anchors.filter(entry => tough ? normalizeTier2Synonym(entry.key) === 'embedded variable'
    : relative ? relativeVariableRole(normalizeTier2Synonym(entry.key))
    : qualifiedScope ? quantifiedVariableRole(normalizeTier2Synonym(entry.key))
    : /^(?:subject|object) variable position$/u.test(normalizeTier2Synonym(entry.key)));
  if (anchors.some(entry => !operators.includes(entry) && (entry.concepts.includes('operator')
    || /^(?:relative|quantifier) operator$/u.test(normalizeTier2Synonym(entry.key)))
    || !variables.includes(entry) && entry.concepts.includes('variable'))) return [];
  if (!operators.length || !variables.length || !qualifiedScope && operators.length !== variables.length || [...operators, ...variables].some(entry => entry.items.length !== 1)
    || !uniqueCurrentOwners(evidence, [...operators, ...variables].flatMap(entry => entry.items))) return [];
  const nodes = new Map<string, typeof evidence.currentForest[number]>();
  const paths = new Map<string, typeof evidence.currentForest>();
  const visit = (node: typeof evidence.currentForest[number], path: typeof evidence.currentForest) => {
    nodes.set(node.id, node); paths.set(node.id, path); node.children?.forEach(child => visit(child, [...path, node]));
  };
  evidence.currentForest.forEach(node => visit(node, []));
  const pairs = operators.map(operator => variables.filter(variable => nodes.get(operator.items[0])?.lineageId
    && nodes.get(operator.items[0])?.lineageId === nodes.get(variable.items[0])?.lineageId));
  if (pairs.some(pair => qualifiedScope ? pair.length > 1 : pair.length !== 1)
    || pairs.flat().length !== variables.length || new Set(pairs.flat()).size !== variables.length) return [];
  const backed = operators.flatMap((operator, index) => pairs[index].map(variable => ({ operator, variable })));
  // Recovered interpretation roles establish binding only when the operator's
  // first branching ancestor also contains its distinct lineage variable.
  // Shared lineage alone can identify copies in unrelated workspaces.
  if ((relative || qualifiedScope) && backed.some(({ operator, variable }) => {
    const operatorPath = paths.get(operator.items[0])!, variablePath = paths.get(variable.items[0])!;
    const branching = [...operatorPath].reverse().find(node => (node.children?.length ?? 0) > 1);
    return !branching || !variablePath.includes(branching)
      || variablePath.includes(nodes.get(operator.items[0])!) || operatorPath.includes(nodes.get(variable.items[0])!);
  })) return [];
  const domains = anchors.filter(entry => entry.concepts.includes('scope.domain'));
  if (domains.length > 1 || domains.some(entry => entry.items.length !== 1 || !uniqueCurrentOwners(evidence, entry.items))) return [];
  const indices = (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('index')
    || (relative || tough) && normalizeTier2Synonym(entry.key) === 'variable index');
  if (indices.length > 1 || indices.some(entry => entry.items.length !== 1 || !entry.items[0].trim())
    || operators.length > 1 && indices.length) return [];
  return backed.flatMap(({ operator, variable }) => {
    const qualifier = qualifiedScope && qualifiedQuantifier(normalizeTier2Synonym(operator.key));
    const matchingDomains = qualifier ? anchors.filter(entry => normalizeTier2Synonym(entry.key) === `${qualifier} domain`) : [];
    const ownedDomains = [...new Set([...domains, ...matchingDomains])];
    if (ownedDomains.length > 1 || ownedDomains.some(entry => entry.items.length !== 1 || !uniqueCurrentOwners(evidence, entry.items)
      || qualifiedScope && (!paths.get(variable.items[0])!.some(node => node.id === entry.items[0])
        || !paths.get(operator.items[0])!.some(node => node.id === entry.items[0])))) return [];
    return [scopeEvidence(evidence, 'operator-binding', [
      { entry: operator, concept: 'operator' }, { entry: variable, concept: 'variable' },
      ...ownedDomains.map(entry => ({ entry, concept: 'scope.domain' }))
    ], indices.map(entry => ({ entry, concept: 'index' })))];
  });
}
