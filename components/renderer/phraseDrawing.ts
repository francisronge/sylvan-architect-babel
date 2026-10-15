import * as d3 from 'd3';
import { getNodeId } from '../../replay/displayIdentity.ts';
import { type BoundPrimitive } from '../../replay/relations/boundGeometry.ts';
import {
  fongEdgeOutlineRect
} from '../../replay/relations/markGeometry.ts';
import {
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import type { ClaimDrawing, DrawingLayer, RelationEmphasis, RelationLayers, TreeMeasurements } from './drawingContext.ts';
interface PhraseDrawingContext extends Pick<ClaimDrawing, 'queueAcceptedRelationDraw'>, Pick<RelationLayers, 'ensureControlRelationLayer'>, Pick<TreeMeasurements, 'measuredTreeLabelRectNow'> {
  resolveOverlayAnchor: (nodeId: string) => d3.HierarchyPointNode<SyntaxNode> | undefined;
  resolveMaterializedTerminal: (anchor: d3.HierarchyPointNode<SyntaxNode> | undefined, anchorNodeId: string) => d3.HierarchyPointNode<SyntaxNode> | undefined;
  g: DrawingLayer;
  ensureDomainLocalityLayers: () => { background: DrawingLayer; foreground: DrawingLayer; markerId: string; };
  markPreterminalLensNode: (nodeId: string, role: string) => void;
  appendMarker: (markX: number, markY: number, treeNotation?: boolean, stackIndex?: number) => DrawingLayer;
}
export function createPhraseDrawing({
  resolveOverlayAnchor,
  resolveMaterializedTerminal,
  g,
  queueAcceptedRelationDraw,
  ensureDomainLocalityLayers,
  measuredTreeLabelRectNow,
  markPreterminalLensNode,
  ensureControlRelationLayer,
  appendMarker
}: PhraseDrawingContext) {

  const drawGappingAlignment = (primitive: Extract<BoundPrimitive, { type: 'gapping-alignment' }>, planItem: RelationPlanItem, host: DrawingLayer, _emphasis: RelationEmphasis) => {
    host
      .attr('data-gapping-antecedent', primitive.antecedentNodeId)
      .attr('data-gapping-gap', primitive.gapNodeId)
      .attr('data-gapping-pairs', JSON.stringify(primitive.pairs.map((pair) => ({
        correlateNodeId: pair.correlateNodeId,
        remnantNodeId: pair.remnantNodeId,
        label: pair.label
      }))));
    const layer = host.append('g')
      .attr('class', 'babel-ellipsis-relation-layer babel-gapping-alignment-layer');
    const markerId = `babel-gapping-arrow-${planItem.relationRef.stageIndex}-${planItem.relationRef.relationIndex}`;
    const marker = layer.append('defs')
      .append('marker')
      .attr('id', markerId)
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 8)
      .attr('refY', 5)
      .attr('markerWidth', 7)
      .attr('markerHeight', 7)
      .attr('orient', 'auto')
      .attr('markerUnits', 'userSpaceOnUse');
    marker.append('path')
      .attr('class', 'babel-gapping-arrowhead')
      .attr('d', 'M 1 1 L 9 5 L 1 9');
    const allPoints = [
      primitive.antecedent,
      primitive.gap,
      ...primitive.pairs.flatMap((pair) => [pair.correlate, pair.remnant])
    ];
    const laneBase = (d3.max(allPoints, (point) => point.y) ?? 0) + 200;
    const appendCorrespondence = (
      source: { x: number; y: number },
      target: { x: number; y: number },
      className: string,
      laneY: number
    ) => layer.append('path')
      .attr('class', `babel-gapping-correspondence ${className}`)
      .attr('marker-end', `url(#${markerId})`)
      .attr('d', [
        `M ${source.x.toFixed(1)} ${(source.y + 12.6).toFixed(1)}`,
        `C ${source.x.toFixed(1)} ${laneY.toFixed(1)}`,
        `${target.x.toFixed(1)} ${laneY.toFixed(1)}`,
        `${target.x.toFixed(1)} ${(target.y + 12.6).toFixed(1)}`
      ].join(' '));
    appendCorrespondence(
      primitive.antecedent,
      primitive.gap,
      'babel-gapping-correspondence-predicate',
      laneBase
    );
    primitive.pairs.forEach((pair, pairIndex) => {
      appendCorrespondence(
        pair.correlate,
        pair.remnant,
        'babel-gapping-correspondence-pair',
        laneBase + 44 + pairIndex * 38
      );
      layer.append('text')
        .attr('class', 'babel-gapping-index babel-relation-index')
        .attr('x', (pair.correlate.x + 38).toFixed(1))
        .attr('y', (pair.correlate.y - 9.4).toFixed(1))
        .text(pair.label);
      layer.append('text')
        .attr('class', 'babel-gapping-index babel-relation-index')
        .attr('x', (pair.remnant.x + 38).toFixed(1))
        .attr('y', (pair.remnant.y - 9.4).toFixed(1))
        .text(`=${pair.label}`);
    });
    const antecedentAnchor = resolveOverlayAnchor(primitive.antecedentNodeId);
    const antecedentTerminal = resolveMaterializedTerminal(
      antecedentAnchor,
      primitive.antecedentNodeId
    );
    if (antecedentTerminal) {
      const terminalId = getNodeId(antecedentTerminal as unknown as HierNode);
      g.selectAll<SVGTextElement, HierNode>('.terminal-label')
        .filter((candidate) => getNodeId(candidate) === terminalId)
        .classed('babel-lens-node', true)
        .attr('data-lens-role', 'ellipsis-antecedent')
        .each(function markProductionLensOwner() {
          (this as SVGTextElement & { __babelProductionLens?: true }).__babelProductionLens = true;
        });
    }
    return;
  };
  const drawDomainRegion = (primitive: Extract<BoundPrimitive, { type: 'domain-region' }>, planItem: RelationPlanItem, host: DrawingLayer, emphasis: RelationEmphasis) => {
    if (primitive.domainStyle === 'transfer-edge') {
      queueAcceptedRelationDraw(planItem, emphasis, () => {
        const edgeItem = planItem.kind === 'domain-mark'
          && planItem.domainStyle === 'transfer-edge'
          ? planItem
          : null;
        if (!edgeItem) return;
        const { background, foreground } = ensureDomainLocalityLayers();
        const edgeNodeIds = edgeItem.memberNodeIds.length ? edgeItem.memberNodeIds
          : edgeItem.rootNodeId ? [edgeItem.rootNodeId] : [];
        edgeNodeIds.forEach((edgeNodeId) => {
          const edgeRect = measuredTreeLabelRectNow(edgeNodeId, false);
          if (!edgeRect) return;
          const outline = fongEdgeOutlineRect(edgeRect);
          background.append('rect')
            .attr('class', 'babel-transfer-edge-outline')
            .attr('data-transfer-edge-node', edgeNodeId)
            .attr('x', outline.x.toFixed(1))
            .attr('y', outline.y.toFixed(1))
            .attr('width', outline.width.toFixed(1))
            .attr('height', outline.height.toFixed(1))
            .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
          foreground.append('text')
            .attr('class', 'babel-transfer-edge-label')
            .attr('x', (outline.x - 24).toFixed(1))
            .attr('y', (outline.y + outline.height / 2 + 8).toFixed(1))
            .attr('opacity', emphasis === 'quiet' ? 0.3 : null)
            .text(edgeItem.label || 'Phase edge');
          markPreterminalLensNode(edgeNodeId, 'edge');
        });
      });
      return;
    }
    if (
      primitive.domainStyle === 'control-domain'
      && planItem.familyId === 'control.dependency'
      && planItem.kind === 'domain-mark'
    ) {
      const layer = ensureControlRelationLayer(planItem, emphasis);
      layer.append('rect')
        .attr('class', 'babel-control-domain')
        .attr('data-control-domain', planItem.rootNodeId || '')
        .attr('x', primitive.x)
        .attr('y', primitive.y)
        .attr('width', primitive.width)
        .attr('height', primitive.height)
        .attr('rx', 3);
      return;
    }
    const fillOnly = primitive.domainStyle === 'transfer-spellout';
    const isTransferEdge = primitive.domainStyle === 'transfer-edge';
    host.append('rect')
      .attr('class', `vr-domain-region vr-domain-${primitive.domainStyle}`)
      .attr('data-vr-outcome', primitive.outcome || '')
      .attr('x', primitive.x)
      .attr('y', primitive.y)
      .attr('width', primitive.width)
      .attr('height', primitive.height)
      .attr('rx', isTransferEdge ? 6 : 18)
      .attr('fill', fillOnly || primitive.domainStyle === 'forbidden-region'
        ? 'rgba(52,211,153,0.07)'
        : 'none')
      .attr('stroke', fillOnly ? 'none' : (primitive.outcome === 'blocked' ? '#f87171' : '#34d399'))
      .attr('stroke-opacity', isTransferEdge ? 0.8 : 0.55)
      .attr('stroke-width', 1.6)
      .attr('stroke-dasharray', ['adjunct-domain', 'scope', 'forbidden-region', 'control-domain'].includes(primitive.domainStyle) ? '7 7' : null)
      .attr('vector-effect', 'non-scaling-stroke');
    if (primitive.outcome === 'blocked' || primitive.label) {
      const edgeMarker = isTransferEdge
        ? appendMarker(primitive.x - 8, primitive.y + primitive.height / 2)
        : appendMarker(primitive.x + primitive.width, primitive.y);
      edgeMarker.append('text')
        .attr('text-anchor', isTransferEdge ? 'end' : 'start')
        .attr('font-size', '12px')
        .attr('fill', primitive.outcome === 'blocked' ? '#f87171' : '#a7f3d0')
        .text(primitive.outcome === 'blocked' ? '✗' : primitive.label || '');
    }
    return;
  };
  return { drawGappingAlignment, drawDomainRegion };
}
