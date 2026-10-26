import type { SyntaxNode } from '../../types.ts';

/** An occurrence is usable only when its ID is unique within the authored stage. */
export const indexMovementOccurrences = (forest: readonly SyntaxNode[]) => {
  const nodes = new Map<string, SyntaxNode>();
  const parents = new Map<string, SyntaxNode>();
  const duplicates = new Set<string>();
  const visit = (node: SyntaxNode, parent?: SyntaxNode) => {
    if (nodes.has(node.id)) duplicates.add(node.id);
    nodes.set(node.id, node);
    if (parent) parents.set(node.id, parent);
    node.children?.forEach(child => visit(child, node));
  };
  forest.forEach(node => visit(node));
  return { nodes, parents, duplicates };
};

type Occurrences = ReturnType<typeof indexMovementOccurrences>;

/** Rebuilt parents require unchanged ordered sisters. Shared lineage or unary
 * similarity alone cannot identify the preceding source's structural slot. */
export const sameMovementSourceSlot = (
  current: Occurrences, prior: Occurrences, sourceId: string, priorId: string
): boolean => {
  const oldParent = prior.parents.get(priorId), lowerParent = current.parents.get(sourceId);
  if (!oldParent || !lowerParent || prior.duplicates.has(oldParent.id) || current.duplicates.has(lowerParent.id)) return false;
  const slot = oldParent.children!.findIndex(node => node.id === priorId);
  if (slot !== lowerParent.children!.findIndex(node => node.id === sourceId)) return false;
  if (oldParent.id === lowerParent.id) return true;
  return !current.nodes.has(oldParent.id) && !prior.nodes.has(lowerParent.id)
    && oldParent.label === lowerParent.label
    && oldParent.children!.length > 1 && oldParent.children!.length === lowerParent.children!.length
    && oldParent.children!.every((sibling, i) => i === slot || (
      !prior.duplicates.has(sibling.id) && !current.duplicates.has(sibling.id)
      && JSON.stringify(sibling) === JSON.stringify(lowerParent.children![i])
    ));
};

/** A continuing occurrence can declare its lineage when the first copy is
 * introduced. Its stable ID and exact preceding slot supply identity; an
 * already declared, conflicting lineage can never be overwritten. Either
 * occurrence may keep the ID: the source left in place, or the landing, with
 * a fresh lower occurrence of the same new lineage in the exact slot the
 * preceding occurrence held. */
export const hasMovementPriorIdentity = (
  current: Occurrences, prior: Occurrences, sourceId: string, priorId: string
): boolean => {
  const source = current.nodes.get(sourceId), before = prior.nodes.get(priorId);
  if (!source?.lineageId || !before || current.duplicates.has(sourceId) || prior.duplicates.has(priorId)) return false;
  if (before.lineageId !== undefined) return before.lineageId === source.lineageId;
  if ([...prior.nodes.values()].some(node => node.lineageId === source.lineageId)) return false;
  if (!sameMovementSourceSlot(current, prior, sourceId, priorId)) return false;
  if (sourceId === priorId) return true;
  const kept = current.nodes.get(priorId);
  return Boolean(kept) && !current.duplicates.has(priorId) && kept!.lineageId === source.lineageId;
};

export const containsOccurrence = (node: SyntaxNode, id: string): boolean => node.id === id
  || Boolean(node.children?.some(child => containsOccurrence(child, id)));

/** Identify the moving root before interpreting an anchored member or trace.
 * The exact lower slot and distinct anchored landing share root lineage; a
 * previously untagged root retains identity through its persistent lower ID.
 * Earlier unchanged copies cannot compete as new landings. */
