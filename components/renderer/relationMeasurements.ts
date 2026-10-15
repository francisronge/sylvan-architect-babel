import * as d3 from 'd3';
import { getNodeId } from '../../replay/displayIdentity.ts';
import { resolveUniqueDisplayTerminal } from '../../replay/relations/trajectoryAttachment.ts';
import { indexHierarchyNodesByIdAndAliases } from '../../replay/replayCanvas.ts';
import { isDisplayTerminalNode } from '../../replay/replaySurfaceNotation.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import type { DrawingLayer } from './drawingContext.ts';
import { labelBelongsToNode, measureScreenGraphics } from './treeMeasurements.ts';

interface RelationMeasurementsContext {
  treeData: d3.HierarchyPointNode<SyntaxNode>;
  g: DrawingLayer;
  measureGraphicsElementsInTreeSpace: (elements: SVGGraphicsElement[]) => { x: number; y: number; width: number; height: number; };
}
export function createRelationMeasurements({ treeData, g, measureGraphicsElementsInTreeSpace }: RelationMeasurementsContext) {
  const postFitNodeById = indexHierarchyNodesByIdAndAliases(
    treeData.descendants() as d3.HierarchyPointNode<SyntaxNode>[]
  );
  const measuredShellRect = (nodeId: string) => {
    const label = g.selectAll<SVGTextElement, HierNode>('.category-label')
      .filter((candidate) => getNodeId(candidate) === nodeId)
      .node();
    return label ? measureGraphicsElementsInTreeSpace([label]) : null;
  };
  const measuredTerminalRect = (nodeId: string) => {
    const anchor = postFitNodeById.get(nodeId);
    const resolution = anchor
      ? resolveUniqueDisplayTerminal(
        anchor,
        (candidate) => candidate.children || [],
        (candidate) => isDisplayTerminalNode(candidate.data)
      )
      : null;
    const terminalId = resolution?.terminal
      ? getNodeId(resolution.terminal as unknown as HierNode)
      : nodeId;
    const label = g.selectAll<SVGTextElement, HierNode>('.terminal-label')
      .filter(function exactMeasuredTerminal(candidate) {
        const candidateId = getNodeId(candidate);
        const renderedId = this.getAttribute('data-node-id') || '';
        return candidateId === terminalId || renderedId === terminalId;
      })
      .node();
    return label ? measureGraphicsElementsInTreeSpace([label]) : null;
  };
  const measuredSubtreeRect = (nodeId: string) => {
    const anchor = postFitNodeById.get(nodeId);
    if (!anchor) return null;
    const subtreeIds = new Set(anchor.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode)));
    const labels = g.selectAll<SVGGraphicsElement, HierNode>('.category-label, .terminal-label')
      .filter(function candidateBelongsToSubtree(candidate) {
        const datumId = getNodeId(candidate);
        const categoryId = this.getAttribute('data-category-node-id') || '';
        const terminalId = this.getAttribute('data-node-id') || '';
        return subtreeIds.has(datumId)
          || subtreeIds.has(categoryId)
          || subtreeIds.has(terminalId)
          || [...subtreeIds].some((subtreeId) => labelBelongsToNode(this, String(subtreeId)));
      })
      .nodes();
    return measureGraphicsElementsInTreeSpace(labels);
  };
  const measuredSubtreeLabelRects = (nodeId: string) => {
    const anchor = postFitNodeById.get(nodeId);
    if (!anchor) return [];
    const subtreeIds = new Set(
      anchor.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode))
    );
    return g.selectAll<SVGGraphicsElement, HierNode>('.category-label, .terminal-label')
      .filter(function renderedLabelBelongsToSubtree(candidate) {
        const datumId = getNodeId(candidate);
        const categoryId = this.getAttribute('data-category-node-id') || '';
        const terminalId = this.getAttribute('data-node-id') || '';
        return subtreeIds.has(datumId)
          || subtreeIds.has(categoryId)
          || subtreeIds.has(terminalId)
          || [...subtreeIds].some((subtreeId) => labelBelongsToNode(this, String(subtreeId)));
      })
      .nodes()
      .map((label) => measureGraphicsElementsInTreeSpace([label]))
      .filter((rect): rect is { x: number; y: number; width: number; height: number } => Boolean(rect));
  };
  type OperatorVariableHullPoint = [number, number];
  const operatorVariableScopeHull = (
    domainNodeId: string,
    rank: number
  ): OperatorVariableHullPoint[] | null => {
    const padX = Math.max(46, 82 - rank * 7);
    const padY = Math.max(44, 82 - rank * 6);
    const points: OperatorVariableHullPoint[] = [];
    measuredSubtreeLabelRects(domainNodeId).forEach((rect) => {
      const left = rect.x - padX;
      const right = rect.x + rect.width + padX;
      const top = rect.y - padY;
      const bottom = rect.y + rect.height + padY;
      points.push(
        [left, top],
        [(left + right) / 2, top - padY * 0.18],
        [right, top],
        [right + padX * 0.12, (top + bottom) / 2],
        [right, bottom],
        [(left + right) / 2, bottom + padY * 0.18],
        [left, bottom],
        [left - padX * 0.12, (top + bottom) / 2]
      );
    });
    const measuredHull = d3.polygonHull(points);
    if (!measuredHull) return null;
    const centerX = d3.mean(measuredHull, (point) => point[0]) || 0;
    const centerY = d3.mean(measuredHull, (point) => point[1]) || 0;
    const expansion = Math.max(24, 52 - rank * 5);
    return measuredHull.map(([x, y]) => {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.hypot(dx, dy) || 1;
      const scale = (distance + expansion) / distance;
      return [centerX + dx * scale, centerY + dy * scale];
    });
  };
  const operatorVariableScopeEnvelope = d3.line<OperatorVariableHullPoint>()
    .curve(d3.curveCatmullRomClosed.alpha(0.66));
  const unionRects = (rects: Array<{ x: number; y: number; width: number; height: number }>) => {
    if (rects.length === 0) return null;
    const x = d3.min(rects, (rect) => rect.x);
    const y = d3.min(rects, (rect) => rect.y);
    const right = d3.max(rects, (rect) => rect.x + rect.width);
    const bottom = d3.max(rects, (rect) => rect.y + rect.height);
    if (x === undefined || y === undefined || right === undefined || bottom === undefined) return null;
    return { x, y, width: right - x, height: bottom - y };
  };
  const measuredTerminalSubtreesRect = (nodeIds: string[]) => unionRects(
    nodeIds.flatMap((nodeId) => {
      const anchor = postFitNodeById.get(nodeId);
      if (!anchor) return [];
      const subtreeIds = new Set(anchor.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode)));
      return g.selectAll<SVGTextElement, HierNode>('.terminal-label')
        .filter((candidate) => subtreeIds.has(getNodeId(candidate)))
        .nodes()
        .map((label) => measureGraphicsElementsInTreeSpace([label]))
        .filter((rect): rect is { x: number; y: number; width: number; height: number } => Boolean(rect));
    })
  );
  const measuredTreeLabelsRect = () => unionRects(
    g.selectAll<SVGGraphicsElement, HierNode>('.category-label, .terminal-label')
      .nodes()
      .map((label) => measureGraphicsElementsInTreeSpace([label]))
      .filter((rect): rect is { x: number; y: number; width: number; height: number } => Boolean(rect))
  );
  const measuredAcceptedAnchorRect = (nodeId: string) =>
    measuredShellRect(nodeId)
    || measuredTerminalRect(nodeId)
    || measuredSubtreeRect(nodeId);
  const measureRenderedElementsInTreeSpace = (elements: SVGGraphicsElement[]) => measureScreenGraphics(g, elements);
  const measuredTrajectoryShellRect = (nodeId: string) => {
    const label = g.selectAll<SVGTextElement, HierNode>('.category-label')
      .filter((candidate) => getNodeId(candidate) === nodeId)
      .node();
    return label ? measureRenderedElementsInTreeSpace([label]) : null;
  };
  const measuredTrajectoryTerminalRect = (nodeId: string) => {
    const anchor = postFitNodeById.get(nodeId);
    const resolution = anchor
      ? resolveUniqueDisplayTerminal(
        anchor,
        (candidate) => candidate.children || [],
        (candidate) => isDisplayTerminalNode(candidate.data)
      )
      : null;
    const terminalId = resolution?.terminal
      ? getNodeId(resolution.terminal as unknown as HierNode)
      : nodeId;
    const label = g.selectAll<SVGTextElement, HierNode>('.terminal-label')
      .filter(function exactTrajectoryTerminal(candidate) {
        return getNodeId(candidate) === terminalId
          || this.getAttribute('data-node-id') === terminalId;
      })
      .node();
    return label ? measureRenderedElementsInTreeSpace([label]) : null;
  };
  const measuredTrajectorySubtreeRect = (nodeId: string) => {
    const anchor = postFitNodeById.get(nodeId);
    if (!anchor) return null;
    const subtreeIds = new Set(
      anchor.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode))
    );
    const labels = g.selectAll<SVGGraphicsElement, HierNode>('.category-label, .terminal-label')
      .filter(function trajectoryLabelBelongsToSubtree(candidate) {
        const datumId = getNodeId(candidate);
        const categoryId = this.getAttribute('data-category-node-id') || '';
        const terminalId = this.getAttribute('data-node-id') || '';
        return subtreeIds.has(datumId)
          || subtreeIds.has(categoryId)
          || subtreeIds.has(terminalId)
          || [...subtreeIds].some((subtreeId) => labelBelongsToNode(this, String(subtreeId)));
      })
      .nodes();
    return measureRenderedElementsInTreeSpace(labels);
  };

  return {
    measuredSubtreeLabelRects,
    unionRects,
    measureRenderedElementsInTreeSpace,
    postFitNodeById,
    measuredShellRect,
    measuredTerminalRect,
    measuredSubtreeRect,
    operatorVariableScopeHull,
    operatorVariableScopeEnvelope,
    measuredTerminalSubtreesRect,
    measuredTreeLabelsRect,
    measuredAcceptedAnchorRect,
    measuredTrajectoryShellRect,
    measuredTrajectoryTerminalRect,
    measuredTrajectorySubtreeRect
  };
}
