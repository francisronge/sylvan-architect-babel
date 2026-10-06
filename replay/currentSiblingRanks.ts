import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { getNodeId } from './displayIdentity.ts';
import { visibleComponentNodes } from './visibleComponent.ts';
import type { TreeCoordinateReservation } from './treeLayout.ts';

type Scene = {
  nodes: ReadonlyMap<string, d3.HierarchyPointNode<SyntaxNode>>;
  visible: ReadonlySet<string>;
};
const syntaxParent = (node: d3.HierarchyPointNode<SyntaxNode>) => node.ancestors().slice(1).find(ancestor =>
  !ancestor.data.replayLayoutOnly && ancestor.data.replayOrigin?.kind !== 'workspace');

/** An unbuilt wrapper cannot deepen just one current daughter. Retain the
 * unaffected sister's rank and translate the wrapped subtree as a unit. Both
 * stage-local and cross-stage reservations must preserve this current fork. */
export function retainCurrentSiblingRanks(current: Scene & { coordinates: TreeCoordinateReservation },
  future: Scene, retained: ReadonlyMap<string, { x: number; y: number }> = new Map(),
  relocated: ReadonlySet<string> = new Set(), pendingWrappers?: ReadonlySet<string>): void {
  const { coordinates } = current;
  const visibleNodes = new Map([...current.nodes].filter(([id]) => current.visible.has(id)));
  current.nodes.forEach(parent => {
    if (parent.data.replayLayoutOnly || parent.data.replayOrigin?.kind === 'workspace'
      || !current.visible.has(getNodeId(parent))) return;
    const children = (parent.children ?? []).filter(child =>
      !child.data.replayLayoutOnly && current.visible.has(getNodeId(child)));
    const sister = children.find(child => {
      const other = future.nodes.get(getNodeId(child));
      return other && syntaxParent(other) && getNodeId(syntaxParent(other)!) === getNodeId(parent);
    });
    if (!sister) return;
    const rank = (retained.get(getNodeId(sister)) ?? coordinates.get(getNodeId(sister)))!.y;
    for (const child of children) {
      const other = future.nodes.get(getNodeId(child));
      if (!other || relocated.has(getNodeId(child))) continue;
      const ancestry = other.ancestors().slice(1).filter(ancestor =>
        !ancestor.data.replayLayoutOnly && ancestor.data.replayOrigin?.kind !== 'workspace');
      const parentIndex = ancestry.findIndex(ancestor => getNodeId(ancestor) === getNodeId(parent));
      if (parentIndex < 1 || (pendingWrappers
        && !ancestry.slice(0, parentIndex).some(ancestor => pendingWrappers.has(getNodeId(ancestor))))) continue;
      const delta = rank - coordinates.get(getNodeId(child))!.y;
      for (const descendant of visibleComponentNodes(child, visibleNodes)) {
        const id = getNodeId(descendant), point = coordinates.get(id);
        if (point) coordinates.set(id, { ...point, y: point.y + delta });
      }
    }
  });
}

/** A unary edge keeps its current rank until an unseen wrapper is inserted.
 * Apply this after contour reservation: changing a rank must not change the
 * contour solver's coordinate lifetimes or the completed tree's width. */
export function retainCurrentUnaryRank(current: Scene & { coordinates: TreeCoordinateReservation }, future: Scene): void {
  const { coordinates } = current;
  const visibleNodes = new Map([...current.nodes].filter(([id]) => current.visible.has(id)));
  current.nodes.forEach(parent => {
    if (parent.data.replayLayoutOnly || parent.data.replayOrigin?.kind === 'workspace'
      || !current.visible.has(getNodeId(parent))) return;
    const children = (parent.children ?? []).filter(child =>
      !child.data.replayLayoutOnly && current.visible.has(getNodeId(child)));
    if (children.length !== 1) return;
    const child = children[0], other = future.nodes.get(getNodeId(child));
    if (!other) return;
    const ancestry = other.ancestors().slice(1).filter(ancestor =>
      !ancestor.data.replayLayoutOnly && ancestor.data.replayOrigin?.kind !== 'workspace');
    const parentIndex = ancestry.findIndex(ancestor => getNodeId(ancestor) === getNodeId(parent));
    if (parentIndex < 1 || ancestry.slice(0, parentIndex).some(ancestor => current.visible.has(getNodeId(ancestor)))) return;
    const parentPoint = coordinates.get(getNodeId(parent))!, childPoint = coordinates.get(getNodeId(child))!;
    const gap = child.y - parent.y;
    const delta = parentPoint.y + gap - childPoint.y;
    if (!Number.isFinite(gap) || gap <= 0 || delta >= -1e-8) return;
    for (const descendant of visibleComponentNodes(child, visibleNodes)) {
      const id = getNodeId(descendant), point = coordinates.get(id);
      if (point) coordinates.set(id, { ...point, y: point.y + delta });
    }
  });
}
