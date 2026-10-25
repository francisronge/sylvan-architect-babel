import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { getNodeId } from './displayIdentity.ts';
import { isSyntheticWorkspaceRootNode } from './replayCanvas.ts';
import { isWordlessCategoryLeaf } from './replaySurfaceNotation.ts';

/** A painted terminal that is its parent's only layout child stands directly
 * below that parent. The renderer paints every Replay frame through this, so
 * planning that judges painted motion applies it too. With a visible set, only
 * pairs painted together are aligned. */
export const alignReplayUnaryTerminalLeaves = (root: d3.HierarchyPointNode<SyntaxNode>, replayVisibleNodeIdSet: ReadonlySet<string> | null) => {
  root.eachBefore((node) => {
    const children = Array.isArray(node.children) ? node.children : [];
    const layoutChildren = children.filter((child) =>
      !isSyntheticWorkspaceRootNode(child)
    );
    if (layoutChildren.length !== 1) return;
    const child = layoutChildren[0];
    if (
      replayVisibleNodeIdSet
      && (
        !replayVisibleNodeIdSet.has(getNodeId(node))
        || !replayVisibleNodeIdSet.has(getNodeId(child))
      )
    ) return;
    if (!child) return;
    if (isSyntheticWorkspaceRootNode(node) || isSyntheticWorkspaceRootNode(child)) return;
    const childHasChildren = Array.isArray(child.children) && child.children.length > 0;
    const isTerminalLeaf = !childHasChildren && !isWordlessCategoryLeaf(child.data);
    if (isTerminalLeaf) {
      child.x = node.x;
    }
  });
};
