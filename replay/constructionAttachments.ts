import type { SyntaxNode } from '../types.ts';

const childIds = (node: SyntaxNode | undefined): string[] => (node?.children || []).map(child => child.id || '');
const indexForest = (forest: readonly SyntaxNode[]): Map<string, SyntaxNode> => {
  const nodes = new Map<string, SyntaxNode>();
  const visit = (node: SyntaxNode) => {
    if (node.id) nodes.set(node.id, node);
    node.children?.forEach(visit);
  };
  forest.forEach(visit);
  return nodes;
};
const contains = (node: SyntaxNode | undefined, id: string): boolean =>
  Boolean(node && (node.id === id || node.children?.some(child => contains(child, id))));

/** An existing occurrence can acquire a new child without acquiring a new ID,
 * including a bare head that becomes a head complex. Its new children are built
 * as their own workspaces and attach at its merge step. Replacing one child by a
 * fresh wrapper around that child belongs to the wrapper's construction, rather
 * than reconstructing its unchanged context. */
export function constructionAttachmentUpdates(
  previousForest: readonly SyntaxNode[],
  currentForest: readonly SyntaxNode[]
): Set<string> {
  const previous = indexForest(previousForest);
  const updates = new Set<string>();
  for (const [id, current] of indexForest(currentForest)) {
    const old = previous.get(id);
    const oldChildren = childIds(old);
    if (!old) continue;
    const currentChildren = current.children || [];
    const carries = (child: SyntaxNode, oldId: string): boolean =>
      child.id === oldId || (!previous.has(child.id || '') && contains(child, oldId));
    const oldSlots = oldChildren.map(oldId => currentChildren.findIndex(child => carries(child, oldId)));
    if (oldSlots.some((slot, index) => slot < 0 || (index > 0 && slot < oldSlots[index - 1]))) continue;
    if (currentChildren.some(child => !oldChildren.some(oldId => carries(child, oldId)))) updates.add(id);
  }
  return updates;
}

/** A wrapper can replace an existing edge without adding a merge on its retained
 * parent. That stage still needs attachment continuity while the wrapper builds. */
export function hasConstructionWrapperInsertions(
  previousForest: readonly SyntaxNode[],
  currentForest: readonly SyntaxNode[]
): boolean {
  const previous = indexForest(previousForest);
  return Array.from(indexForest(currentForest)).some(([id, node]) => {
    const oldChildren = childIds(previous.get(id));
    return node.children?.some(child => !previous.has(child.id || '')
      && oldChildren.some(oldId => contains(child, oldId)));
  });
}

/** Hold a retained parent's old edges until its attachment step, and keep an
 * existing child attached through still-hidden wrappers. Every current node
 * remains present exactly once; unattached objects stay separate workspaces. */
export function preserveConstructionAttachments(
  currentForest: readonly SyntaxNode[],
  previousForest: readonly SyntaxNode[],
  pendingParentIds: ReadonlySet<string>,
  visibleIds: ReadonlySet<string>
): SyntaxNode[] {
  const current = indexForest(currentForest);
  const previous = indexForest(previousForest);
  const children = new Map<string, string[]>(Array.from(current, ([id, node]) => [id, childIds(node)]));
  const preservedOwners = new Map<string, string>();
  const visibleCarrier = (node: SyntaxNode, oldId: string): string => {
    if (node.id === oldId || node.id && visibleIds.has(node.id)) return node.id!;
    const branch = node.children?.find(child => contains(child, oldId));
    return branch ? visibleCarrier(branch, oldId) : oldId;
  };
  for (const [id, old] of previous) {
    const node = current.get(id);
    if (!node || !visibleIds.has(id)) continue;
    const oldChildren = childIds(old).filter(child => current.has(child));
    if (pendingParentIds.has(id)) {
      const retained = Array.from(new Set(oldChildren.map(oldId => {
        const wrapper = (node.children || []).find(child =>
          child.id && !previous.has(child.id) && contains(child, oldId));
        return wrapper ? visibleCarrier(wrapper, oldId) : oldId;
      })));
      children.set(id, retained);
      retained.forEach(child => preservedOwners.set(child, id));
      continue;
    }
    const nextChildren = children.get(id) || [];
    const retained = nextChildren.flatMap(childId => {
      if (visibleIds.has(childId) || previous.has(childId)) return [childId];
      const wrapper = current.get(childId);
      const preceding = oldChildren.filter(oldId => contains(wrapper, oldId));
      if (!preceding.length || !wrapper) return [childId];
      const carriers = Array.from(new Set(preceding.map(oldId => visibleCarrier(wrapper, oldId))));
      carriers.forEach(child => preservedOwners.set(child, id));
      return carriers;
    });
    children.set(id, retained);
  }
  for (const [parent, ids] of children) {
    children.set(parent, ids.filter(id => !preservedOwners.has(id) || preservedOwners.get(id) === parent));
  }
  const parented = new Set(Array.from(children.values()).flat());
  const clone = (id: string): SyntaxNode => {
    const { children: _children, ...material } = current.get(id)!;
    const descendants = (children.get(id) || []).filter(child => current.has(child)).map(clone);
    return descendants.length ? { ...material, children: descendants } : { ...material };
  };
  return Array.from(current.keys()).filter(id => !parented.has(id)).map(clone);
}

