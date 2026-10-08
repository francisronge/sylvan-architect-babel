import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { PlaybackStep } from './replayCompiler.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import type { PreparedTreeLabelRuns, TreeLabelMeasure } from './treeLabelRuns.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { currentWorkspaceMovements } from './currentWorkspaceMovements.ts';
import { layoutSyntaxTree, type TreeCoordinateReservation, type TreeDirection } from './treeLayout.ts';
import { prepareTreeInkSubtrees, type TreeInkTextMeasure } from './treeInkGeometry.ts';
import { currentForkBranchesClear } from './workspaceForkClearance.ts';
import { workspaceContinuityReflows } from './workspaceShapeReflows.ts';
import { verticalObstacleIndex } from './verticalObstacleIndex.ts';
import { cubicIntersectsRect } from './relations/curveClearance.ts';

type Reservations = ReadonlyMap<SyntaxNode, TreeCoordinateReservation>;
type Node = d3.HierarchyPointNode<SyntaxNode>;
const cache = new WeakMap<Reservations, Reservations>();
const epsilon = 1e-6;

/** An unbranched source replaced in its exact parent slot should not start farther out than
 * its lower occurrence. Reserve the proved compact slot throughout construction,
 * retaining current syntax and pronunciation. A receiving head may use its new
 * center, but its new children still appear only at the movement moment. */
