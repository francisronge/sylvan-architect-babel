import { assignmentOutcomes, establishesAssignment, type AssignmentScope } from './assignmentContinuity.ts';
import { nativeThetaRoles, sameNameValueEntries, type Tier2FacetEvidence } from './tier2FacetRecipes.ts';

/** Split ordered assignment lists only when their explicit roles, paired values
 * and unique structural grouping independently agree. Array length is not proof. */
export function recoverCompoundAssignments(evidence: Tier2FacetEvidence): AssignmentScope[] {
  const paths = new Map<string, string[][]>();
  const visit = (node: (typeof evidence.currentForest)[number], ancestors: string[]) => {
    const path = [...ancestors, node.id ?? ''];
    if (node.id) paths.set(node.id, [...(paths.get(node.id) ?? []), path]);
    node.children?.forEach(child => visit(child, path));
  };
  evidence.currentForest.forEach(node => visit(node, []));
  const depth = (a: string, b: string) => {
    const left = paths.get(a), right = paths.get(b);
    if (left?.length !== 1 || right?.length !== 1 || a === b) return -1;
    let i = 0;
    while (left[0][i] && left[0][i] === right[0][i]) i++;
    return i;
  };
  const scopes: AssignmentScope[] = [];
  if (assignmentOutcomes(evidence).some(entry => !entry.concepts.includes('outcome'))) return scopes;
  for (const kind of ['theta-grid', 'feature.dependency'] as const) {
    if (kind === 'theta-grid' && !establishesAssignment(evidence)) continue;
    const sourceRole = kind === 'theta-grid' ? 'predicate' : 'feature.source';
    const targetRole = kind === 'theta-grid' ? 'theta.arguments' : 'feature.target';
    const valueRole = kind === 'theta-grid' ? 'role.label' : 'case.literal';
    const anchors = evidence.authoredCurrentAnchors ?? [];
    const sources = anchors.filter(entry => entry.concepts.includes(sourceRole));
    const targets = anchors.filter(entry => entry.concepts.includes(targetRole));
    if (sources.length !== 1 || targets.length !== 1) continue;
    const source = sources[0], target = targets[0], count = source.items.length;
    const values = sameNameValueEntries(evidence, target);
    if (count < 2 || target.items.length !== count || values.length !== 1 || values[0].items.length !== count
      || new Set([...source.items, ...target.items]).size !== count * 2) continue;
    const value = values[0];
    // Each recipient belongs to the smallest branch containing a declared source.
    // Resolve the one-to-one grouping only if there is exactly one full solution.
    const candidates = target.items.map(id => {
      const depths = source.items.map(source => depth(source, id)), maximum = Math.max(...depths);
      return maximum > 0 ? depths.flatMap((d, index) => d === maximum ? [index] : []) : [];
    });
    if (!candidates.every((sources, index) => sources.includes(index))) continue;
    // With the authored pairing present, any alternate perfect pairing is an
    // alternating cycle. Detect it directly instead of enumerating permutations.
    const visiting = new Set<number>(), visited = new Set<number>();
    const alternative = (index: number): boolean => {
      if (visiting.has(index)) return true;
      if (visited.has(index)) return false;
      visiting.add(index);
      if (candidates[index].some(source => source !== index && alternative(source))) return true;
      visiting.delete(index); visited.add(index);
      return false;
    };
    if (candidates.some((_, index) => alternative(index))) continue;
    for (let index = 0; index < count; index++) {
      const scopedAnchors = [source, target].map(entry => ({ ...entry, items: [entry.items[index]] }));
      const scopedValue = { ...value, concepts: [valueRole], items: [value.items[index]] };
      // Outcomes apply to this relation moment; other values retain their own
      // neutral ownership rather than being broadcast into every assignment.
      const outcomes = assignmentOutcomes(evidence);
      scopes.push({ kind, origins: {
        anchors: { [source.key]: [index], [target.key]: [index] },
        values: { [value.key]: [index], ...Object.fromEntries(outcomes.map(entry => [entry.key, entry.items.map((_, i) => i)])) }
      }, evidence: { currentForest: evidence.currentForest,
        currentAnchors: { [sourceRole]: [source.items[index]], [targetRole]: [target.items[index]] },
        values: { [valueRole]: [value.items[index]], ...(outcomes.length ? { outcome: outcomes.flatMap(entry => [...entry.items]) } : {}) },
        authoredCurrentAnchors: scopedAnchors, authoredValues: [scopedValue, ...outcomes] } });
    }
  }
  return scopes;
}

/** The registered grid accepts either one predicate's inventory or fully proven
 * paired assignments. Both tiers use the same compound association check. */
export function nativeThetaAssignments(evidence: Tier2FacetEvidence): {
  assignments?: Array<{ predicate: string; roles: Array<{ nodeId: string; label: string }> }>;
  error?: string;
} {
  const predicates = [...new Set(evidence.currentAnchors.predicate ?? [])];
  if (predicates.length === 1) {
    const { roles, error } = nativeThetaRoles(evidence);
    return roles ? { assignments: [{ predicate: predicates[0], roles }] } : { error };
  }
  const scopes = recoverCompoundAssignments(evidence).filter(scope => scope.kind === 'theta-grid');
  if (scopes.length !== predicates.length || scopes.length < 2) return { error: 'Multiple predicates require complete, uniquely supported paired assignments.' };
  return { assignments: scopes.map(scope => ({ predicate: scope.evidence.currentAnchors.predicate[0],
    roles: [{ nodeId: scope.evidence.currentAnchors['theta.arguments'][0], label: scope.evidence.values['role.label'][0] }] })) };
}
