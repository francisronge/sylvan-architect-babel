import * as d3 from 'd3';
import {
  orthogonalTrajectoryPath,
  phaseArcPath
} from '../../replay/relations/markGeometry.ts';
import {
  defaultTrajectoryBowSide, quadraticTrajectoryControl, quadraticTrajectoryInsets, SHELL_ATTACHMENT_CLEARANCE,
  steepTrajectoryBowWeight, TRAJECTORY_ROUTES, type TrajectoryBow
} from '../../replay/rendererMetrics.ts';
import type { TreeDirection } from '../../replay/treeLayout.ts';
import { type HierNode } from '../../replay/types.ts';
import type { DrawingLayer, RelationMeasurements } from './drawingContext.ts';
interface TrajectoryRefinementsContext extends Pick<RelationMeasurements,
  | 'measuredShellRect'
  | 'measuredTerminalSubtreesRect'
  | 'measuredSubtreeRect'
  | 'measuredTrajectoryShellRect'
  | 'measuredTrajectoryTerminalRect'
  | 'measureRenderedElementsInTreeSpace'
  | 'measuredTrajectorySubtreeRect'
  | 'unionRects'
> {
  g: DrawingLayer;
  laneTrajectoryPaths: () => SVGPathElement[];
  direction?: TreeDirection;
}
export function createTrajectoryRefinements({
  measuredShellRect,
  measuredTerminalSubtreesRect,
  measuredSubtreeRect,
  measuredTrajectoryShellRect,
  measuredTrajectoryTerminalRect,
  g,
  measureRenderedElementsInTreeSpace,
  measuredTrajectorySubtreeRect,
  unionRects,
  laneTrajectoryPaths,
  direction = 'ltr'
}: TrajectoryRefinementsContext) {
  const measuredDepartureRect = (path: d3.Selection<SVGPathElement, unknown, null, undefined>) => {
    const terminal = path.attr('data-trajectory-source-attachment') === 'terminal';
    const id = path.attr('data-trajectory-source-anchor') || (terminal
      ? path.attr('data-trajectory-from-witness') || path.attr('data-trajectory-from')
      : path.attr('data-trajectory-from'));
    return terminal ? measuredTrajectoryTerminalRect(id) : measuredTrajectoryShellRect(id);
  };
  /** Measured centres set how fully a route bows; the side is the binder's,
   * which only it can read from the departure's parent, else the default side. */
  const measuredBow = (
    path: d3.Selection<SVGPathElement, unknown, null, undefined>,
    sourceCenter: { x: number; y: number },
    targetCenter: { x: number; y: number }
  ): TrajectoryBow | null => {
    const weight = steepTrajectoryBowWeight(sourceCenter, targetCenter);
    const recorded = path.attr('data-trajectory-bow');
    const side = recorded === '1' ? 1 : recorded === '-1' ? -1 : defaultTrajectoryBowSide(direction);
    return weight > 0 ? { side, weight } : null;
  };
  const refineAcrossTheBoardPaths = () => {
    const atbPaths = g.selectAll<SVGPathElement, unknown>('.vr-trajectory-atb').nodes();
    atbPaths.forEach((pathNode, pathIndex) => {
      const path = d3.select(pathNode);
      const sourceRect = measuredDepartureRect(path);
      const targetRect = measuredTrajectoryShellRect(path.attr('data-trajectory-to'));
      if (!sourceRect || !targetRect) return;
      const sourceCenter = {
        x: sourceRect.x + sourceRect.width / 2,
        y: sourceRect.y + sourceRect.height + SHELL_ATTACHMENT_CLEARANCE.bottom
      };
      const targetCenter = {
        x: targetRect.x + targetRect.width / 2,
        y: targetRect.y + targetRect.height + SHELL_ATTACHMENT_CLEARANCE.bottom
      };
      const bow = measuredBow(path, sourceCenter, targetCenter);
      const insets = quadraticTrajectoryInsets(sourceCenter, targetCenter, bow);
      const start = { x: sourceCenter.x + insets.start, y: sourceCenter.y };
      const groupedOffset = (pathIndex - ((atbPaths.length - 1) / 2)) * 18;
      const requestedTargetShift = insets.end + groupedOffset;
      const targetShiftLimit = Math.max(2, Math.min(18, targetRect.width / 2 - 1));
      const targetShift = Math.max(-targetShiftLimit, Math.min(targetShiftLimit, requestedTargetShift));
      const end = { x: targetCenter.x + targetShift, y: targetCenter.y };
      const control = quadraticTrajectoryControl(start, end, bow);
      const d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
      path.attr('d', d);
      d3.select(pathNode.parentElement)
        .select<SVGPathElement>('.babel-trajectory-path-shadow')
        .attr('d', d);
    });
  };
  const refinePhaseArc = function refinePhaseArc() {
    const arc = d3.select(this);
    const phaseNodeId = arc.attr('data-phase-node');
    const edgeNodeId = arc.attr('data-phase-edge');
    const headRect = measuredShellRect(phaseNodeId);
    const domainRect = measuredTerminalSubtreesRect([phaseNodeId]);
    const edgeRect = edgeNodeId ? measuredShellRect(edgeNodeId) : null;
    if (headRect && domainRect) {
      arc.attr('d', phaseArcPath(
        headRect,
        domainRect,
        edgeRect,
        arc.attr('data-phase-primary') === 'true'
      ));
    }
    arc
      .attr('data-phase-node', null)
      .attr('data-phase-edge', null)
      .attr('data-phase-primary', null);
  };
  const refineBlockedExtractionPath = function refineBlockedExtractionPath() {
    const path = d3.select(this);
    const sourceRect = measuredShellRect(path.attr('data-extraction-source'));
    const targetRect = measuredShellRect(path.attr('data-extraction-target'));
    const domainRect = measuredSubtreeRect(path.attr('data-extraction-domain'));
    if (!sourceRect || !targetRect || !domainRect) return;
    const source = {
      x: sourceRect.x + sourceRect.width / 2,
      y: sourceRect.y + sourceRect.height + 14
    };
    const target = {
      x: targetRect.x + targetRect.width / 2,
      y: targetRect.y + targetRect.height + 14
    };
    const laneY = Math.max(source.y, target.y, domainRect.y + domainRect.height) + 94;
    const span = Math.max(120, Math.abs(source.x - target.x));
    const direction = Math.sign(source.x - target.x || 1);
    const targetControlX = target.x + direction * span * 0.12;
    const sourceControlX = source.x - direction * span * 0.12;
    const d = [
      `M ${target.x.toFixed(1)} ${target.y.toFixed(1)}`,
      `C ${targetControlX.toFixed(1)} ${laneY.toFixed(1)},`,
      `${sourceControlX.toFixed(1)} ${laneY.toFixed(1)},`,
      `${source.x.toFixed(1)} ${source.y.toFixed(1)}`
    ].join(' ');
    path.attr('d', d);
  };
  const refineParasiticGapPath = function refineParasiticGapPath() {
    const path = d3.select(this);
    const sourceRect = measuredDepartureRect(path);
    const targetRect = measuredTrajectoryShellRect(path.attr('data-trajectory-to'));
    if (!sourceRect || !targetRect) return;
    const sourceCenter = {
      x: sourceRect.x + sourceRect.width / 2,
      y: sourceRect.y + sourceRect.height + SHELL_ATTACHMENT_CLEARANCE.bottom
    };
    const targetCenter = {
      x: targetRect.x + targetRect.width / 2,
      y: targetRect.y + targetRect.height + SHELL_ATTACHMENT_CLEARANCE.bottom
    };
    const bow = measuredBow(path, sourceCenter, targetCenter);
    const insets = quadraticTrajectoryInsets(sourceCenter, targetCenter, bow);
    const start = { x: sourceCenter.x + insets.start, y: sourceCenter.y };
    const requestedTargetShift = insets.end;
    const targetShiftLimit = Math.max(2, Math.min(18, targetRect.width / 2 - 1));
    const targetShift = Math.max(-targetShiftLimit, Math.min(targetShiftLimit, requestedTargetShift));
    const end = { x: targetCenter.x + targetShift, y: targetCenter.y };
    const control = quadraticTrajectoryControl(start, end, bow);
    const d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
    path.attr('d', d);
    d3.select(this.parentElement)
      .select<SVGPathElement>('.babel-trajectory-path-shadow')
      .attr('d', d);
  };
  const refinePhillipsPathNode = function refinePhillipsPathNode() {
    const mark = d3.select(this);
    const labelRect = measuredShellRect(mark.attr('data-path-node'));
    if (!labelRect) return;
    const padX = 11;
    const padY = 8;
    if (this.tagName.toLowerCase() === 'ellipse') {
      mark
        .attr('cx', (labelRect.x + labelRect.width / 2).toFixed(1))
        .attr('cy', (labelRect.y + labelRect.height / 2).toFixed(1))
        .attr('rx', (labelRect.width / 2 + padX).toFixed(1))
        .attr('ry', (labelRect.height / 2 + padY).toFixed(1));
    } else {
      mark
        .attr('x', (labelRect.x - padX).toFixed(1))
        .attr('y', (labelRect.y - padY).toFixed(1))
        .attr('width', (labelRect.width + padX * 2).toFixed(1))
        .attr('height', (labelRect.height + padY * 2).toFixed(1))
        .attr('rx', 2);
    }
  };
  const refinePhillipsBlockedEdge = function refinePhillipsBlockedEdge() {
    const layer = d3.select(this);
    const slashes = layer.selectAll<SVGLineElement, unknown>('.babel-pg-blocked-edge').nodes();
    const blockedEdgeNodeId = slashes[0]?.getAttribute('data-blocked-edge-node') || '';
    if (!blockedEdgeNodeId || slashes.length === 0) return;
    const branch = g.selectAll<SVGPathElement, unknown>('.branch')
      .filter(function exactBlockedEdge() {
        return this.getAttribute('data-target-node-id') === blockedEdgeNodeId;
      }).node();
    if (!branch || branch.getTotalLength() <= 0) return;
    const length = branch.getTotalLength();
    const centre = branch.getPointAtLength(length * 0.58);
    const before = branch.getPointAtLength(Math.max(0, length * 0.58 - 2));
    const after = branch.getPointAtLength(Math.min(length, length * 0.58 + 2));
    const tangent = { x: after.x - before.x, y: after.y - before.y };
    const magnitude = Math.hypot(tangent.x, tangent.y) || 1;
    const normal = { x: -tangent.y / magnitude, y: tangent.x / magnitude };
    const tangentUnit = { x: tangent.x / magnitude, y: tangent.y / magnitude };
    [-28, 28].forEach((offset, slashIndex) => {
      const slash = slashes[slashIndex];
      if (!slash) return;
      const midpoint = {
        x: centre.x + tangentUnit.x * offset,
        y: centre.y + tangentUnit.y * offset
      };
      d3.select(slash)
        .attr('x1', (midpoint.x - normal.x * 20).toFixed(1))
        .attr('y1', (midpoint.y - normal.y * 20).toFixed(1))
        .attr('x2', (midpoint.x + normal.x * 20).toFixed(1))
        .attr('y2', (midpoint.y + normal.y * 20).toFixed(1))
        .attr('data-blocked-edge-node', null);
    });
  };
  const refineParasiticGapCoindex = function refineParasiticGapCoindex() {
    const badge = d3.select(this);
    const labelRect = measuredShellRect(badge.attr('data-coindex-anchor'));
    if (!labelRect) return;
    badge
      .attr('x', (labelRect.x + labelRect.width + 12).toFixed(1))
      .attr('y', (labelRect.y + labelRect.height / 2 + 30).toFixed(1))
      .attr('data-coindex-anchor', null);
  };
  const refineParasiticGapLabel = function refineParasiticGapLabel() {
    const badge = d3.select(this);
    const labelRect = measuredTerminalSubtreesRect([badge.attr('data-gap-label-anchor')]);
    if (!labelRect) return;
    badge
      .attr('x', (labelRect.x + labelRect.width + 12).toFixed(1))
      .attr('y', (labelRect.y + labelRect.height / 2 + 10).toFixed(1))
      .attr('data-gap-label-anchor', null);
  };
  const refineSidewardPath = function refineSidewardPath() {
    const path = d3.select(this);
    const sourceRect = measuredTrajectoryShellRect(path.attr('data-trajectory-from'));
    const targetRect = measuredTrajectoryShellRect(path.attr('data-trajectory-to'));
    if (!sourceRect || !targetRect) return;
    const textRects = g.selectAll<SVGTextElement, HierNode>('text').nodes()
      .map((label) => {
        return measureRenderedElementsInTreeSpace([label]);
      })
      .filter((rect): rect is { x: number; y: number; width: number; height: number } => Boolean(rect));
    const treeTop = d3.min(textRects, (rect) => rect.y);
    const start = {
      x: sourceRect.x + sourceRect.width / 2,
      y: sourceRect.y - SHELL_ATTACHMENT_CLEARANCE.top
    };
    const end = {
      x: targetRect.x + targetRect.width / 2,
      y: targetRect.y - SHELL_ATTACHMENT_CLEARANCE.top
    };
    const crestY = Math.min(
      treeTop !== undefined ? treeTop - TRAJECTORY_ROUTES.ceilingAboveTextTop : start.y - TRAJECTORY_ROUTES.ceilingAboveTextTop,
      start.y - TRAJECTORY_ROUTES.crestAboveEndpoint,
      end.y - TRAJECTORY_ROUTES.crestAboveEndpoint
    );
    const d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${start.x.toFixed(1)} ${crestY.toFixed(1)}, ${end.x.toFixed(1)} ${crestY.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
    path.attr('d', d);
    d3.select(this.parentElement)
      .select<SVGPathElement>('.babel-trajectory-path-shadow')
      .attr('d', d);
  };
  const refineOrthogonalTrajectory = function refineOrthogonalTrajectory() {
    const path = d3.select(this);
    const kind = path.attr('data-trajectory-kind');
    const sourceRect = measuredTrajectoryShellRect(path.attr('data-trajectory-from'));
    const sourceExtent = measuredTrajectorySubtreeRect(path.attr('data-trajectory-from'));
    const targetRect = measuredTrajectoryShellRect(path.attr('data-trajectory-to'));
    const targetExtent = measuredTrajectorySubtreeRect(path.attr('data-trajectory-to'));
    if (!sourceRect || !sourceExtent || !targetRect || !targetExtent) return;

    const departureIds = String(path.attr('data-trajectory-orthogonal-departures') || '')
      .split(/\s+/u)
      .filter(Boolean);
    const departureRect = kind === 'remnant' && departureIds.length > 0
      ? unionRects(
        departureIds
          .map(measuredTrajectoryTerminalRect)
          .filter((rect): rect is { x: number; y: number; width: number; height: number } => Boolean(rect))
      )
      : null;
    const pathIndex = Math.max(0, laneTrajectoryPaths().indexOf(this));
    const sourceX = departureRect
      ? departureRect.x + departureRect.width / 2
      : sourceRect.x + sourceRect.width / 2;
    const rawTargetX = targetRect.x + targetRect.width / 2;
    const targetX = kind === 'roll-up'
      ? rawTargetX - Number.EPSILON * Math.max(1, Math.abs(rawTargetX))
      : rawTargetX;
    const originY = kind === 'roll-up'
      ? sourceRect.y + sourceRect.height + SHELL_ATTACHMENT_CLEARANCE.bottom
      : sourceExtent.y + sourceExtent.height + (kind === 'smuggling' ? 28 : 0) + SHELL_ATTACHMENT_CLEARANCE.bottom;

    const treeRect = measureRenderedElementsInTreeSpace(
      g.selectAll<SVGGraphicsElement, HierNode>('.category-label, .terminal-label').nodes()
    );
    let laneY = treeRect
      ? treeRect.y + treeRect.height + TRAJECTORY_ROUTES.orthogonalLaneSpacing * (1 + pathIndex)
      : originY + TRAJECTORY_ROUTES.orthogonalLaneSpacing * (1 + pathIndex);
    if (kind === 'roll-up') {
      const obstacles = g.selectAll<SVGGraphicsElement, HierNode>('text')
        .nodes()
        .map((label) => measureRenderedElementsInTreeSpace([label]))
        .filter((rect): rect is { x: number; y: number; width: number; height: number } => Boolean(rect));
      const laneIsClear = (candidateY: number) => !obstacles.some((rect) =>
        candidateY >= rect.y - 8
        && candidateY <= rect.y + rect.height + 8
        && Math.min(sourceX, targetX) - 8 <= rect.x + rect.width
        && Math.max(sourceX, targetX) + 8 >= rect.x);
      laneY = originY + TRAJECTORY_ROUTES.rollUpLaneOffset;
      for (let attempt = 0; attempt < 40 && !laneIsClear(laneY); attempt += 1) {
        laneY += TRAJECTORY_ROUTES.rollUpLaneStep;
      }
    }

    const targetArrivalRect = kind === 'remnant' ? targetExtent : targetRect;
    const targetBoxBottom = kind === 'remnant'
      ? targetExtent.y + targetExtent.height + 24 + 3
      : targetArrivalRect.y + targetArrivalRect.height + 8;
    const end = {
      x: targetX,
      y: Math.min(targetBoxBottom, laneY - 8)
    };
    const d = orthogonalTrajectoryPath({ x: sourceX, y: originY }, end, laneY);
    path.attr('d', d);
    d3.select(this.parentElement)
      .select<SVGPathElement>('.babel-trajectory-path-shadow')
      .attr('d', d);
  };
  const refinePhrasalPath = function refinePhrasalPath() {
    const path = d3.select(this);
    const sourceRect = measuredDepartureRect(path);
    const targetRect = measuredTrajectoryShellRect(path.attr('data-trajectory-to'));
    if (!sourceRect || !targetRect) return;
    const sourceCenter = {
      x: sourceRect.x + sourceRect.width / 2,
      y: sourceRect.y + sourceRect.height + SHELL_ATTACHMENT_CLEARANCE.bottom
    };
    const targetCenter = {
      x: targetRect.x + targetRect.width / 2,
      y: targetRect.y + targetRect.height + SHELL_ATTACHMENT_CLEARANCE.bottom
    };
    const bow = measuredBow(path, sourceCenter, targetCenter);
    const insets = quadraticTrajectoryInsets(sourceCenter, targetCenter, bow);
    const start = { x: sourceCenter.x + insets.start, y: sourceCenter.y };
    const requestedTargetShift = insets.end;
    const targetShiftLimit = Math.max(2, Math.min(18, targetRect.width / 2 - 1));
    const targetShift = Math.max(-targetShiftLimit, Math.min(targetShiftLimit, requestedTargetShift));
    const end = { x: targetCenter.x + targetShift, y: targetCenter.y };
    const control = quadraticTrajectoryControl(start, end, bow);
    const d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
    path.attr('d', d);
    d3.select(this.parentElement)
      .select<SVGPathElement>('.babel-trajectory-path-shadow')
      .attr('d', d);
  };
  const refineTerminalTrajectory = function refineTerminalTrajectory() {
    const path = d3.select(this);
    const sourceRect = measuredDepartureRect(path);
    const targetRect = path.attr('data-trajectory-target-attachment') === 'shell-bottom'
      ? measuredTrajectoryShellRect(path.attr('data-trajectory-to'))
      : measuredTrajectoryTerminalRect(path.attr('data-trajectory-to'));
    if (!sourceRect || !targetRect) return;
    const sourceCenter = {
      x: sourceRect.x + sourceRect.width / 2,
      y: sourceRect.y + sourceRect.height + SHELL_ATTACHMENT_CLEARANCE.bottom
    };
    const targetCenter = {
      x: targetRect.x + targetRect.width / 2,
      y: targetRect.y + targetRect.height + SHELL_ATTACHMENT_CLEARANCE.bottom
    };
    const bow = measuredBow(path, sourceCenter, targetCenter);
    const insets = quadraticTrajectoryInsets(sourceCenter, targetCenter, bow);
    const start = { x: sourceCenter.x + insets.start, y: sourceCenter.y };
    const end = { x: targetCenter.x + insets.end, y: targetCenter.y };
    const control = quadraticTrajectoryControl(start, end, bow);
    const d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
    path.attr('d', d);
    d3.select(this.parentElement)
      .select<SVGPathElement>('.babel-trajectory-path-shadow')
      .attr('d', d);
  };
  const finalizeAcceptedTrajectoryPath = function finalizeAcceptedTrajectoryPath() {
    const path = d3.select(this);
    const kind = path.attr('data-trajectory-kind');
    path
      .classed('vr-trajectory', false)
      .classed(`vr-trajectory-${kind}`, false)
      .attr('data-trajectory-source-attachment', null)
      .attr('data-trajectory-source-anchor', null)
      .attr('data-trajectory-target-attachment', null)
      .attr('data-trajectory-bow', null)
      .attr('data-trajectory-orthogonal-departures', null);
  };
  return {
    refineAcrossTheBoardPaths,
    refinePhaseArc,
    refineBlockedExtractionPath,
    refineParasiticGapPath,
    refinePhillipsPathNode,
    refinePhillipsBlockedEdge,
    refineParasiticGapCoindex,
    refineParasiticGapLabel,
    refineSidewardPath,
    refineOrthogonalTrajectory,
    refinePhrasalPath,
    refineTerminalTrajectory,
    finalizeAcceptedTrajectoryPath
  };
}
