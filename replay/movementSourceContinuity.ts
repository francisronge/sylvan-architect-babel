import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import { currentWorkspaceMovements } from './currentWorkspaceMovements.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { inkBoxesCollide } from './relations/rectGeometry.ts';
import { prepareTreeInkSubtrees, type TreeInkTextMeasure } from './treeInkGeometry.ts';
import type { PreparedTreeLabelRuns, TreeLabelMeasure } from './treeLabelRuns.ts';
import { layoutSyntaxTree, type TreeCoordinateReservation, type TreeDirection } from './treeLayout.ts';
import type { PlaybackStep } from './types.ts';
import { extentOverlap, obstacleExtent, verticalObstacleIndex } from './verticalObstacleIndex.ts';
import { currentForkBranchesClear, relativeChildInk } from './workspaceForkClearance.ts';
import { constructionReceivingAttachments, movementReceivingAttachments, type CurrentWorkspaceTopology } from './workspaceReceivingHost.ts';
import { workspaceContinuityReflows } from './workspaceShapeReflows.ts';

type Reservations = ReadonlyMap<SyntaxNode, TreeCoordinateReservation>;
type Node = d3.HierarchyPointNode<SyntaxNode>;
const cache = new WeakMap<Reservations, Reservations>();
const epsilon = 1e-6;

