import * as d3 from 'd3';
import { getNodeId } from '../../replay/displayIdentity.ts';
import {
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import type { ClaimDrawing, DrawingLayer, RelationEmphasis, TreeMeasurements } from './drawingContext.ts';

interface InterventionDrawingContext extends Pick<ClaimDrawing, 'relationLayerKey' | 'queueAcceptedRelationDraw'>, Pick<TreeMeasurements, 'exactScreenTreeLabelRectNow'> {
  scheduledAcceptedLocalityRelations: Set<string>;
  frameItems: RelationPlanItem[];
  g: DrawingLayer;
  overlayNodeById: Map<string, d3.HierarchyPointNode<SyntaxNode>>;
}

export function createInterventionDrawing({
  scheduledAcceptedLocalityRelations,
  relationLayerKey,
  queueAcceptedRelationDraw,
  frameItems,
  g,
  overlayNodeById,
  exactScreenTreeLabelRectNow
}: InterventionDrawingContext) {
  const scheduleAcceptedIntervention = (
    item: RelationPlanItem,
    emphasis: RelationEmphasis
  ) => {
    if (item.familyId !== 'intervention.blocked-path') return false;
    const key = relationLayerKey(item);
    if (!scheduledAcceptedLocalityRelations.has(key)) {
      scheduledAcceptedLocalityRelations.add(key);
      queueAcceptedRelationDraw(item, emphasis, () => {
        const relatedItems = frameItems.filter((candidate) =>
          candidate.familyId === 'intervention.blocked-path'
          && relationLayerKey(candidate) === key);
        const pathItem = relatedItems.find((candidate) =>
          candidate.kind === 'directed-path'
          && candidate.pathStyle === 'intervention');
        const intervenerItem = relatedItems.find((candidate) =>
          candidate.kind === 'node-badges'
          && candidate.badgeStyle === 'intervener');
        if (
          !pathItem
          || pathItem.kind !== 'directed-path'
          || !intervenerItem
          || intervenerItem.kind !== 'node-badges'
        ) return;

        const root = g.node();
        const matrix = root?.getScreenCTM();
        const intervenerId = intervenerItem.badges[0]?.nodeId;
        if (!root || !matrix || !intervenerId) return;
        const inverse = matrix.inverse();
        const localRectForElement = (element: SVGGraphicsElement | null) => {
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          if (!rect.width && !rect.height) return null;
          const points = [
            new DOMPoint(rect.left, rect.top).matrixTransform(inverse),
            new DOMPoint(rect.right, rect.top).matrixTransform(inverse),
            new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse),
            new DOMPoint(rect.left, rect.bottom).matrixTransform(inverse)
          ];
          const xs = points.map((point) => point.x);
          const ys = points.map((point) => point.y);
          return {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys)
          };
        };
        const visibleOccurrenceRect = (nodeId: string) => {
          const anchor = overlayNodeById.get(nodeId);
          const nodeIds = new Set(
            anchor?.descendants().map((candidate) => getNodeId(candidate as unknown as HierNode))
            || [nodeId]
          );
          const terminal = g.selectAll<SVGTextElement, HierNode>('.terminal-label')
            .filter((candidate) => nodeIds.has(getNodeId(candidate as unknown as HierNode)))
            .node();
          return localRectForElement(terminal)
            || exactScreenTreeLabelRectNow(nodeId, false);
        };
        const centredAnchor = (nodeId: string) => {
          const rect = visibleOccurrenceRect(nodeId);
          return rect ? {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            rect
          } : null;
        };
        const probe = centredAnchor(pathItem.fromNodeId);
        const intervener = centredAnchor(intervenerId);
        const target = centredAnchor(pathItem.toNodeId);
        if (!probe || !intervener || !target) return;

        const gap = 22;
        const landingEdge = probe.rect.y + probe.rect.height + gap;
        const targetEdge = target.rect.y - gap;
        const laneLow = Math.min(landingEdge, targetEdge);
        const laneHigh = Math.max(landingEdge, targetEdge);
        const intervenerEdge = intervener.rect.y + intervener.rect.height + gap;
        const laneY = Math.min(laneHigh, Math.max(laneLow, intervenerEdge));
        const targetStart = { x: target.x, y: targetEdge };
        const arrowEnd = { x: probe.x, y: landingEdge };
        const failedPath = [
          `M ${targetStart.x.toFixed(1)} ${targetStart.y.toFixed(1)}`,
          `L ${targetStart.x.toFixed(1)} ${laneY.toFixed(1)}`,
          `L ${arrowEnd.x.toFixed(1)} ${laneY.toFixed(1)}`,
          `L ${arrowEnd.x.toFixed(1)} ${arrowEnd.y.toFixed(1)}`
        ].join(' ');

        const layerNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        layerNode.setAttribute('class', 'babel-intervention-relation-layer');
        if (emphasis === 'quiet') layerNode.setAttribute('opacity', '0.3');
        (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
        const layer = d3.select<SVGGElement, unknown>(layerNode);
        layer.append('path')
          .attr('class', 'babel-intervention-search-shadow')
          .attr('d', failedPath);
        layer.append('path')
          .attr('class', 'babel-intervention-search-path')
          .attr('d', failedPath);

        const appendCross = (className: string) => {
          const size = 22;
          [
            [intervener.x - size, laneY - size, intervener.x + size, laneY + size],
            [intervener.x + size, laneY - size, intervener.x - size, laneY + size]
          ].forEach(([x1, y1, x2, y2]) => {
            layer.append('line')
              .attr('class', className)
              .attr('x1', x1.toFixed(1))
              .attr('x2', x2.toFixed(1))
              .attr('y1', y1.toFixed(1))
              .attr('y2', y2.toFixed(1));
          });
        };
        appendCross('babel-intervention-x-shadow');
        appendCross('babel-intervention-x-mark');

        const arrowSize = 23;
        const arrowTail = laneY > arrowEnd.y
          ? arrowEnd.y + arrowSize
          : arrowEnd.y - arrowSize;
        const arrowPath = [
          `M ${(arrowEnd.x - arrowSize * 0.42).toFixed(1)} ${arrowTail.toFixed(1)}`,
          `L ${arrowEnd.x.toFixed(1)} ${arrowEnd.y.toFixed(1)}`,
          `L ${(arrowEnd.x + arrowSize * 0.42).toFixed(1)} ${arrowTail.toFixed(1)}`
        ].join(' ');
        layer.append('path')
          .attr('class', 'babel-intervention-arrowhead-shadow')
          .attr('d', arrowPath);
        layer.append('path')
          .attr('class', 'babel-intervention-arrowhead')
          .attr('d', arrowPath);

        root.insertBefore(layerNode, root.firstChild);
      });
    }
    return true;
  };
  return { scheduleAcceptedIntervention };
}
