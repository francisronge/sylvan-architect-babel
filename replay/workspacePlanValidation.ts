import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import { getNodeId } from './displayIdentity.ts';
import { inkBoxesCollide } from './relations/rectGeometry.ts';
import { prepareTreeInkSubtrees, treeInkObstacles, type TreeInkTextMeasure } from './treeInkGeometry.ts';
import type { PreparedTreeLabelRuns, TreeLabelMeasure } from './treeLabelRuns.ts';
import type { TreeCoordinateReservation, TreeDirection } from './treeLayout.ts';
import type { PlaybackStep } from './types.ts';
import { extentOverlap, obstacleExtent, verticalObstacleIndex } from './verticalObstacleIndex.ts';
import { currentForkBranchesClear } from './workspaceForkClearance.ts';

type Node = d3.HierarchyPointNode<SyntaxNode>;
export type WorkspacePlanScene = {
  step: PlaybackStep;
  canvas: SyntaxNode;
  size: [number, number];
  currentRowHeight?: number;
  nodes: Map<string, Node>;
  coordinates: TreeCoordinateReservation;
};
export type WorkspacePlanRender = (scene: WorkspacePlanScene, coordinates: TreeCoordinateReservation) => Node[];
export type WorkspacePlanMeasurements = {
  measureCategoryText?: CategoryTextMeasure;
  measureTreeInk?: TreeInkTextMeasure;
  treeLabelRuns?: PreparedTreeLabelRuns;
  measureTreeLabel?: TreeLabelMeasure;
};
type RejectionReason = 'temporal-constraints' | 'render-validation';
type Validation =
  | { valid: true; coordinates: ReadonlyMap<SyntaxNode, TreeCoordinateReservation> }
  | { valid: false; reason: RejectionReason; detail: string };

/** A candidate is accepted only if the actual tree layout preserves its poses,
 * temporal constraints, current ranks and ink clearance in every frame. This
 * boundary does not choose preferences or modify the accepted reservations. */
export function validateWorkspacePlacement({ scenes, baseline, direction, placement, render, metrics }: {
  scenes: readonly WorkspacePlanScene[];
  baseline: ReadonlyMap<SyntaxNode, TreeCoordinateReservation>;
  direction: TreeDirection;
  placement: { coordinates: readonly ReadonlyMap<string, { x: number; y: number }>[] };
  render: WorkspacePlanRender;
  metrics: WorkspacePlanMeasurements;
}): Validation {
  const failed = (reason: RejectionReason, detail: string): Validation => ({ valid: false, reason, detail });
  const coordinates = new Map(baseline);
  const perCanvas = new Map<SyntaxNode, TreeCoordinateReservation>();
  for (const [index, scene] of scenes.entries()) {
    const next = new Map(baseline.get(scene.canvas)!);
    for (const [id, p] of placement.coordinates[index]) {
      next.set(id, { x: direction === 'rtl' ? scene.size[0] + p.x : p.x, y: p.y });
    }
    const prior = perCanvas.get(scene.canvas);
    if (prior && [...next].some(([id, p]) => Math.hypot(p.x - prior.get(id)!.x, p.y - prior.get(id)!.y) > 1e-6)) {
      return failed('temporal-constraints', 'Shared canvas requires different coordinates.');
    }
    perCanvas.set(scene.canvas, next);
    coordinates.set(scene.canvas, next);
  }
  for (const [index, scene] of scenes.entries()) {
    const nodes = new Map(render(scene, coordinates.get(scene.canvas)!)
      .filter(node => !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace')
      .map(node => [getNodeId(node), node]));
    const expected = placement.coordinates[index];
    const groups: Node[][] = [[...nodes.values()].filter(node => !node.parent || !nodes.has(getNodeId(node.parent)))];
    for (const node of nodes.values()) {
      const point = expected.get(getNodeId(node));
      if (!point || Math.hypot(node.x - (direction === 'rtl' ? -point.x : point.x), node.y - point.y) > 1e-6) {
        return failed('render-validation', `Parent recentering at frame ${index + 1}.`);
      }
      const children = (node.children ?? []).filter(child => nodes.has(getNodeId(child)));
      if (children.some(child => child.y <= node.y) || children.slice(1).some((child, i) =>
        Math.abs(child.y - children[i].y) > 1e-6
        || (direction === 'rtl' ? child.x >= children[i].x : child.x <= children[i].x))) {
        return failed('render-validation', `Current rank or order at frame ${index + 1}.`);
      }
      if (children.length > 1) groups.push(children);
    }
    const footprints = prepareTreeInkSubtrees(nodes, metrics.measureCategoryText, metrics.measureTreeInk,
      true, metrics.treeLabelRuns?.get(scene.canvas), metrics.measureTreeLabel);
    for (const parent of nodes.values()) {
      const children = (parent.children ?? []).filter(child => nodes.has(getNodeId(child)));
      if (children.length < 2) continue;
      const childInk = children.map(child => ({
        point: child,
        obstacles: footprints(child).map(rect => ({ ...rect, x: rect.x - child.x, y: rect.y - child.y }))
      }));
      if (!currentForkBranchesClear(parent, childInk)) {
        return failed('render-validation', `Current fork branch crosses child ink at frame ${index + 1}.`);
      }
    }
    const indexes = new Map<Node, ReturnType<typeof verticalObstacleIndex<ReturnType<typeof treeInkObstacles>[number]>>>();
    for (const roots of groups) {
      for (let i = 0; i < roots.length; i++) {
        for (let j = i + 1; j < roots.length; j++) {
          // A pair that cannot overlap by more than 1e-6 on an axis cannot collide.
          const extent = extentOverlap(obstacleExtent(footprints(roots[i])), obstacleExtent(footprints(roots[j])));
          if (extent.x <= 1e-6 || extent.y <= 1e-6) continue;
          let query = indexes.get(roots[j]);
          if (!query) indexes.set(roots[j], query = verticalObstacleIndex(footprints(roots[j]), { overlapOnly: true }));
          for (const a of footprints(roots[i])) {
            if (query(a, b => inkBoxesCollide(a, b, 1e-6))) {
              return failed('render-validation', `Current ink overlap at frame ${index + 1}.`);
            }
          }
        }
      }
    }
  }
  return { valid: true, coordinates };
}