export function retainMovementSourceSlots(steps: readonly PlaybackStep[], sizes: ReadonlyMap<number, [number, number]>,
  reserved: Reservations, direction: TreeDirection = 'ltr', measureCategoryText?: CategoryTextMeasure, measureTreeInk?: TreeInkTextMeasure,
  treeLabelRuns?: PreparedTreeLabelRuns, measureTreeLabel?: TreeLabelMeasure): Reservations {
  const cached = cache.get(reserved);
  if (cached) return cached;
  const frames = steps.flatMap(step => {
    const canvas = step.replayCanvasData, size = sizes.get(step.replayFrameIndex!);
    return canvas && size && reserved.has(canvas) ? [{ step, canvas, size, visible: new Set(step.replayVisibleNodeIds) }] : [];
  }).sort((a, b) => (a.step.replayFrameIndex! - b.step.replayFrameIndex!)
    || ((a.step.replayStageStepIndex ?? (a.step.replayKind === 'macro' ? Infinity : 0))
      - (b.step.replayStageStepIndex ?? (b.step.replayKind === 'macro' ? Infinity : 0))));
  let result = reserved;
  const scenes = new Map<number, Map<string, Node>>();
  const positioned = (index: number, coordinates: Reservations): Map<string, Node> => {
    const { canvas, size, visible } = frames[index], root = d3.hierarchy(canvas);
    applyVizIds(root);
    return new Map(layoutSyntaxTree(root, size, direction, coordinates.get(canvas), visible).descendants()
      .filter(node => visible.has(getNodeId(node)) && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace')
      .map(node => [getNodeId(node), node]));
  };
  const sceneAt = (index: number) => {
    let nodes = scenes.get(index);
    if (!nodes) { nodes = positioned(index, result); scenes.set(index, nodes); }
    return nodes;
  };
  const children = (node: Node, nodes: ReadonlyMap<string, Node>) => (node.children ?? []).filter(child => nodes.has(getNodeId(child)));
  const paintClear = (index: number, nodes: Map<string, Node>): boolean => {
    const ink = prepareTreeInkSubtrees(nodes, measureCategoryText, measureTreeInk, true,
      treeLabelRuns?.get(frames[index].canvas), measureTreeLabel);
    const groups = [[...nodes.values()].filter(node => !node.parent || !nodes.has(getNodeId(node.parent)))];
    const occupied = new Set<string>();
    for (const node of nodes.values()) {
      const point = `${node.x.toFixed(6)},${node.y.toFixed(6)}`;
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || occupied.has(point)) return false;
      occupied.add(point);
      const daughters = children(node, nodes);
      if (daughters.some((child, i) => child.y <= node.y || (i > 0
        && (direction === 'rtl' ? child.x >= daughters[i - 1].x : child.x <= daughters[i - 1].x)))) return false;
      if (daughters.length < 2) continue;
      if (!currentForkBranchesClear(node, daughters.map(child => ({ point: child,
        obstacles: ink(child).map(box => ({ ...box, x: box.x - child.x, y: box.y - child.y })) })))) return false;
      groups.push(daughters);
    }
    for (const group of groups) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const query = verticalObstacleIndex(ink(group[j]));
      for (const a of ink(group[i])) if (query(a, b =>
        Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > epsilon
        && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > epsilon
        && (!a.curve || cubicIntersectsRect(a.curve, b, a.curvePadding))
        && (!b.curve || cubicIntersectsRect(b.curve, a, b.curvePadding)))) return false;
    }
    return true;
  };
  for (let index = frames.length - 2; index >= 0; index--) {
    if (frames[index + 1].step.replayKind !== 'relation') continue;
    const movements = currentWorkspaceMovements(frames[index + 1].step, sceneAt(index), sceneAt(index + 1));
    for (const movement of movements) {
      const before = sceneAt(index), after = sceneAt(index + 1);
      const source = before.get(movement.priorSourceNodeId)!, lower = after.get(movement.witnessNodeId)!;
      if (!source.parent || !lower.parent || getNodeId(source.parent) !== getNodeId(lower.parent)
        || Math.abs(source.y - lower.y) > epsilon) continue;
      const oldChildren = children(source.parent, before).map(getNodeId), newChildren = children(lower.parent, after).map(getNodeId);
      if (oldChildren.length !== newChildren.length || oldChildren.some((id, i) =>
        (id === movement.priorSourceNodeId ? movement.witnessNodeId : id) !== newChildren[i])) continue;
      const siblings = oldChildren.filter(id => id !== movement.priorSourceNodeId);
      if (!siblings.length || !siblings.every(id => Math.hypot(before.get(id)!.x - after.get(id)!.x,
        before.get(id)!.y - after.get(id)!.y) <= epsilon)) continue;
      const span = (points: number[]) => Math.max(...points) - Math.min(...points);
      const peers = siblings.map(id => before.get(id)!.x), dx = lower.x - source.x;
      if (span([...peers, lower.x]) >= span([...peers, source.x]) - epsilon) continue;
      const sourceNodes = source.descendants().filter(node => before.has(getNodeId(node)));
      // A complete phrase has its own retained contour and receiving-host rule.
      // This slot correction concerns a head/stem chain beside unchanged syntax.
      if (sourceNodes.some(node => children(node, before).length > 1)) continue;
      const translations = new Map<string, number>(sourceNodes.map(node => [getNodeId(node), dx]));
      const owners = new Map<string, string>(sourceNodes.map(node => [getNodeId(node), movement.priorSourceNodeId]));
      const receiver = after.get(movement.targetNodeId)!.ancestors().slice(1).find(node => before.has(getNodeId(node)));
      const priorReceiver = receiver && before.get(getNodeId(receiver));
      if (receiver?.parent && priorReceiver?.parent && getNodeId(receiver.parent) === getNodeId(priorReceiver.parent)
        && Math.abs(receiver.y - priorReceiver.y) <= epsilon) {
        const members = priorReceiver.descendants().filter(node => before.has(getNodeId(node)));
        if (members.every(node => children(node, before).length <= 1 && !translations.has(getNodeId(node)))) {
          for (const node of members) {
            translations.set(getNodeId(node), receiver.x - priorReceiver.x);
            owners.set(getNodeId(node), getNodeId(priorReceiver));
          }
        }
      }
      const futureCanvases = new Set(frames.slice(index + 1).map(frame => frame.canvas));
      if (frames.slice(0, index + 1).some(frame => futureCanvases.has(frame.canvas))) continue;
      const candidate = new Map(result), candidateScenes = new Map<number, Map<string, Node>>();
      const sharedCanvases = new Map<SyntaxNode, TreeCoordinateReservation>();
      let valid = true;
      for (let earlier = index; earlier >= 0 && valid; earlier--) {
        const nodes = sceneAt(earlier), points = new Map(result.get(frames[earlier].canvas)!);
        for (const [id, shift] of translations) {
          const node = nodes.get(id), point = points.get(id);
          if (!node || !point) continue;
          const parent = node.parent && nodes.has(getNodeId(node.parent)) ? getNodeId(node.parent) : undefined;
          if (id !== owners.get(id) && parent && owners.get(parent) !== owners.get(id)) { valid = false; break; }
          points.set(id, { x: point.x + (direction === 'rtl' ? -shift : shift), y: point.y });
        }
        if (!valid) break;
        // Only ancestors of the translated components need new branch centers.
        // Every retained component keeps its complete internal coordinates.
        const changed = new Set(translations.keys());
        for (const node of [...nodes.values()].reverse()) {
          const id = getNodeId(node), daughters = children(node, nodes);
          if (translations.has(id) || !daughters.some(child => changed.has(getNodeId(child)))) continue;
          changed.add(id);
          points.set(id, { x: (points.get(getNodeId(daughters[0]))!.x + points.get(getNodeId(daughters.at(-1)!))!.x) / 2,
            y: points.get(id)!.y });
        }
        const shared = sharedCanvases.get(frames[earlier].canvas);
        if (shared && [...points].some(([id, point]) => !shared.has(id)
          || Math.hypot(point.x - shared.get(id)!.x, point.y - shared.get(id)!.y) > epsilon)) { valid = false; break; }
        sharedCanvases.set(frames[earlier].canvas, points);
        candidate.set(frames[earlier].canvas, points);
        const placed = positioned(earlier, candidate);
        candidateScenes.set(earlier, placed);
        valid = paintClear(earlier, placed);
      }
      if (!valid) continue;
      const allScenes = frames.map((frame, index) => ({ ...frame, index, nodes: sceneAt(index) }));
      const oldReflows = new Set(workspaceContinuityReflows(allScenes, result,
        scene => [...scene.nodes.values()]).map(issue => JSON.stringify(issue)));
      const reflows = workspaceContinuityReflows(allScenes, candidate,
        scene => [...(candidateScenes.get(scene.index) ?? scene.nodes).values()]);
      if (reflows.some(issue => !oldReflows.has(JSON.stringify(issue)))) continue;
      result = candidate;
      scenes.clear();
    }
  }
  cache.set(reserved, result);
  return result;
}