/** An unbranched source replaced in its exact parent slot should not start farther out than
 * its lower occurrence. Reserve the proved compact slot throughout construction,
 * retaining current syntax and pronunciation. A receiving head may use its new
 * center. An unchanged receiving component occupies the outer slot of its new
 * movement or ordinary-merge wrapper, regardless of its interior branching.
 * New parents and daughters still appear only at their owning step. */
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
  const inkAt = (index: number, nodes: Map<string, Node>) =>
    prepareTreeInkSubtrees(nodes, measureCategoryText, measureTreeInk, true,
      treeLabelRuns?.get(frames[index].canvas), measureTreeLabel);
  const paintClear = (nodes: Map<string, Node>, ink: ReturnType<typeof inkAt>): boolean => {
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
        obstacles: relativeChildInk(child, ink(child)) })))) return false;
      groups.push(daughters);
    }
    const indexes = new Map<Node, ReturnType<typeof verticalObstacleIndex<ReturnType<typeof ink>[number]>>>();
    for (const group of groups) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      // A pair that cannot overlap by more than epsilon on an axis cannot collide.
      const extent = extentOverlap(obstacleExtent(ink(group[i])), obstacleExtent(ink(group[j])));
      if (extent.x <= epsilon || extent.y <= epsilon) continue;
      let query = indexes.get(group[j]);
      if (!query) indexes.set(group[j], query = verticalObstacleIndex(ink(group[j]), { overlapOnly: true }));
      for (const a of ink(group[i])) if (query(a, b => inkBoxesCollide(a, b, epsilon))) return false;
    }
    return true;
  };
  const reserveTranslations = (index: number, translations: ReadonlyMap<string, number>,
    owners: ReadonlyMap<string, string>, first = 0, preserveCompletedWidth = false) => {
    const outsideCanvases = new Set([...frames.slice(0, first), ...frames.slice(index + 1)].map(frame => frame.canvas));
    if (frames.slice(first, index + 1).some(frame => outsideCanvases.has(frame.canvas))) return;
    const candidate = new Map(result), candidateScenes = new Map<number, Map<string, Node>>();
    const sharedCanvases = new Map<SyntaxNode, TreeCoordinateReservation>();
    let valid = true;
    for (let earlier = index; earlier >= first && valid; earlier--) {
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
      const placedInk = inkAt(earlier, placed);
      valid = paintClear(placed, placedInk);
      if (valid && preserveCompletedWidth && frames[earlier].step.replayKind === 'macro') {
        const width = (nodes: readonly Node[]) => {
          const xs = nodes.map(node => node.x);
          return Math.max(...xs) - Math.min(...xs);
        };
        const roots = [...nodes.values()].filter(node => !node.parent || !nodes.has(getNodeId(node.parent)));
        valid = width([...placed.values()]) <= width([...nodes.values()]) + epsilon
          && roots.every(root => {
            const ids = root.descendants().map(getNodeId).filter(id => nodes.has(id));
            return width(ids.map(id => placed.get(id)!)) <= width(ids.map(id => nodes.get(id)!)) + epsilon;
          });
        if (valid) {
          // Fixed outer nodes can hide a wider label or word inside the tree.
          // Reuse the same measured ink as clearance, per root and forest.
          const priorInk = inkAt(earlier, nodes);
          const inkWidth = (roots: readonly Node[], ink: ReturnType<typeof inkAt>) => {
            let left = Infinity, right = -Infinity;
            for (const root of roots) for (const box of ink(root)) {
              left = Math.min(left, box.x);
              right = Math.max(right, box.x + box.width);
            }
            return left === Infinity ? 0 : right - left;
          };
          const nextRoots = roots.map(root => placed.get(getNodeId(root))!);
          valid = inkWidth(nextRoots, placedInk) <= inkWidth(roots, priorInk) + epsilon
            && roots.every((root, i) => inkWidth([nextRoots[i]], placedInk) <= inkWidth([root], priorInk) + epsilon);
        }
      }
    }
    if (!valid) return;
    const allScenes = frames.map((frame, index) => ({ ...frame, index, nodes: sceneAt(index) }));
    const oldReflows = new Set(workspaceContinuityReflows(allScenes, result,
      scene => [...scene.nodes.values()]).map(issue => JSON.stringify(issue)));
    const reflows = workspaceContinuityReflows(allScenes, candidate,
      scene => [...(candidateScenes.get(scene.index) ?? scene.nodes).values()]);
    if (reflows.some(issue => !oldReflows.has(JSON.stringify(issue)))) return;
    result = candidate;
    scenes.clear();
  };
  const reserveReceivingSlot = (index: number, includeConstruction: boolean) => {
    const nextStep = frames[index + 1].step;
    if (nextStep.replayKind !== 'relation'
      && !(includeConstruction && nextStep.replayKind === 'micro' && nextStep.operation === 'ExternalMerge')) return;
    const before = sceneAt(index), after = sceneAt(index + 1);
    const movements = currentWorkspaceMovements(nextStep, before, after);
    const topology = (nodes: ReadonlyMap<string, Node>): CurrentWorkspaceTopology => ({
      has: id => nodes.has(id),
      parent: id => { const parent = nodes.get(id)?.parent; return parent && nodes.has(getNodeId(parent)) ? getNodeId(parent) : undefined; },
      children: id => { const node = nodes.get(id); return node ? children(node, nodes).map(getNodeId) : []; },
      contains: (root, id) => nodes.get(id)?.ancestors().some(node => getNodeId(node) === root) ?? false,
    });
    const sameHost = (id: string) => {
      const prior = before.get(id), next = after.get(id);
      if (!prior || !next) return false;
      const members = prior.descendants().filter(node => before.has(getNodeId(node)));
      return members.length === next.descendants().filter(node => after.has(getNodeId(node))).length
        && members.every(node => {
          const other = after.get(getNodeId(node));
          return other && node.data.label === other.data.label && node.data.word === other.data.word
            && node.data.silent === other.data.silent
            && JSON.stringify(children(node, before).map(getNodeId)) === JSON.stringify(children(other, after).map(getNodeId));
        });
    };
    const priorTopology = topology(before), nextTopology = topology(after);
    const attachments = [...movementReceivingAttachments(nextStep, priorTopology, nextTopology, sameHost),
      ...(includeConstruction ? constructionReceivingAttachments(nextStep, priorTopology, nextTopology, sameHost) : [])];
    for (const { host, wrapper } of attachments) {
      const prior = before.get(host)!, landing = after.get(wrapper)!;
      if (!prior.parent || !landing.parent || Math.abs(prior.y - landing.y) > epsilon) continue;
      const dx = landing.x - prior.x;
      if (Math.abs(dx) <= epsilon) continue;
      const members = new Set<string>(prior.descendants().filter(node => before.has(getNodeId(node))).map(getNodeId));
      // This slot belongs to a receiving component, not to an extracted source.
      // Source-containing hosts retain their separate compaction/contour rule.
      if (movements.some(move => members.has(move.priorSourceNodeId))) continue;
      const oldPeers = children(prior.parent, before).map(getNodeId);
      const newPeers = children(landing.parent, after).map(getNodeId);
      // A source-containing peer can recenter over its changed lower occurrence.
      // Its unchanged interior still passes the complete paint and motion checks.
      const recenteredPeer = (id: string) => Math.abs(before.get(id)!.y - after.get(id)!.y) <= epsilon
        && movements.some(move => priorTopology.contains(id, move.priorSourceNodeId)
          && nextTopology.contains(id, move.witnessNodeId));
      if (JSON.stringify(oldPeers.map(id => id === host ? wrapper : id)) !== JSON.stringify(newPeers)
        || oldPeers.filter(id => id !== host).some(id => Math.hypot(before.get(id)!.x - after.get(id)!.x,
          before.get(id)!.y - after.get(id)!.y) > epsilon && !recenteredPeer(id))) continue;
      let first = index;
      // Carry the same rigid slot through this component's construction, stopping
      // where any member still belongs to a different preceding occurrence.
      for (let earlier = index - 1; earlier >= 0; earlier--) {
        const nodes = sceneAt(earlier), present = [...members].filter(id => nodes.has(id));
        if (!present.length || present.some(id => {
          const node = nodes.get(id)!, parent = node.parent && nodes.has(getNodeId(node.parent)) ? getNodeId(node.parent) : undefined;
          return id !== host && parent && !members.has(parent)
            || children(node, nodes).some(child => !members.has(getNodeId(child)));
        })) break;
        first = earlier;
      }
      reserveTranslations(index, new Map([...members].map(id => [id, dx])),
        new Map([...members].map(id => [id, host])), first, true);
    }
  };
  // Settle movement source and receiving slots together first. Subsequent
  // ordinary merges must preserve this completed geometry as their reference.
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
      const preceding = result;
      reserveTranslations(index, translations, owners);
      if (result === preceding) {
        // If the spoken source cannot clear the smaller lower slot, preserve
        // that established slot after its movement. Word removal alone must
        // not pull otherwise unchanged ancestors inward.
        const members = lower.descendants().filter(node => after.has(getNodeId(node)));
        const parentId = getNodeId(lower.parent);
        let last = index + 1;
        for (let later = last + 1; later < frames.length; later++) {
          const nodes = sceneAt(later), current = nodes.get(movement.witnessNodeId);
          if (!current?.parent || getNodeId(current.parent) !== parentId
            || current.descendants().filter(node => nodes.has(getNodeId(node))).length !== members.length
            || members.some(node => {
              const match = nodes.get(getNodeId(node));
              return !match || match.data.label !== node.data.label || match.data.word !== node.data.word
                || match.data.silent !== node.data.silent
                || JSON.stringify(children(match, nodes).map(getNodeId)) !== JSON.stringify(children(node, after).map(getNodeId));
            })) break;
          last = later;
        }
        reserveTranslations(last, new Map(members.map(node => [getNodeId(node), -dx])),
          new Map(members.map(node => [getNodeId(node), movement.witnessNodeId])), index + 1);
      }
    }
    reserveReceivingSlot(index, false);
  }
  // Follow receiving slots backward through ordinary and movement wrappers.
  for (let index = frames.length - 2; index >= 0; index--) reserveReceivingSlot(index, true);
  cache.set(reserved, result);
  return result;
}
