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
  return {
    allocate(preferred: string, origin: ReplayNodeOrigin) {
      const key = JSON.stringify([origin.kind, origin.ownerId, origin.authoredId, preferred]);
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

export const applyVizIds = (root: d3.HierarchyNode<SyntaxNode>) => {
  const used = new Set<string>();
  const reserved = new Set<string>();
  root.eachBefore(node => {
    [node.data.id, ...(node.data.aliasIds || [])].forEach(id => {
      if (typeof id === 'string' && id.trim()) reserved.add(id.trim());
    });
  });
  let generated = 1;
  root.eachBefore((node) => {
    const raw = typeof node.data.id === 'string' ? node.data.id.trim() : '';
    let id = raw;
    if (!id || used.has(id)) {
      while (used.has(`n${generated}`) || reserved.has(`n${generated}`)) generated += 1;
      id = `n${generated}`;
      generated += 1;
    }
    used.add(id);
    (node as any).__vizId = id;
  });
};
