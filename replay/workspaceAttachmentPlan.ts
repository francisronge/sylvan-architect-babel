import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { retainCurrentRootFork } from './currentRootFork.ts';
import { retainCurrentSiblingRanks, retainCurrentUnaryRows } from './currentSiblingRanks.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { siblingContoursOrdered } from './siblingContours.ts';
import { sourceSiblingTranslation, unchangedSourceRankOffsets } from './sourceSiblingTranslation.ts';
import { layoutSyntaxTree, type TreeCoordinateReservation, type TreeDirection } from './treeLayout.ts';
import type { PlaybackStep } from './types.ts';
import { visibleChildIds, visibleParentId } from './visibleComponent.ts';

type Node = d3.HierarchyPointNode<SyntaxNode>;
type Reservations = ReadonlyMap<SyntaxNode, TreeCoordinateReservation>;
export type WorkspaceAttachmentScene = {
  step: PlaybackStep;
  canvas: SyntaxNode;
  size: [number, number];
  nodes: Map<string, Node>;
  coordinates: TreeCoordinateReservation;
};

export type WorkspaceAttachmentPolicy = {
  allowOrdinary: boolean;
  progressive?: boolean;
  preserveShape?: boolean;
  preserveSourceClearance?: boolean;
};

/** `node.ancestors().some(ancestor => getNodeId(ancestor) === id)`, without the array. */
function hasAncestor(node: Node, id: string): boolean {
  for (let ancestor: Node | null = node; ancestor; ancestor = ancestor.parent) if (getNodeId(ancestor) === id) return true;
  return false;
}

function lowerWitnesses(step: PlaybackStep): Map<string, string> | null {
  const witnesses = new Map<string, string>();
  for (const link of step.replayRelationLinks ?? []) {
    if (!String(link.authoredRelationKey ?? '').startsWith(`${step.replayFrameIndex}:`)) continue;
    if (!link.priorSourceNodeId || !link.witnessNodeId || link.priorSourceNodeId === link.witnessNodeId) continue;
    const old = witnesses.get(link.priorSourceNodeId);
    if (old && old !== link.witnessNodeId) return null;
    witnesses.set(link.priorSourceNodeId, link.witnessNodeId);
  }
  return witnesses;
}

/** Propose coordinates over each unchanged attachment lifetime. The caller
 * chooses the policy and validates the complete plan before accepting it.
 * With `orderedContours`, a lifetime ends before the first scene in which its
 * members would interleave with a sister subtree. */
