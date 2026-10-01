import { assignmentOutcomes, establishesAssignment, type AssignmentScope } from './assignmentContinuity.ts';
import { nativeThetaRoles, sameNameValueEntries, type Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { buildTier2SynonymIndex, namedThematicRole, normalizeTier2Synonym, qualifiedAssignmentConcepts, relationRoleConcepts } from './tier2Synonyms.ts';
import { scopeEvidence, type EvidenceScope } from './evidenceScopes.ts';
import { categoryLabel } from '../categoryLabel.ts';

const roleIndex = buildTier2SynonymIndex();

/** Coordination can share an assignment noun: “object role and Case
 * assignment” asserts both. Separate clauses do not inherit that noun. */
const assignmentClauses = (label: string | undefined): string[] => normalizeTier2Synonym(label ?? '')
  .split(/\s*(?:[;,]|\bbut\b)\s*/u).flatMap(group => {
    const clauses = group.split(/\s+and\s+/u);
    const operation = / (assignment|introduction|licensing|valuation)$/u.exec(clauses.at(-1) ?? '')?.[1];
    return clauses.map(clause => operation && /(?:^| )(?:role|case)$/u.test(clause) ? `${clause} ${operation}` : clause);
  }).map(clause => clause.replace(/^(?:matrix|embedded|local) /u, ''));

/** A typed thematic assignment keeps its own direction when Case properties
 * coexist. The scope binds authored fields; it does not rewrite the record. */
export function recoverTypedAssignments(evidence: Tier2FacetEvidence): EvidenceScope[] {
  if (!establishesAssignment(evidence)) return [];
  const values = evidence.authoredValues ?? [];
  const roles = values.filter(entry => entry.concepts.includes('role.label'));
  if (roles.length !== 1 || roles[0].items.length !== 1 || !roles[0].items[0].trim()) return [];
  const literal = normalizeTier2Synonym(roles[0].items[0]);
  const clauses = assignmentClauses(evidence.relationName);
  const thematic = (clause: string) => {
    const match = /^([\p{L}\p{N}]+) role (?:assignment|introduction|licensing)$/u.exec(clause);
    return /^(?:theta|thematic|θ)(?: role)? (?:assignment|introduction|licensing)$/u.test(clause)
      || Boolean(match && (namedThematicRole(match[1]) || ['subject', 'object', 'external', 'internal'].includes(match[1]) || match[1] === literal));
  };
  const roleClauses = clauses.filter(clause => /(?:^| )(?:role|theta|thematic|θ)(?: |$)/u.test(clause));
  if (roleClauses.length !== 1 || !thematic(roleClauses[0])) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const occurrences = new Map<string, Array<{ node: (typeof evidence.currentForest)[number]; workspace: number; ancestors: string[] }>>();
  const visit = (node: (typeof evidence.currentForest)[number], workspace: number, ancestors: string[]) => {
    occurrences.set(node.id, [...(occurrences.get(node.id) ?? []), { node, workspace, ancestors }]);
    node.children?.forEach(child => visit(child, workspace, [...ancestors, node.id]));
  };
  evidence.currentForest.forEach((node, workspace) => visit(node, workspace, []));
  const occurrence = (id: string) => occurrences.get(id)?.length === 1 ? occurrences.get(id)![0] : undefined;
  const targets = anchors.filter(entry => entry.concepts.includes('theta.arguments')
    || qualifiedAssignmentConcepts(`theta ${entry.key}`).includes('theta.arguments')
    || namedThematicRole(entry.key) || normalizeTier2Synonym(entry.key) === literal);
  if (targets.length !== 1 || targets[0].items.length !== 1) return [];
  const target = targets[0], targetOccurrence = occurrence(target.items[0]);
  if (!targetOccurrence) return [];
  const headSource = (entry: (typeof anchors)[number]) => {
    const role = normalizeTier2Synonym(entry.key);
    const predicateRole = role.endsWith(' head') && relationRoleConcepts(roleIndex, role.replace(/ head$/u, ' predicate')).includes('predicate');
    if (role !== 'verb' && !predicateRole) return false;
    const source = entry.items.length === 1 ? occurrence(entry.items[0]) : undefined;
    // An anchored verbal or qualified predicative head supplies a source only
    // in this typed assignment and in the recipient's current workspace.
    return source && source.workspace === targetOccurrence.workspace
      && !source.ancestors.includes(target.items[0])
      && !/[′’']/u.test(source.node.label)
      && /^(?:V|v|Voice|Appl|P|A|N)$/u.test(categoryLabel(source.node.label));
  };
  const sources = anchors.filter(entry => entry.concepts.includes('predicate')
    || qualifiedAssignmentConcepts(`theta ${entry.key}`).includes('predicate') || headSource(entry));
  if (sources.length !== 1 || sources[0].items.length !== 1 || sources[0].items[0] === target.items[0]
    || !occurrence(sources[0].items[0])) return [];
  const source = sources[0];
  return [scopeEvidence(evidence, 'theta-grid', [
    { entry: source, concept: 'predicate' }, { entry: target, concept: 'theta.arguments' }
  ], [{ entry: roles[0], concept: 'role.label' }])];
}

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
  const depthWeight = Math.max(0, ...[...paths.values()].flat().map(path => path.length)) + 1;
  const depth = (a: string, b: string) => {
    const left = paths.get(a), right = paths.get(b);
    if (left?.length !== 1 || right?.length !== 1 || a === b || left[0].includes(b) || right[0].includes(a)) return -1;
    let i = 0;
    while (left[0][i] && left[0][i] === right[0][i]) i++;
    // Prefer the smallest shared branch, then its nearest declared source.
    // A source buried in another recipient cannot win an otherwise tied pair
    // merely because excluding its own ancestor makes the matching unique.
    return i ? i * depthWeight - (left[0].length - i) : -1;
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
    const paired = sameNameValueEntries(evidence, target, targetRole);
    const shared = kind === 'feature.dependency' && !paired.length
      ? (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('case.literal') && entry.items.length === 1) : [];
    const values = paired.length ? paired : shared;
    if (count < 2 || target.items.length !== count || values.length !== 1 || values[0].items.length !== (shared.length ? 1 : count)
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
      const valueIndex = shared.length ? 0 : index;
      const literal = value.items[valueIndex];
      const scopedValue = { ...value, concepts: [valueRole], items: [literal] };
      // Outcomes apply to this relation moment; other values retain their own
      // neutral ownership rather than being broadcast into every assignment.
      const outcomes = assignmentOutcomes(evidence);
      scopes.push({ kind, origins: {
        anchors: { [source.key]: [index], [target.key]: [index] },
        values: { [value.key]: [valueIndex], ...Object.fromEntries(outcomes.map(entry => [entry.key, entry.items.map((_, i) => i)])) }
      }, evidence: { currentForest: evidence.currentForest,
        currentAnchors: { [sourceRole]: [source.items[index]], [targetRole]: [target.items[index]] },
        values: { [valueRole]: [literal], ...(outcomes.length ? { outcome: outcomes.flatMap(entry => [...entry.items]) } : {}) },
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
