import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';

export type ReplayNodeOrigin = { kind: 'word' | 'lexical' | 'workspace' | 'layout'; ownerId?: string; authoredId?: string };
export type ReplayIdentityContext = ReturnType<typeof createReplayIdentityContext>;

/** One compilation owns its allocation. Authored IDs, including future stages, are reserved first. */
export function createReplayIdentityContext(forests: readonly SyntaxNode[]) {
  const used = new Set<string>();
  const visit = (node: SyntaxNode) => {
    if (node.id) used.add(node.id);
    node.aliasIds?.forEach(id => used.add(id));
    node.children?.forEach(visit);
  };
  forests.forEach(visit);
  const allocated = new Map<string, string>();
  const keyOf = (preferred: string, origin: ReplayNodeOrigin) => JSON.stringify([origin.kind, origin.ownerId, origin.authoredId, preferred]);
  return {
    /** The id an earlier `allocate` gave this request, without allocating one. */
    allocated(preferred: string, origin: ReplayNodeOrigin): string | undefined {
      return allocated.get(keyOf(preferred, origin));
    },
    allocate(preferred: string, origin: ReplayNodeOrigin) {
      const key = keyOf(preferred, origin);
      const existing = allocated.get(key);
      if (existing) return existing;
      let id = preferred;
      let ordinal = 1;
      while (used.has(id)) id = `${preferred}::${ordinal++}`;
      used.add(id);
      allocated.set(key, id);
      return id;
    }
  };
}

export const isReplayDisplayChild = (node: SyntaxNode, ownerId: string) =>
  Boolean(ownerId && node.replayOrigin?.ownerId === ownerId);

/** An authored ID is opaque. Only an actual display node can redirect to its owner. */
export function replayOwnerId(canvas: SyntaxNode | null | undefined, id: string): string {
  let match: SyntaxNode | undefined;
  let ambiguous = false;
  const visit = (node: SyntaxNode) => {
    if (node.id === id || node.aliasIds?.includes(id)) {
      if (match && match !== node) ambiguous = true;
      match = node;
    }
    node.children?.forEach(visit);
  };
  if (canvas) visit(canvas);
  return !ambiguous && match?.id === id ? match.replayOrigin?.ownerId || id : id;
}

export const getNodeId = (node: d3.HierarchyNode<SyntaxNode>): string => (node as any).__vizId as string;

/** Whether a laid-out node is syntax the renderer paints: neither a layout-only
 * reserve nor the synthetic root that holds a workspace forest. */
export const isPaintedSyntax = (node: d3.HierarchyNode<SyntaxNode>): boolean =>
  !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace';

/** The nearest ancestor of `node` that is painted syntax, if any. */
export const paintedSyntaxParent = <N extends d3.HierarchyNode<SyntaxNode>>(node: N): N | undefined => {
  let ancestor = node.parent as N | null;
  while (ancestor && !isPaintedSyntax(ancestor)) ancestor = ancestor.parent as N | null;
  return ancestor ?? undefined;
};

export const applyVizIds = (root: d3.HierarchyNode<SyntaxNode>) => {
  const used = new Set<string>();
  const reserved = new Set<string>();
  root.eachBefore(node => {
    [node.data.id, ...(node.data.aliasIds || [])].forEach(id => {
      if (typeof id === 'string' && id.trim()) reserved.add(id);
    });
  });
  let generated = 1;
  root.eachBefore((node) => {
    const raw = typeof node.data.id === 'string' ? node.data.id : '';
    let id = raw;
    if (!id.trim() || used.has(id)) {
      while (used.has(`n${generated}`) || reserved.has(`n${generated}`)) generated += 1;
      id = `n${generated}`;
      generated += 1;
    }
    used.add(id);
    (node as any).__vizId = id;
  });
};
