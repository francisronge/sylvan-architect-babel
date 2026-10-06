import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { getNodeId } from './displayIdentity.ts';

/** Invisible future parents break current connectivity. A visible descendant
 * below one is a separate workspace, even if the canvas contains both objects. */
export function visibleComponentNodes<N extends d3.HierarchyNode<SyntaxNode>>(
  root: N, visible: ReadonlyMap<string, N>
): N[] {
  const result: N[] = [], pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (!visible.has(getNodeId(node))) continue;
    result.push(node);
    for (const child of [...(node.children ?? [])].reverse()) pending.push(child as N);
  }
  return result;
}
