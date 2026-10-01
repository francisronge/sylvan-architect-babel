import type { DerivationStage, SyntaxNode } from '../../types.ts';
import type { NodePlaquePlanItem, PlanRelationRef, RelationPlanItem } from './renderPlanCompiler.ts';

type Collection = {
  plaque: NodePlaquePlanItem;
  parts: RelationPlanItem[];
  slot: string;
  content: string;
  witnesses: string[];
};

const sameMoment = (left: PlanRelationRef, right: PlanRelationRef) =>
  left.stageIndex === right.stageIndex && left.relationIndex === right.relationIndex;

function uniqueOccurrences(forest: readonly SyntaxNode[]) {
  const occurrences = new Map<string, SyntaxNode | undefined>();
  const visit = (node: SyntaxNode) => {
    occurrences.set(node.id, occurrences.has(node.id) ? undefined : node);
    node.children?.forEach(visit);
  };
  forest.forEach(visit);
  return occurrences;
}

function collections(items: readonly RelationPlanItem[]): Collection[] {
  return items.flatMap(plaque => {
    if (plaque.kind !== 'node-plaque' || plaque.plaqueStyle !== 'feature'
      || plaque.tier2FacetId !== 'feature.dependency' || !plaque.tier2ClaimIdentity || !plaque.rows.length) return [];
    const parts = items.filter(item => item.tier2ClaimIdentity === plaque.tier2ClaimIdentity
      && sameMoment(item.relationRef, plaque.relationRef));
    // A collection state owns its plaque and row connectors together. A mixed
    // assignment or other claim needs its own continuity evidence.
    if (parts.some(part => part !== plaque
      && !(part.kind === 'directed-path' && part.pathStyle === 'case-agree' && part.featureRow))) return [];
    const identity = JSON.parse(plaque.tier2ClaimIdentity);
    if (identity.transitions?.length || identity.parents?.length) return [];
    const witnesses = (Object.values(identity.currentAnchors ?? {}) as Array<Array<{ id: string }>>)
      .flatMap(entries => entries.map(entry => entry.id));
    const anchors = Object.fromEntries(Object.entries(identity.currentAnchors ?? {}).map(([role, entries]) => [
      role, (entries as Array<{ id: string; lineages: string[] }>).map(({ id, lineages }) => ({ id, lineages }))
    ]));
    // Keep exact authored field names: number and person on the same pair are
    // different collections. Other accepted qualifiers and outcomes also stay
    // distinct; only the contents of the feature fields can change here.
    const { 'feature.rows': _rows, ...qualifiers } = identity.values ?? {};
    const slot = JSON.stringify({ anchors, fields: [...new Set(plaque.rows.map(row => row.label))].sort(),
      qualifiers, outcome: identity.outcome });
    return [{ plaque, parts, slot, witnesses, content: JSON.stringify(plaque.rows) }];
  });
}

/** A unique collection on retained occurrences can update its own authored
 * fields. Competing states never choose a winner, and an explicit prior block
 * remains subject to the normal complete-witness check. */
export function featureCollectionSupersessions(
  items: readonly RelationPlanItem[],
  stages: readonly DerivationStage[]
): Map<RelationPlanItem, PlanRelationRef> {
  const candidates = collections(items);
  const occurrences = stages.map(stage => uniqueOccurrences(stage.workspaceForest));
  const supersessions = new Map<RelationPlanItem, PlanRelationRef>();
  let live: Collection[] = [];
  for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
    const next = candidates.filter(collection => collection.plaque.appearsAtStage === stageIndex);
    const replacementItems = items.filter(item => item.appearsAtStage === stageIndex);
    // Respect explicit transfers already proved by lowering. Such transfers may
    // have different current participants and therefore a different slot.
    live = live.filter(previous => !replacementItems.some(item =>
      item.replacementGroup === previous.plaque.replacementGroup
      || item.replacementPredecessorGroup === previous.plaque.replacementGroup));
    const slots = new Set(next.map(collection => collection.slot));
    for (const slot of slots) {
      const updates = next.filter(collection => collection.slot === slot);
      const predecessors = live.filter(collection => collection.slot === slot);
      if (!predecessors.length || new Set(predecessors.map(item => item.content)).size !== 1
        || new Set(updates.map(item => item.content)).size !== 1
        || updates.some(item => Object.keys(item.plaque.relationRef.priorAnchors ?? {}).length)
        || updates[0].content === predecessors[0].content) continue;
      const retained = predecessors.every(previous => previous.witnesses.every(id => {
        const original = occurrences[previous.plaque.appearsAtStage].get(id);
        return original && occurrences.slice(previous.plaque.appearsAtStage, stageIndex + 1).every(stage => {
          const current = stage.get(id);
          return current && current.lineageId === original.lineageId;
        });
      }));
      if (!retained) continue;
      const moment = updates.reduce((first, item) => item.plaque.relationRef.relationIndex < first.relationIndex
        ? item.plaque.relationRef : first, updates[0].plaque.relationRef);
      predecessors.forEach(previous => previous.parts.forEach(part => supersessions.set(part, moment)));
      live = live.filter(collection => !predecessors.includes(collection));
    }
    live.push(...next);
  }
  return supersessions;
}