export function reserveAttachmentLifetimes({
  scenes, direction, ordinaryRoots, stableRoots, base, orderedContours = false,
  policy: { allowOrdinary, progressive = false, preserveShape = true, preserveSourceClearance = false }
}: {
  scenes: readonly WorkspaceAttachmentScene[];
  direction: TreeDirection;
  ordinaryRoots: ReadonlySet<string>;
  stableRoots: ReadonlySet<string>;
  base?: Reservations;
  orderedContours?: boolean;
  policy: WorkspaceAttachmentPolicy;
}): Reservations {
  const output = new Map(scenes.map(scene => [scene.canvas, new Map(base?.get(scene.canvas) ?? scene.coordinates)]));
  for (let boundary = 1; boundary < scenes.length; boundary++) {
    const before = scenes[boundary - 1], after = scenes[boundary];
    const positioned = (scene: WorkspaceAttachmentScene): Map<string, Node> => {
      const root = d3.hierarchy(scene.canvas); applyVizIds(root);
      const visible = new Set(scene.nodes.keys());
      return new Map<string, Node>(layoutSyntaxTree(root, scene.size, direction, output.get(scene.canvas), visible).descendants()
        .filter(node => visible.has(getNodeId(node))).map(node => [getNodeId(node), node] as const));
    };
    const beforeNodes = progressive ? positioned(before) : before.nodes;
    const afterNodes = progressive ? positioned(after) : after.nodes;
    const roots = [...beforeNodes.values()].filter(node => !visibleParentId(node, beforeNodes));
    if (roots.length < 2) continue;
    const witnesses = lowerWitnesses(after.step);
    if (!witnesses) continue;

    for (const root of roots) {
      const rootId = getNodeId(root), attached = afterNodes.get(rootId);
      const relationAttachment = !allowOrdinary && after.step.replayFrameIndex !== before.step.replayFrameIndex
        && after.step.replayKind === 'relation' && root.children?.length;
      const ordinary = allowOrdinary && (progressive ? ordinaryRoots : stableRoots).has(rootId) && after.step.replayKind === 'micro';
      if (!relationAttachment && !ordinary) continue;
      if (witnesses.has(rootId) || !attached || !visibleParentId(attached, after.nodes)) continue;
      const members: Node[] = root.descendants().filter(node => before.nodes.has(getNodeId(node)));
      const ids = new Set<string>(members.map(getNodeId));
      const mapped = (id: string) => witnesses.get(id) ?? id;
      const targetIds = new Set<string>(members.map(node => mapped(getNodeId(node))));
      if (targetIds.size !== ids.size) continue;
      const shapeMatches = members.every(node => {
        const other = after.nodes.get(mapped(getNodeId(node)));
        if (!other) return false;
        const children = visibleChildIds(node, before.nodes).map(mapped), next = visibleChildIds(other, after.nodes);
        return children.length === next.length && children.every((id, index) => id === next[index]);
      });
      if (!shapeMatches) continue;
      const dx = attached.x - root.x, dy = attached.y - root.y;
      if (relationAttachment && !ordinary && Math.hypot(dx, dy) < 1e-7) continue;
      const positions: TreeCoordinateReservation = new Map(members.map(node => {
        const future = afterNodes.get(mapped(getNodeId(node)))!;
        return [getNodeId(node), preserveShape ? { x: node.x + dx, y: node.y + dy } : { x: future.x, y: future.y }];
      }));

      const applyLifetime = (start: number, increment: number, useWitnesses: boolean) => {
        const currentIds = new Map(members.map(node => [getNodeId(node), useWitnesses ? mapped(getNodeId(node)) : getNodeId(node)]));
        let lifetimePositions = new Map(positions), referenceNodes = after.nodes;
        // Both follow currentIds, which only witness renaming changes.
        const rootParent = ordinary && useWitnesses ? visibleParentId(attached, after.nodes) : undefined;
        const currentMembers = () => ({ memberIds: new Set(currentIds.values()),
          expectedParents: new Map(members.map(node => [currentIds.get(getNodeId(node))!,
            node === root ? rootParent : currentIds.get(getNodeId(node.parent!))])) });
        let { memberIds, expectedParents } = currentMembers();
        for (let index = start; index >= 0 && index < scenes.length; index += increment) {
          const scene = scenes[index];
          if (ordinary && useWitnesses && scene.step.replayFrameIndex !== after.step.replayFrameIndex) break;
          if (progressive && ordinary && useWitnesses) {
            const nextWitnesses = lowerWitnesses(scene.step);
            if (!nextWitnesses) break;
            currentIds.forEach((id, original) => { const witness = nextWitnesses.get(id); if (witness) currentIds.set(original, witness); });
            ({ memberIds, expectedParents } = currentMembers());
          }
          const present = [...memberIds].filter(id => scene.nodes.has(id));
          if (!present.length) break;
          const compatible = present.every(id => {
            const node = scene.nodes.get(id)!, parent = visibleParentId(node, scene.nodes);
            if (!progressive) return (ordinary && id === rootId ? parent === expectedParents.get(id) : (!parent || id === mapped(rootId) || parent === expectedParents.get(id)))
              && visibleChildIds(node, scene.nodes).every(child => memberIds.has(child));
            return ordinary && !useWitnesses
              ? (!parent || memberIds.has(parent))
              : (!parent || id === currentIds.get(rootId) || parent === expectedParents.get(id))
                && (ordinary || visibleChildIds(node, scene.nodes).every(child => memberIds.has(child)));
          });
          if (!compatible) break;
          const coordinates = new Map(output.get(scene.canvas)!);
          const relocated = new Set<string>();
          if (progressive && ordinary && !useWitnesses) for (const id of present) {
            const node = scene.nodes.get(id)!, future = referenceNodes.get(id), parent = visibleParentId(node, scene.nodes);
            if (parent && future && !hasAncestor(future, parent)) {
              node.each(descendant => relocated.add(getNodeId(descendant)));
            }
          }
          for (const [oldId, position] of lifetimePositions) {
            const id = currentIds.get(oldId)!;
            if (!scene.nodes.has(id) || relocated.has(id)) continue;
            coordinates.set(id, { x: direction === 'rtl' ? scene.size[0] - position.x : position.x, y: position.y });
          }
          // A future landing must not pull a source out of its current parent.
          // Retain its current sister clearance; an identical complete source
          // may also share the reference occurrence's internal rank grid.
          const sourceTranslations = new Map<string, { x: number; y: number } | undefined>();
          const sourceRanks = new Map<string, ReadonlyMap<string, number> | undefined>();
          for (const id of relocated) {
            const node = scene.nodes.get(id);
            const anchor = node?.ancestors().slice(1).find(ancestor => lifetimePositions.has(getNodeId(ancestor)) && !relocated.has(getNodeId(ancestor)));
            const position = anchor && lifetimePositions.get(getNodeId(anchor));
            if (!node || !anchor || !position) continue;
            const movedRoot = node.ancestors().find(current => current.parent === anchor);
            const futureRoot = movedRoot && referenceNodes.get(getNodeId(movedRoot));
            const futureParent = futureRoot?.parent;
            const futurePoint = lifetimePositions.get(id), parentPoint = futureParent && lifetimePositions.get(getNodeId(futureParent));
            const sameBranch = movedRoot && futureRoot && JSON.stringify(visibleChildIds(movedRoot, scene.nodes)) === JSON.stringify(visibleChildIds(futureRoot, referenceNodes));
            if (preserveSourceClearance && movedRoot && !sourceTranslations.has(getNodeId(movedRoot))) {
              sourceTranslations.set(getNodeId(movedRoot), sourceSiblingTranslation(
                movedRoot, anchor, scene.nodes, lifetimePositions, relocated));
            }
            const translation = movedRoot && sourceTranslations.get(getNodeId(movedRoot));
            const x = translation ? node.x + translation.x
              : position.x + (sameBranch && futurePoint && parentPoint ? futurePoint.x - parentPoint.x : node.x - anchor.x);
            if (translation && movedRoot && !sourceRanks.has(getNodeId(movedRoot))) {
              sourceRanks.set(getNodeId(movedRoot), unchangedSourceRankOffsets(
                movedRoot, scene.nodes, referenceNodes, lifetimePositions));
            }
            const rankOffset = movedRoot && sourceRanks.get(getNodeId(movedRoot))?.get(id);
            const y = translation ? (rankOffset === undefined ? node.y : movedRoot!.y + rankOffset) + translation.y
              : position.y + (sameBranch && futurePoint && parentPoint ? futurePoint.y - parentPoint.y : node.y - anchor.y);
            coordinates.set(id, { x: direction === 'rtl' ? scene.size[0] - x : x, y });
          }
          if (ordinary && progressive && !useWitnesses) {
            const current = { nodes: scene.nodes, visible: new Set(scene.nodes.keys()), coordinates };
            const future = { nodes: referenceNodes, visible: new Set(referenceNodes.keys()), coordinates: lifetimePositions };
            // A later wrapper, whether constructed or movement-owned,
            // cannot deepen a current daughter while its sister stays put.
            // Carry the corrected rank back through its construction life.
            retainCurrentSiblingRanks(current, future, undefined, relocated);
            retainCurrentRootFork(current, future);
            // Future rows reserved for later insertions must not stretch a
            // current unary branch.
            retainCurrentUnaryRows(current, future);
          }
          if (ordinary || orderedContours) {
            const hierarchy = d3.hierarchy(scene.canvas); applyVizIds(hierarchy);
            const visible = new Set(scene.nodes.keys());
            const placed = layoutSyntaxTree(hierarchy, scene.size, direction, coordinates, visible).descendants()
              .filter(node => visible.has(getNodeId(node)));
            const valid = !ordinary || placed.every(node => {
              if (node.parent && visible.has(getNodeId(node.parent)) && node.y <= node.parent.y) return false;
              const children = (node.children ?? []).filter(child => visible.has(getNodeId(child)));
              // A daughter outside the component keeps its own row while the
              // lifetime moves its parent and sisters; sisters share one row.
              if (children.some(child => Math.abs(child.y - children[0].y) > 1e-6)) return false;
              return children.slice(1).every((child, index) => direction === 'rtl'
                ? children[index].x > child.x : children[index].x < child.x);
            });
            if (!valid || orderedContours && !siblingContoursOrdered(placed, direction)) break;
            if (ordinary && progressive && !useWitnesses) {
              referenceNodes = new Map(placed.map(node => [getNodeId(node), node] as const));
              lifetimePositions = new Map([...referenceNodes].filter(([id]) => memberIds.has(id))
                .map(([id, node]) => [id, { x: node.x, y: node.y }]));
            }
          }
          output.set(scene.canvas, coordinates);
        }
      };
      applyLifetime(boundary - 1, -1, false);
      if (preserveShape) applyLifetime(boundary, 1, true);
    }
  }
  return output;
}
