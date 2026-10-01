import type { SyntaxNode } from '../../types.ts';
import { literalThetaRoles, pairedLiterals, POSITIVE_OUTCOMES, type Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import type { RecoveredMovement } from './movementEvidence.ts';
import { normalizeTier2Synonym } from './tier2Synonyms.ts';
import { resolveOutcomeLiteral, relationAssertionFailure, negativeClaimFailure } from './outcomeResolver.ts';
import { categoryLabel } from '../categoryLabel.ts';

type Occurrence = { id: string; parent: string | null; lineage?: string; headCategory?: string; children: string[] };
type RelationMoment = { stageIndex: number; relationIndex: number };
type Assignment = { kind: 'theta-grid' | 'feature.dependency'; source: Occurrence; target: Occurrence; literal: string; moment: RelationMoment };
export type AssignmentContext = { assignments: Assignment[]; continuations: Map<string, Set<string>> };
export const createAssignmentContext = (): AssignmentContext => ({ assignments: [], continuations: new Map() });

export const assignmentOutcomes = (evidence: Tier2FacetEvidence) => (evidence.authoredValues ?? []).filter(entry =>
  entry.concepts.includes('outcome') || ['outcome', 'status', 'result', 'verdict', 'judgment'].includes(normalizeTier2Synonym(entry.key)));
export const establishesAssignment = (evidence: Tier2FacetEvidence) => assignmentOutcomes(evidence).every(entry =>
  entry.items.every(literal => POSITIVE_OUTCOMES.some(concept => concept === resolveOutcomeLiteral(literal)?.concept)));

function occurrences(forest: readonly SyntaxNode[]) {
  const nodes = new Map<string, Occurrence[]>();
  const visit = (node: SyntaxNode, parent: string | null) => {
    const category = categoryLabel(node.label).replace(/(?:\^?0|⁰)$/u, '');
    const headCategory = category && !/[′’']/u.test(node.label) && !/P$/u.test(category)
      && /^[\p{L}]+$/u.test(category) ? category : undefined;
    if (node.id) nodes.set(node.id, [...(nodes.get(node.id) ?? []), {
      id: node.id, parent, ...(node.lineageId ? { lineage: node.lineageId } : {}),
      ...(headCategory ? { headCategory } : {}), children: (node.children ?? []).map(child => child.id)
    }]);
    node.children?.forEach(child => visit(child, node.id || null));
  };
  forest.forEach(node => visit(node, null));
  return new Map([...nodes].flatMap(([id, entries]) => entries.length === 1 ? [[id, entries[0]] as const] : []));
}

/** A proven movement carries the preceding assignment position to its lower witness. */
export function rememberAssignmentMovement(context: AssignmentContext, movement?: RecoveredMovement) {
  if (!movement?.transition) return;
  const continuations = context.continuations.get(movement.priorSourceNodeId) ?? new Set<string>();
  continuations.add(movement.witnessNodeId);
  context.continuations.set(movement.priorSourceNodeId, continuations);
}

/** Remember only complete, already validated claims, never an unresolved relation's prose. */
export function rememberAssignments(context: AssignmentContext, kind: string, evidence: Tier2FacetEvidence, moment: RelationMoment,
  nativeRoles?: Array<{ nodeId: string; label: string }>) {
  if (kind !== 'theta-grid' && kind !== 'feature.dependency') return;
  if (!establishesAssignment(evidence)) return;
  if (kind === 'feature.dependency' && relationAssertionFailure(evidence.relationName, 'case')) return;
  const nodes = occurrences(evidence.currentForest);
  const sourceIds = evidence.currentAnchors[kind === 'theta-grid' ? 'predicate' : 'feature.source'] ?? [];
  if (sourceIds.length !== 1) return;
  const source = nodes.get(sourceIds[0]);
  if (!source) return;
  const targets = kind === 'theta-grid' ? nativeRoles ?? literalThetaRoles(evidence) ?? []
    : (evidence.currentAnchors['feature.target'] ?? []).map((nodeId, i) => ({
      nodeId, label: pairedLiterals(evidence, 'feature.target', 'case.literal')?.[i] ?? ''
    }));
  for (const { nodeId, label } of targets) {
    const target = nodes.get(nodeId);
    if (!target || !label) continue;
    const record: Assignment = { kind, source, target, literal: label, moment };
    if (!context.assignments.some(item => JSON.stringify(item) === JSON.stringify(record))) context.assignments.push(record);
  }
}

export type AssignmentScope = {
  kind: Assignment['kind']; evidence: Tier2FacetEvidence;
  restates?: RelationMoment;
  /** Indices in the untouched authored envelope, for claim ownership and inspection. */
  origins: Record<'anchors' | 'values', Record<string, number[]>>;
};

/** Recover an explicitly restated assignment through its established occurrence and position. */
export function recoverAssignmentContinuity(evidence: Tier2FacetEvidence, context: AssignmentContext): AssignmentScope[] {
  const outcomes = assignmentOutcomes(evidence);
  if (outcomes.some(entry => !entry.concepts.includes('outcome'))) return [];
  const nodes = occurrences(evidence.currentForest);
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const allIds = [...new Set(anchors.flatMap(entry => [...entry.items]))];
  const onlyHeads = (id: string, seen = new Set<string>()): boolean => {
    const node = nodes.get(id);
    if (!node?.headCategory || seen.has(id)) return false;
    seen.add(id);
    return node.children.every(child => onlyHeads(child, seen));
  };
  // Adjunction can retain the exact assigning head inside a new head complex
  // occupying its old slot. The host must remain the unique same-category
  // branch at every wrapper; sharing lineage or containing it in a phrase does
  // not establish this continuation. A target never inherits this exception.
  const retainedHeadSlot = (prior: Occurrence, id: string): boolean => {
    let current = nodes.get(prior.id);
    if (!current || !prior.headCategory || current.headCategory !== prior.headCategory
      || prior.lineage && prior.lineage !== current.lineage) return false;
    let matched = current.id === id;
    const seen = new Set<string>();
    while (current.parent !== prior.parent) {
      if (!current.parent || seen.has(current.id)) return false;
      seen.add(current.id);
      const wrapper = nodes.get(current.parent);
      if (!wrapper || wrapper.headCategory !== prior.headCategory || wrapper.children.length !== 2
        || wrapper.children.filter(child => nodes.get(child)?.headCategory === wrapper.headCategory).length !== 1
        || !wrapper.children.includes(current.id)) return false;
      const adjunct = wrapper.children.find(child => child !== current.id);
      if (!adjunct || !onlyHeads(adjunct)) return false;
      current = wrapper;
      matched ||= current.id === id;
    }
    return matched;
  };
  const continues = (prior: Occurrence, id: string) => {
    const current = nodes.get(id);
    if (!current || current.parent !== prior.parent) return false;
    if (prior.id === id) return !prior.lineage || prior.lineage === current.lineage;
    if (!prior.lineage || prior.lineage !== current.lineage) return false;
    const pending = [prior.id], seen = new Set<string>();
    while (pending.length) {
      const source = pending.pop()!;
      if (source === id) return true;
      if (seen.has(source)) continue;
      seen.add(source);
      pending.push(...(context.continuations.get(source) ?? []));
    }
    return false;
  };
  const scopes: AssignmentScope[] = [];
  for (const valueEntry of evidence.authoredValues ?? []) for (let index = 0; index < valueEntry.items.length; index++) {
    const literal = valueEntry.items[index];
    const pairedAnchor = anchors.find(entry => entry.key === valueEntry.key && entry.items.length === valueEntry.items.length);
    for (const kind of ['theta-grid', 'feature.dependency'] as const) {
      // A role grid has no failed-assignment visual state; leave such claims neutral.
      if (kind === 'theta-grid' && !establishesAssignment(evidence)) continue;
      if (kind === 'feature.dependency' && relationAssertionFailure(evidence.relationName, 'case')
        && (!outcomes.length || negativeClaimFailure(outcomes.flatMap(entry => [...entry.items]), []))) continue;
      const sourceRole = kind === 'theta-grid' ? 'predicate' : 'feature.source';
      const targetRole = kind === 'theta-grid' ? 'theta.arguments' : 'feature.target';
      const valueRole = kind === 'theta-grid' ? 'role.label' : 'case.literal';
      if (!valueEntry.concepts.includes(valueRole) && !pairedAnchor) continue;
      const declaredSources = evidence.currentAnchors[sourceRole] ?? [];
      const declaredTargets = evidence.currentAnchors[targetRole] ?? [];
      const sourceIds = declaredSources.length ? declaredSources : allIds;
      const targetIds = pairedAnchor ? [pairedAnchor.items[index]] : declaredTargets.length ? declaredTargets : allIds;
      const pairs = new Map<string, { source: string; target: string; prior: Assignment }>();
      for (const prior of context.assignments) {
        if (prior.kind !== kind || prior.literal !== literal) continue;
        for (const source of sourceIds.filter(id => continues(prior.source, id) || retainedHeadSlot(prior.source, id))) {
          for (const target of targetIds.filter(id => continues(prior.target, id))) {
            if (source !== target) pairs.set(JSON.stringify([source, target]), { source, target, prior });
          }
        }
      }
      if (pairs.size !== 1) continue;
      const { source, target, prior } = [...pairs.values()][0];
      const origins: AssignmentScope['origins'] = { anchors: {}, values: { [valueEntry.key]: [index] } };
      outcomes.forEach(entry => { origins.values[entry.key] = entry.items.map((_, index) => index); });
      const scopedAnchors = anchors.flatMap(entry => {
        const indices = entry.items.flatMap((id, i) => id === source || id === target ? [i] : []);
        if (!indices.length) return [];
        // One field containing both ends cannot identify their different roles.
        const ids = [...new Set(indices.map(i => entry.items[i]))];
        if (ids.length !== 1) return [];
        const concept = ids[0] === source ? sourceRole : targetRole;
        origins.anchors[entry.key] = indices;
        return [{ key: entry.key, items: indices.map(i => entry.items[i]), concepts: [concept] }];
      });
      if (![sourceRole, targetRole].every(role => scopedAnchors.some(entry => entry.concepts.includes(role)))) continue;
      // A repeated mention denotes one endpoint; it does not multiply the assignment.
      scopedAnchors.forEach(entry => { entry.items = [entry.items[0]]; });
      scopes.push({ kind, origins,
        ...(source === prior.source.id && target === prior.target.id && !outcomes.length ? { restates: prior.moment } : {}),
        evidence: {
        currentAnchors: { [sourceRole]: [source], [targetRole]: [target] },
        values: { [valueRole]: [literal], ...(outcomes.length ? { outcome: outcomes.flatMap(entry => [...entry.items]) } : {}) },
        authoredCurrentAnchors: scopedAnchors,
        authoredValues: [{ key: valueEntry.key, concepts: [valueRole], items: [literal] }, ...outcomes],
        currentForest: evidence.currentForest
      } });
    }
  }
  return scopes;
}
