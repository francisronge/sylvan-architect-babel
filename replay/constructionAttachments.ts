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
