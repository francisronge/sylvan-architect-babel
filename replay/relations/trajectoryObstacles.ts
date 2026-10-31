import * as d3 from 'd3';
import type { SyntaxNode } from '../../types.ts';
import { isDisplayTerminalNode } from '../replaySurfaceNotation.ts';
import type { CategoryTextMeasure } from '../categoryTextLayout.ts';
import { treeInkObstacles, type TreeInkTextMeasure } from '../treeInkGeometry.ts';
import type { TreeLabelMeasure, TreeLabelRuns } from '../treeLabelRuns.ts';
import { RELATION_LANES_BELOW_DEEPEST_NODE, SHELL_ATTACHMENT_CLEARANCE, TERMINAL_ATTACHMENT_Y, TRAJECTORY_ROUTES } from '../rendererMetrics.ts';
import type { PlanPositionProvider } from './boundGeometry.ts';
import { bindRelationPlanFrame } from './geometryBinding.ts';
import { sampleCubic, sampleQuadratic } from './markGeometry.ts';
import type { PlaqueRect } from './plaquePlacement.ts';
import type { RelationPlanItem, RelationRenderPlan } from './renderPlan.ts';
import { resolveUniqueDisplayTerminal } from './trajectoryAttachment.ts';

type Node = d3.HierarchyPointNode<SyntaxNode>;
type LabelBoxes = () => readonly { x: number; y: number; width: number; height: number }[];

/** Tree label and word ink, as the camera measures it, for the binder's bow side
 * (BindGeometryOptions `trajectoryLabelBoxes`). Every offline binding of a
 * stage's trajectories passes it, so reservations and the painter, which reads
 * the painted labels, bow a route to the same side. */
export function treeLabelBoxes(nodes: Node[],
  measures: { measureCategoryText?: CategoryTextMeasure; measureTreeInk?: TreeInkTextMeasure; measureTreeLabel?: TreeLabelMeasure },
  labels?: ReadonlyMap<string, readonly TreeLabelRuns[]>) {
  return treeInkObstacles(nodes, measures.measureCategoryText, measures.measureTreeInk, false, labels, measures.measureTreeLabel)
    .filter(rect => rect.connectorAttachment);
}

/** Shared geometric endpoint estimates for reservation and camera bounds. */
export function stagePositionProvider(byId: Map<string, Node>): PlanPositionProvider {
  return (id, attachment = 'position') => {
    const node = byId.get(id);
    if (!node) return null;
    if (attachment === 'parent') return node.parent ? { x: node.parent.x, y: node.parent.y } : null;
    if (attachment === 'terminal') {
      const { terminal } = resolveUniqueDisplayTerminal(node, n => n.children || [],
        n => isDisplayTerminalNode(n.data));
      return terminal ? { x: terminal.x, y: terminal.y + TERMINAL_ATTACHMENT_Y } : null;
    }
    return { x: node.x, y: node.y + (attachment === 'shell-bottom' ? SHELL_ATTACHMENT_CLEARANCE.bottom
      : attachment === 'shell-top' ? -SHELL_ATTACHMENT_CLEARANCE.top : 0) };
  };
}

/** The plaque obstacles of a stage's trajectory items over one scene's syntax
 * (`byId`): the trajectory binder's actual paths, sampled into boxes.
 * `labelBoxes`, the scene's treeLabelBoxes, lets a bowed route choose its side. */
export function trajectoryPlaqueObstacles(plan: RelationRenderPlan, stageIndex: number, trajectories: RelationPlanItem[],
  byId: Map<string, Node>, labelBoxes?: LabelBoxes): PlaqueRect[] {
  const obstacles: PlaqueRect[] = [];
  if (!trajectories.length) return obstacles;
  const stagePlan = { ...plan, frames: plan.frames.map((frame, index) =>
    index === stageIndex ? { ...frame, items: trajectories } : frame) };
  const bound = bindRelationPlanFrame(stagePlan, stageIndex, stagePositionProvider(byId), {
    trajectoryLabelBoxes: labelBoxes,
    trajectoryCeilingY: (d3.min([...byId.values()], node => node.y) ?? 0) - TRAJECTORY_ROUTES.ceilingAboveTopNode,
    trajectoryFloorY: (d3.max([...byId.values()], node => node.y) ?? 0) + RELATION_LANES_BELOW_DEEPEST_NODE.trajectoryFloor
  });
  for (const path of bound.primitives) {
    if (path.type !== 'trajectory-path') continue;
    const points = path.route === 'cubic' && path.control2
      ? sampleCubic(path.start, path.control, path.control2, path.end, 32)
      : path.route === 'orthogonal' ? [path.start, { x: path.start.x, y: path.control.y },
        { x: path.end.x, y: path.control.y }, path.end]
        : sampleQuadratic(path.start, path.control, path.end, 32);
    points.slice(1).forEach((point, i) => obstacles.push({
      x: Math.min(points[i].x, point.x) - 5, y: Math.min(points[i].y, point.y) - 5,
      width: Math.abs(point.x - points[i].x) + 10, height: Math.abs(point.y - points[i].y) + 10, trajectory: true,
      trajectoryKey: `trajectory:${stageIndex}:${path.itemIndex}`
    }));
  }
  return obstacles;
}