export const sourceOccurrencePair = (
  current: Occurrences, prior: Occurrences, priorId: string, anchors: readonly string[]
): { source: SyntaxNode; landing: SyntaxNode } | undefined => {
  const before = prior.nodes.get(priorId);
  if (!before || prior.duplicates.has(priorId)) return;
  const lineage = before.lineageId ?? current.nodes.get(priorId)?.lineageId;
  if (!lineage || before.lineageId === undefined && !hasMovementPriorIdentity(current, prior, priorId, priorId)) return;
  const related = anchors.filter(id => !current.duplicates.has(id)
    && current.nodes.get(id)?.lineageId === lineage);
  const lower = related.filter(id => sameMovementSourceSlot(current, prior, id, priorId));
  if (lower.length !== 1) return;
  const source = current.nodes.get(lower[0])!;
  const landing = related.filter(id => id !== source.id
    && !containsOccurrence(source, id) && !containsOccurrence(current.nodes.get(id)!, source.id)
    && !(sameMovementSourceSlot(current, prior, id, id)
      && JSON.stringify(current.nodes.get(id)) === JSON.stringify(prior.nodes.get(id))));
  return landing.length === 1 ? { source, landing: current.nodes.get(landing[0])! } : undefined;
};

/** An extra source anchor can name the containing object without identifying
 * another moving root. Its retained path must still contain the exact lower
 * replacement proved independently for the moving occurrence. */
export const retainedSourceContainer = (
  current: Occurrences, prior: Occurrences, containerId: string,
  priorSourceId: string, lowerSourceId: string, allowWrappedRoot = false
): boolean => {
  const before = prior.nodes.get(containerId), after = current.nodes.get(containerId);
  const currentParent = current.parents.get(containerId);
  const retainedPosition = sameMovementSourceSlot(current, prior, containerId, containerId)
    || allowWrappedRoot && !prior.parents.has(containerId) && (!currentParent || !prior.nodes.has(currentParent.id));
  if (!before || !after || containerId === priorSourceId
    || prior.duplicates.has(containerId) || current.duplicates.has(containerId)
    || before.label !== after.label || before.lineageId !== after.lineageId
    || Boolean(before.lineageId && before.lineageId === prior.nodes.get(priorSourceId)?.lineageId)
    || !retainedPosition) return false;
  let old = prior.nodes.get(priorSourceId), lower = current.nodes.get(lowerSourceId);
  while (old && lower && old.id !== containerId) {
    const oldParent = prior.parents.get(old.id), lowerParent = current.parents.get(lower.id);
    if (!oldParent || !lowerParent || oldParent.id !== lowerParent.id
      || prior.duplicates.has(oldParent.id) || current.duplicates.has(lowerParent.id)
      || oldParent.label !== lowerParent.label || oldParent.lineageId !== lowerParent.lineageId
      || oldParent.children!.findIndex(node => node.id === old!.id)
        !== lowerParent.children!.findIndex(node => node.id === lower!.id)) return false;
    old = oldParent;
    lower = lowerParent;
  }
  return old?.id === containerId && lower?.id === containerId;
};

/** After a unique root pair is proved, nested witnesses can describe one lower
 * occurrence. A retained containing object is context only when it has no
 * independent moving pair; siblings and unrelated witnesses remain competing. */
export const resolveMovementSourceAnchors = (
  current: Occurrences, prior: Occurrences, priorSourceId: string,
  source: SyntaxNode, anchors: readonly string[],
  sources: readonly string[], witnesses: readonly string[], containers: readonly string[]
): { witnesses: string[] } | undefined => {
  if (sources.length === 1 && sources[0] === source.id && witnesses.length <= 1) return;
  if (!sources.length || sources.some(id => id !== source.id
    && !(witnesses.includes(id) && containsOccurrence(source, id))
    && !(containers.includes(id) && retainedSourceContainer(current, prior, id, priorSourceId, source.id, true)
      && !sourceOccurrencePair(current, prior, id, anchors)))) return;
  if (witnesses.some(id => current.duplicates.has(id) || !containsOccurrence(source, id))) return;
  const innermost = witnesses.filter(id => witnesses.every(other => {
    const container = current.nodes.get(other);
    return Boolean(container && containsOccurrence(container, id));
  }));
  if (witnesses.length && innermost.length !== 1) return;
  return { witnesses: [...innermost] };
};