/** A retained parent can dissolve a child and regroup that child's material
 * under its own new children. Each regrouping parent maps to the new children
 * construction still has to build; the regrouping completes when all are built. */
export function regroupingParents(
  previousForest: readonly SyntaxNode[],
  currentForest: readonly SyntaxNode[]
): Map<string, Set<string>> {
  const previous = indexForest(previousForest), current = indexForest(currentForest);
  const parents = new Map<string, Set<string>>();
  for (const [id, node] of current) {
    const dissolved = childIds(previous.get(id)).filter(child => child && !current.has(child));
    if (dissolved.length && dissolved.every(child => {
      const material = childIds(previous.get(child)).filter(grandchild => current.has(grandchild));
      return material.length > 0 && material.every(grandchild => contains(node, grandchild));
    })) parents.set(id, new Set(childIds(node).filter(child => child && !previous.has(child))));
  }
  return parents;
}

/** Whether a regrouping parent has no new child, as when it takes a dissolved
 * child's material directly. No construction step completes its wait, so the
 * stage's completion shows the completed stage instead of the last step. */
export function hasUnreleasedRegrouping(
  previousForest: readonly SyntaxNode[],
  currentForest: readonly SyntaxNode[]
): boolean {
  return [...regroupingParents(previousForest, currentForest).values()].some(unbuilt => !unbuilt.size);
}

/** Until a regrouping parent's new children are all built, draw the parent
 * with its preceding children: each dissolved child returns, holding the
 * surviving material no built new child has taken yet, and a built new child
 * stands in the slot of the first dissolved child it takes material from.
 * Unbuilt new children wait. New syntax inside one stands as its own workspace
 * when it is wholly new or already built (`built`, the nodes constructed so
 * far), and takes its regrouped material from the dissolved children as it is
 * built. Every other node keeps its place. `pending` maps each such parent to
 * its unbuilt new children. */
