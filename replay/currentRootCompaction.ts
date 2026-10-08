import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { PlaybackStep } from './replayCompiler.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { layoutSyntaxTree, type TreeCoordinateReservation } from './treeLayout.ts';
import { currentWorkspaceMovements } from './currentWorkspaceMovements.ts';
import { treeInkObstacles, type TreeInkTextMeasure } from './treeInkGeometry.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import type { PreparedTreeLabelRuns, TreeLabelMeasure } from './treeLabelRuns.ts';
import { verticalObstacleIndex } from './verticalObstacleIndex.ts';
import { workspaceContinuityReflows } from './workspaceShapeReflows.ts';
import { currentForkBranchesClear } from './workspaceForkClearance.ts';
import { prepareTreeInkSubtrees } from './treeInkGeometry.ts';

type Reservations = ReadonlyMap<SyntaxNode, TreeCoordinateReservation>;
type Node = d3.HierarchyPointNode<SyntaxNode>;
const cache = new WeakMap<Reservations, Reservations>();

/** Reserve a compact receiving component throughout its construction. Only its
 * owning movement opens the later landing space; ordinary merges retain every
 * internal offset instead of recomputing a smaller tree at each reveal. */
export function compactCurrentRootForks(steps: readonly PlaybackStep[], sizes: ReadonlyMap<number, [number, number]>,
  reserved: Reservations, measureCategoryText?: CategoryTextMeasure, measureTreeInk?: TreeInkTextMeasure,
  treeLabelRuns?: PreparedTreeLabelRuns, measureTreeLabel?: TreeLabelMeasure): Reservations {
  const cached = cache.get(reserved);
  if (cached) return cached;
  const frames = steps.flatMap(step => {
    const canvas = step.replayCanvasData, size = sizes.get(step.replayFrameIndex!);
    if (!canvas || !size || !reserved.has(canvas)) return [];
    return [{ step, canvas, size }];
  }).sort((a, b) => (a.step.replayFrameIndex! - b.step.replayFrameIndex!)
    || ((a.step.replayStageStepIndex ?? (a.step.replayKind === 'macro' ? Infinity : 0))
      - (b.step.replayStageStepIndex ?? (b.step.replayKind === 'macro' ? Infinity : 0))));
  let result = reserved;
  const scenes = new Map<number, { nodes: Map<string, Node> }>();
  const positioned = (index: number, coordinates: Reservations): Node[] => {
    const { step, canvas, size } = frames[index];
    const visible = new Set(step.replayVisibleNodeIds);
    const root = d3.hierarchy(canvas); applyVizIds(root);
    // Plans are stored before reflection. RTL is applied by the shared painter
    // after these same coordinates reach drawing, allocation, and camera bounds.
    return layoutSyntaxTree(root, size, 'ltr', coordinates.get(canvas), visible).descendants()
      .filter(node => visible.has(getNodeId(node)) && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace');
  };
  const sceneAt = (index: number) => {
    const cached = scenes.get(index);
    if (cached) return cached;
    const nodes = new Map<string, Node>(positioned(index, result).map(node => [getNodeId(node), node]));
    const scene = { nodes };
    scenes.set(index, scene);
    return scene;
  };
  const ink = (nodes: Node[], canvas: SyntaxNode) => treeInkObstacles(nodes, measureCategoryText,
    measureTreeInk, false, treeLabelRuns?.get(canvas), measureTreeLabel);
  for (let index = frames.length - 2; index >= 0; index--) {
    if (frames[index].step.replayKind !== 'macro' || frames[index + 1].step.replayKind !== 'relation') continue;
    const frame = { ...frames[index], ...sceneAt(index) }, next = { ...frames[index + 1], ...sceneAt(index + 1) };
    const movements = currentWorkspaceMovements(next.step, frame.nodes, next.nodes);
    if (!movements.length) continue;
    const children = (node: Node) => (node.children ?? []).filter(child => frame.nodes.has(getNodeId(child)));
    for (const parent of frame.nodes.values()) {
      if (parent.ancestors().slice(1).some(ancestor => frame.nodes.has(getNodeId(ancestor)) && children(ancestor).length > 1)) continue;
      const daughters = children(parent);
      if (daughters.length !== 2) continue;
      for (let side = 0; side < 2; side++) {
        const head = daughters[side], host = daughters[1 - side];
        const headNodes = head.descendants().filter(node => frame.nodes.has(getNodeId(node)));
        if (headNodes.some(node => children(node).length > 1) || children(host).length === 0) continue;
        const members = new Set(host.descendants().filter(node => frame.nodes.has(getNodeId(node))).map(getNodeId));
        const opensHost = movements.some(move => {
          if (!members.has(move.priorSourceNodeId)) return false;
          const landing = next.nodes.get(move.targetNodeId);
          const owner = landing?.ancestors().slice(1).find(node => frame.nodes.has(getNodeId(node)));
          if (!owner) return false;
          if (getNodeId(owner) === getNodeId(parent)) {
            const nextHost = next.nodes.get(getNodeId(host));
            return nextHost?.parent !== owner && Boolean(nextHost?.parent
              && !frame.nodes.has(getNodeId(nextHost.parent)) && landing?.ancestors().includes(nextHost.parent));
          }
          const currentOwner = frame.nodes.get(getNodeId(owner))!;
          const path = currentOwner.ancestors();
          const hostIndex = path.findIndex(node => node === host);
          return hostIndex >= 0 && path.slice(0, hostIndex + 1).every(node => children(node).length === 1);
        });
        if (!opensHost) continue;
        const headInk = ink(headNodes, frame.canvas);
        const hostInk = ink([...frame.nodes.values()].filter(node => members.has(getNodeId(node))), frame.canvas);
        if (!headInk.length || !hostInk.length) continue;
        const gap = side === 0
          ? Math.min(...hostInk.map(box => box.x)) - Math.max(...headInk.map(box => box.x + box.width))
          : Math.min(...headInk.map(box => box.x)) - Math.max(...hostInk.map(box => box.x + box.width));
        let amount = gap - 120;
        if (amount <= 1e-6) continue;
        // Earlier independent inputs can occupy the same horizontal corridor.
        // Their measured ink limits the one translation used by the complete
        // construction lifetime. A merge never gets its own smaller layout.
        let compatible = true;
        for (let earlier = 0; earlier <= index && amount > 1e-6; earlier++) {
          const scene = sceneAt(earlier), canvas = frames[earlier].canvas;
          const moved = [...scene.nodes.values()].filter(node => members.has(getNodeId(node)));
          if (!moved.length) continue;
          const ancestors = new Set(moved.flatMap(node => node.ancestors().slice(1).map(getNodeId)));
          if (moved.some(node => node.parent && scene.nodes.has(getNodeId(node.parent))
            && !members.has(getNodeId(node.parent)) && getNodeId(node) !== getNodeId(host))) {
            compatible = false; break;
          }
          const fixed = [...scene.nodes.values()].filter(node => !members.has(getNodeId(node)) && !ancestors.has(getNodeId(node)));
          const query = verticalObstacleIndex(ink(fixed, canvas));
          for (const moving of ink(moved, canvas)) query(moving, obstacle => {
            if (side === 0 && obstacle.x + obstacle.width <= moving.x)
              amount = Math.min(amount, moving.x - obstacle.x - obstacle.width - 34);
            if (side === 1 && moving.x + moving.width <= obstacle.x)
              amount = Math.min(amount, obstacle.x - moving.x - moving.width - 34);
            return false;
          });
        }
        if (!compatible || amount <= 1e-6) continue;
        const dx = side === 0 ? -amount : amount;
        const candidate = new Map(result);
        for (let earlier = 0; earlier <= index; earlier++) {
          const scene = frames[earlier], points = result.get(scene.canvas)!;
          candidate.set(scene.canvas, new Map([...points].map(([id, point]) => [id,
            members.has(id) ? { x: point.x + dx, y: point.y } : point])));
        }
        const changed = frames.slice(0, index + 1).map((scene, index) => {
          const nodes = new Map<string, Node>(positioned(index, candidate).map(node => [getNodeId(node), node]));
          return { ...scene, nodes };
        });
        const valid = changed.every(scene => {
          const occupied = new Set<string>();
          const subtreeInk = prepareTreeInkSubtrees(scene.nodes, measureCategoryText, measureTreeInk,
            false, treeLabelRuns?.get(scene.canvas), measureTreeLabel);
          for (const node of scene.nodes.values()) {
            const position = `${node.x.toFixed(6)},${node.y.toFixed(6)}`;
            if (occupied.has(position)) return false;
            occupied.add(position);
            if (node.parent && scene.nodes.has(getNodeId(node.parent)) && node.y <= node.parent.y) return false;
            const children = (node.children ?? []).filter(child => scene.nodes.has(getNodeId(child)));
            if (children.some((child, index) => index > 0 && child.x <= children[index - 1].x)) return false;
            if (children.length < 2 || members.has(getNodeId(node))
              || !node.descendants().some(child => members.has(getNodeId(child)))) continue;
            if (!currentForkBranchesClear(node, children.map(child => ({ point: child,
              obstacles: subtreeInk(child).map(box => ({ ...box, x: box.x - child.x, y: box.y - child.y })) })))) return false;
          }
          return true;
        });
        if (!valid) continue;
        const allScenes = frames.map((scene, index) => ({ ...scene, nodes: sceneAt(index).nodes, index }));
        const render = (scene: typeof allScenes[number], coordinates: TreeCoordinateReservation) =>
          positioned(scene.index, new Map([[scene.canvas, coordinates]]));
        const priorReflows = new Set(workspaceContinuityReflows(allScenes, result, render).map(issue => JSON.stringify(issue)));
        if (workspaceContinuityReflows(allScenes, candidate, render).some(issue => !priorReflows.has(JSON.stringify(issue)))) continue;
        result = candidate;
        scenes.clear();
      }
    }
  }
  cache.set(reserved, result);
  return result;
}
