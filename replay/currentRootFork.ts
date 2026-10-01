import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { getNodeId } from './displayIdentity.ts';
import type { TreeCoordinateReservation } from './treeLayout.ts';

type Scene = {
  nodes: ReadonlyMap<string, d3.HierarchyPointNode<SyntaxNode>>;
  visible: ReadonlySet<string>;
  coordinates: ReadonlyMap<string, { x: number; y: number }>;
};

/** A growing root can reuse its ID above a newly inserted fork. Before that
 * insertion, its complete daughter list still belongs to the earlier root.
 * Keep that root at the fork's height without moving the daughters. Restrict
 * this to visible roots: moving an internal parent would alter its incoming
 * branch and its spacing from sisters. */
export function retainCurrentRootFork(current: Scene & { coordinates: TreeCoordinateReservation }, future: Scene): void {
  const visible = (scene: Scene, node: d3.HierarchyPointNode<SyntaxNode>) =>
    scene.visible.has(getNodeId(node)) && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace';
  for (const [id, node] of current.nodes) {
    if (!visible(current, node) || (node.parent && visible(current, node.parent))) continue;
    const children = (node.children ?? []).filter(child => visible(current, child));
    if (children.length < 2) continue;
    const laterChildren = children.map(child => future.nodes.get(getNodeId(child)));
    const fork = laterChildren[0]?.parent;
    if (!fork || !visible(future, fork) || getNodeId(fork) === id || current.visible.has(getNodeId(fork))) continue;
    const ancestors = fork.ancestors().slice(1), ownerIndex = ancestors.findIndex(ancestor => getNodeId(ancestor) === id);
    if (ownerIndex < 0 || ancestors.slice(0, ownerIndex).some(ancestor => visible(current, ancestor))) continue;
    const daughters = (fork.children ?? []).filter(child => visible(future, child));
    if (daughters.length !== children.length || laterChildren.some((child, index) => child !== daughters[index])) continue;
    const forkPoint = future.coordinates.get(getNodeId(fork)), point = current.coordinates.get(id);
    if (!forkPoint || !point) continue;
    const heights = children.map(child => {
      const old = current.coordinates.get(getNodeId(child)), next = future.coordinates.get(getNodeId(child));
      return old && next ? old.y - (next.y - forkPoint.y) : NaN;
    });
    const y = heights[0];
    if (!Number.isFinite(y) || y <= point.y + 1e-8 || heights.some(height => !Number.isFinite(height) || Math.abs(height - y) > 1e-8)
      || children.some(child => y >= current.coordinates.get(getNodeId(child))!.y)) continue;
    current.coordinates.set(id, { ...point, y });
  }
}