export function restoreRegroupedConstituents(
  currentForest: readonly SyntaxNode[],
  previousForest: readonly SyntaxNode[],
  pending: ReadonlyMap<string, ReadonlySet<string>>,
  built: ReadonlySet<string> = new Set()
): SyntaxNode[] {
  if (!pending.size) return currentForest as SyntaxNode[];
  const current = indexForest(currentForest), previous = indexForest(previousForest);
  const restoredChildren = new Map<string, SyntaxNode[]>();
  const waiting: SyntaxNode[] = [];
  const isNew = (node: SyntaxNode): boolean => !previous.has(node.id || '');
  const whollyNew = (node: SyntaxNode): boolean => isNew(node) && (node.children || []).every(whollyNew);
  const collectWaiting = (node: SyntaxNode) => {
    if (!isNew(node)) return;
    if (whollyNew(node) || built.has(node.id || '')) waiting.push(node);
    else node.children?.forEach(collectWaiting);
  };
  for (const [id, unbuilt] of pending) {
    const old = previous.get(id), parent = current.get(id);
    if (!old || !parent) continue;
    const newChildren = (parent.children || []).filter(isNew);
    const builtChildren = newChildren.filter(child => !unbuilt.has(child.id || ''));
    const pieces = waiting.length;
    newChildren.filter(child => unbuilt.has(child.id || '')).forEach(child => child.children?.forEach(collectWaiting));
    const taken = new Set([...builtChildren, ...waiting.slice(pieces)].flatMap(subtreeIds)), placed = new Set<SyntaxNode>();
    const children = childIds(old).flatMap(childId => {
      const kept = current.get(childId);
      if (kept) return [kept];
      const dissolved = previous.get(childId);
      if (!dissolved) return [];
      const material = childIds(dissolved).filter(grandchildId => current.has(grandchildId));
      const regrouped = builtChildren.filter(child => !placed.has(child) && material.some(grandchildId => contains(child, grandchildId)));
      regrouped.forEach(child => placed.add(child));
      const remaining = material.filter(grandchildId => !taken.has(grandchildId)).map(grandchildId => current.get(grandchildId)!);
      return [...regrouped, ...remaining.length ? [{ ...dissolved, children: remaining }] : []];
    });
    restoredChildren.set(id, [...children, ...builtChildren.filter(child => !placed.has(child))]);
  }
  const clone = (node: SyntaxNode): SyntaxNode => {
    const children = restoredChildren.get(node.id || '') ?? node.children;
    return children ? { ...node, children: children.map(clone) } : { ...node };
  };
  return [...currentForest.map(clone), ...waiting.map(clone)];
}

const subtreeIds = (node: SyntaxNode | undefined): string[] =>
  node ? [node.id || '', ...(node.children || []).flatMap(subtreeIds)] : [];

/** A retained parent can replace one daughter by a new one in the same slot:
 * the replaced daughter leaves with its whole subtree and the replacement is
 * new to the stage. The replaced daughter stays until the replacement's own
 * construction step swaps it in. Maps each replacement to its parent and the
 * daughter it replaces. */
export function replacedChildren(
  previousForest: readonly SyntaxNode[],
  currentForest: readonly SyntaxNode[]
): Map<string, { parentId: string; replacedId: string }> {
  const previous = indexForest(previousForest), current = indexForest(currentForest);
  const replacements = new Map<string, { parentId: string; replacedId: string }>();
  for (const [parentId, node] of current) {
    const before = childIds(previous.get(parentId)), after = childIds(node);
    if (!before.length || before.length !== after.length) continue;
    after.forEach((childId, slot) => {
      const replacedId = before[slot];
      if (!childId || childId === replacedId || after.includes(replacedId) || before.includes(childId) || previous.has(childId)) return;
      if (subtreeIds(previous.get(replacedId)).some(id => current.has(id))) return;
      replacements.set(childId, { parentId, replacedId });
    });
  }
  return replacements;
}

/** Until a replacement is built, its parent shows the replaced daughter in
 * that slot, and the replacement's subtree stands as its own workspace. */
export function restoreReplacedChildren(
  currentForest: readonly SyntaxNode[],
  previousForest: readonly SyntaxNode[],
  pending: ReadonlyMap<string, { parentId: string; replacedId: string }>
): SyntaxNode[] {
  if (!pending.size) return currentForest as SyntaxNode[];
  const previous = indexForest(previousForest);
  const waiting: SyntaxNode[] = [];
  const copy = (node: SyntaxNode): SyntaxNode => node.children ? { ...node, children: node.children.map(copy) } : { ...node };
  const clone = (node: SyntaxNode): SyntaxNode => {
    if (!node.children) return { ...node };
    return { ...node, children: node.children.map(child => {
      const replacement = pending.get(child.id || '');
      const replaced = replacement?.parentId === node.id ? previous.get(replacement.replacedId) : undefined;
      if (!replaced) return clone(child);
      waiting.push(clone(child));
      return copy(replaced);
    }) };
  };
  const roots = currentForest.map(clone);
  return [...roots, ...waiting];
}
