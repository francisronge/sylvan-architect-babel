import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { getNodeId } from './displayIdentity.ts';

/** The renderer's camera carry (carryCamera in components/treeViewport.ts): the
 * median shift of shared syntax whose shared ancestors are unchanged. A moved or
 * reattached constituent is left out unless nothing else is shared. */
export function carriedShift(before: ReadonlyMap<string, d3.HierarchyPointNode<SyntaxNode>>, after: ReadonlyMap<string, d3.HierarchyPointNode<SyntaxNode>>) {
  const parentOf = (nodes: typeof before, id: string) => {
    const parent = nodes.get(id)!.parent;
    return parent && nodes.has(getNodeId(parent)) ? getNodeId(parent) : null;
  };
  const sharedAncestors = (nodes: typeof before, id: string) => {
    const ids: string[] = [];
    for (let parent = parentOf(nodes, id); parent; parent = parentOf(nodes, parent)) if (before.has(parent) && after.has(parent)) ids.push(parent);
    return ids.join(' ');
  };
  const shared = [...before.keys()].filter(id => after.has(id));
  const unmoved = shared.filter(id => sharedAncestors(before, id) === sharedAncestors(after, id));
  const reference = unmoved.length ? unmoved : shared;
  if (!reference.length) return { x: 0, y: 0 };
  const median = (values: number[]) => {
    values.sort((a, b) => a - b);
    return (values[(values.length - 1) >> 1] + values[values.length >> 1]) / 2;
  };
  return { x: median(reference.map(id => after.get(id)!.x - before.get(id)!.x)), y: median(reference.map(id => after.get(id)!.y - before.get(id)!.y)) };
}
