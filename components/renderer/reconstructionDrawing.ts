import {
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import { type HierNode } from '../../replay/types.ts';
import type { ClaimDrawing, DrawingLayer, RelationEmphasis, TreeMeasurements } from './drawingContext.ts';

interface ReconstructionDrawingContext extends Pick<ClaimDrawing, 'relationLayerKey' | 'queueAcceptedRelationDraw'>, Pick<TreeMeasurements, 'exactScreenTreeLabelRectNow'> {
  frameItems: RelationPlanItem[];
  g: DrawingLayer;
  labelBelongsToNode: (element: SVGGraphicsElement, id: string) => boolean;
}

export function createReconstructionDrawing({ relationLayerKey, queueAcceptedRelationDraw, frameItems, g, labelBelongsToNode, exactScreenTreeLabelRectNow }: ReconstructionDrawingContext) {
  const scheduledAcceptedLfRelations = new Set<string>();
  const scheduleAcceptedLfReconstruction = (
    item: RelationPlanItem,
    emphasis: RelationEmphasis
  ) => {
    if (item.familyId !== 'lf.reconstruction') return false;
    const key = relationLayerKey(item);
    if (!scheduledAcceptedLfRelations.has(key)) {
      scheduledAcceptedLfRelations.add(key);
      queueAcceptedRelationDraw(item, emphasis, () => {
        const relationItems = frameItems.filter((candidate) =>
          candidate.familyId === 'lf.reconstruction'
          && relationLayerKey(candidate) === key);
        const strikeItem = relationItems.find((candidate) => candidate.kind === 'strike-ghost');
        const coindexItem = relationItems.find((candidate) => candidate.kind === 'coindex');
        if (!strikeItem || strikeItem.kind !== 'strike-ghost'
          || !coindexItem || coindexItem.kind !== 'coindex') return;

        const neglectedNodeId = strikeItem.strikeNodeIds[0];
        const ghostNodeIds = new Set(strikeItem.ghostNodeIds);
        const ghostLabels = g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
          .filter(function acceptedLfGhostLabel() {
            return [...ghostNodeIds].some((nodeId) =>
              labelBelongsToNode(this, String(nodeId)));
          });
        ghostLabels
          .classed('babel-lf-ghost-label', true)
          .classed('babel-lf-copy-label', true)
          .style('fill', 'rgba(209, 250, 229, 0.38)', 'important')
          .style('stroke', 'rgba(1, 8, 5, 0.62)', 'important')
          .style('opacity', '0.58', 'important')
          .style('filter', 'blur(0.22px)', 'important');

        const coindexLayer = g.append('g').attr('class', 'babel-coindex-relation-layer');
        const coindexNode = coindexLayer.node();
        if (coindexNode) {
          (coindexNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
        }
        if (emphasis === 'quiet') coindexLayer.attr('opacity', 0.3);
        coindexItem.nodeIds.forEach((nodeId) => {
          const rect = exactScreenTreeLabelRectNow(nodeId, false)
            || exactScreenTreeLabelRectNow(nodeId, true);
          if (!rect) return;
          coindexLayer.append('text')
            .attr('class', 'babel-binding-index babel-relation-index')
            .attr('x', (rect.x + rect.width + 12).toFixed(1))
            .attr('y', (rect.y + rect.height / 2 + 30).toFixed(1))
            .text(coindexItem.index);
        });

        const layer = g.append('g').attr('class', 'babel-lf-relation-layer');
        const layerNode = layer.node();
        if (layerNode) {
          (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
        }
        if (emphasis === 'quiet') layer.attr('opacity', 0.3);
        const markerId = `babel-lf-arrow-${item.relationRef.stageIndex}-${item.relationRef.relationIndex}`;
        const marker = layer.append('defs').append('marker')
          .attr('id', markerId)
          .attr('markerWidth', 34)
          .attr('markerHeight', 34)
          .attr('refX', 22)
          .attr('refY', 17)
          .attr('orient', 'auto')
          .attr('markerUnits', 'userSpaceOnUse')
          .attr('overflow', 'visible');
        marker.append('path')
          .attr('class', 'babel-lf-arrowhead')
          .attr('d', 'M 7 25 L 22 17 L 7 9');

        const rect = exactScreenTreeLabelRectNow(neglectedNodeId, true);
        if (!rect) return;
        const strikeY = rect.y + rect.height * 0.56;
        ['babel-lf-strike-shadow', 'babel-lf-strike'].forEach((className) => {
          layer.append('line')
            .attr('class', className)
            .attr('x1', (rect.x - 14).toFixed(1))
            .attr('x2', (rect.x + rect.width + 14).toFixed(1))
            .attr('y1', strikeY.toFixed(1))
            .attr('y2', strikeY.toFixed(1));
        });
      });
    }
    return true;
  };
  return { scheduleAcceptedLfReconstruction };
}
