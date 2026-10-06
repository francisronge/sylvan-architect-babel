import type { HierarchyPointNode } from 'd3';
import type { SyntaxNode } from '../types.ts';
import { getNodeId } from './displayIdentity.ts';
import { visibleComponentNodes } from './visibleComponent.ts';
import type { TreeCoordinateReservation } from './treeLayout.ts';

type Node = HierarchyPointNode<SyntaxNode>;

/** Preserve a source's signed gap from its current sister while reserving a
 * containing workspace. A later landing or compact lower copy cannot supply
 * the contour of the source that is still present before movement. Coordinates
 * already include writing direction; the whole source receives one translation. */
export function sourceSiblingTranslation(
  source: Node, parent: Node, current: ReadonlyMap<string, Node>,
  reserved: TreeCoordinateReservation, relocated: ReadonlySet<string>
): { x: number; y: number } | undefined {
  const siblings = (parent.children ?? []).filter(sibling => sibling !== source
    && current.has(getNodeId(sibling)) && !relocated.has(getNodeId(sibling))
    && reserved.has(getNodeId(sibling)));
  const translations = siblings.filter(sibling => sibling.x !== source.x).map(sibling => {
    const members = visibleComponentNodes(sibling, current).filter(node =>
      !relocated.has(getNodeId(node)) && reserved.has(getNodeId(node)));
    const edge = sibling.x < source.x ? Math.max : Math.min;
    return {
      x: edge(...members.map(node => reserved.get(getNodeId(node))!.x)) - edge(...members.map(node => node.x)),
      y: reserved.get(getNodeId(sibling))!.y - sibling.y
    };
  });
  const translation = translations[0];
  // An n-ary fork cannot preserve conflicting clearances with one rigid move.
  return translation && translations.every(other => Math.abs(other.x - translation.x) < 1e-7
    && Math.abs(other.y - translation.y) < 1e-7) ? translation : undefined;
}

/** An unchanged complete source uses one internal rank grid on both sides of
 * its movement. Its current root slot and signed sister clearance stay separate. */
export function unchangedSourceRankOffsets(
  source: Node, current: ReadonlyMap<string, Node>, future: ReadonlyMap<string, Node>,
  reserved: TreeCoordinateReservation
): ReadonlyMap<string, number> | undefined {
  const id = getNodeId(source), nextRoot = future.get(id), rootPoint = reserved.get(id);
  if (!nextRoot || !rootPoint) return;
  const members = visibleComponentNodes(source, current);
  if (members.length !== visibleComponentNodes(nextRoot, future).length) return;
  const children = (node: Node, nodes: ReadonlyMap<string, Node>) => (node.children ?? [])
    .filter(child => nodes.has(getNodeId(child))).map(getNodeId);
  if (!members.every(member => {
    const memberId = getNodeId(member), next = future.get(memberId);
    return next && reserved.has(memberId) && member.data.label === next.data.label
      && member.data.word === next.data.word && member.data.silent === next.data.silent
      && JSON.stringify(children(member, current)) === JSON.stringify(children(next, future));
  })) return;
  return new Map(members.map(member => {
    const memberId = getNodeId(member);
    return [memberId, reserved.get(memberId)!.y - rootPoint.y];
  }));
}
