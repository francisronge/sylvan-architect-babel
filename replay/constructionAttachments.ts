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

/** An existing occurrence can acquire a new child without acquiring a new ID.
 * Replacing one child by a fresh wrapper around that child belongs to the
 * wrapper's construction, rather than reconstructing its unchanged context. */
export function constructionAttachmentUpdates(
  previousForest: readonly SyntaxNode[],
  currentForest: readonly SyntaxNode[]
): Set<string> {
  const previous = indexForest(previousForest);
  const updates = new Set<string>();
  for (const [id, current] of indexForest(currentForest)) {
    const old = previous.get(id);
    const oldChildren = childIds(old);
    if (!old || !oldChildren.length) continue;
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
 * under its own new children. Construction waits for that regrouping, which
 * completes when the first of those new children is built. */
export function regroupingParents(
  previousForest: readonly SyntaxNode[],
  currentForest: readonly SyntaxNode[]
): Set<string> {
  const previous = indexForest(previousForest), current = indexForest(currentForest);
  const parents = new Set<string>();
  for (const [id, node] of current) {
    const dissolved = childIds(previous.get(id)).filter(child => child && !current.has(child));
    if (dissolved.length && dissolved.every(child => {
      const material = childIds(previous.get(child)).filter(grandchild => current.has(grandchild));
      return material.length > 0 && material.every(grandchild => contains(node, grandchild));
    })) parents.add(id);
  }
  return parents;
}

/** Until a regrouping parent's first new child is built, draw the parent with
 * its preceding children: the dissolved child returns, holding its surviving
 * material, and the new children wait. Every other node keeps its place. */
export function restoreRegroupedConstituents(
  currentForest: readonly SyntaxNode[],
  previousForest: readonly SyntaxNode[],
  pendingParentIds: ReadonlySet<string>
): SyntaxNode[] {
  if (!pendingParentIds.size) return currentForest as SyntaxNode[];
  const current = indexForest(currentForest), previous = indexForest(previousForest);
  const restoredChildren = new Map<string, SyntaxNode[]>();
  for (const id of pendingParentIds) {
    const old = previous.get(id);
    if (!old || !current.has(id)) continue;
    restoredChildren.set(id, childIds(old).flatMap(childId => {
      const kept = current.get(childId);
      if (kept) return [kept];
      const dissolved = previous.get(childId);
      if (!dissolved) return [];
      const material = childIds(dissolved).flatMap(grandchildId => current.get(grandchildId) ?? []);
      return material.length ? [{ ...dissolved, children: material }] : [];
    }));
  }
  const clone = (node: SyntaxNode): SyntaxNode => {
    const children = restoredChildren.get(node.id || '') ?? node.children;
    return children ? { ...node, children: children.map(clone) } : { ...node };
  };
  return currentForest.map(clone);
}

/** A preceding root the stage dissolves keeps each preceding child whose
 * current parent is still waiting for its construction step (`pendingParentIds`),
 * so that material stays where it was until the merge that takes it, and the
 * root leaves with its last such child. A dissolved child holds its own
 * material the same way. A held child brings its current material and leaves
 * its waiting parent meanwhile; nothing else moves. Only roots in `shownIds`
 * are held. */
export function holdDissolvedRoots(
  currentForest: readonly SyntaxNode[],
  previousForest: readonly SyntaxNode[],
  pendingParentIds: ReadonlySet<string>,
  shownIds: ReadonlySet<string>
): SyntaxNode[] {
  const current = indexForest(currentForest);
  const parentOf = new Map<string, string>();
  current.forEach((node, id) => node.children?.forEach(child => { if (child.id) parentOf.set(child.id, id); }));
  const isHeld = (id: string) => current.has(id) && pendingParentIds.has(parentOf.get(id) || '');
  const holds = (old: SyntaxNode): boolean => (old.children || []).some(child => child.id
    && (current.has(child.id) ? isHeld(child.id) : holds(child)));
  const roots = previousForest.filter(root => root.id && !current.has(root.id) && shownIds.has(root.id) && holds(root));
  if (!roots.length) return currentForest as SyntaxNode[];
  const held = new Set<string>();
  const collect = (old: SyntaxNode) => (old.children || []).forEach(child => {
    if (!child.id) return;
    if (!current.has(child.id)) collect(child);
    else if (isHeld(child.id)) held.add(child.id);
  });
  roots.forEach(collect);
  const release = (node: SyntaxNode): SyntaxNode => node.children
    ? { ...node, children: node.children.filter(child => !held.has(child.id || '')).map(release) } : { ...node };
  const hold = (old: SyntaxNode): SyntaxNode[] => {
    const { children: _children, ...material } = old;
    const children = (old.children || []).flatMap(child => !child.id ? []
      : !current.has(child.id) ? hold(child) : held.has(child.id) ? [release(current.get(child.id)!)] : []);
    return children.length ? [{ ...material, children }] : [];
  };
  return [...roots.flatMap(hold), ...currentForest.map(release)];
}
