import * as d3 from 'd3';
import { getNodeId } from '../../replay/displayIdentity.ts';
import {
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import type { ClaimDrawing, DrawingLayer, RelationEmphasis, TreeMeasurements } from './drawingContext.ts';

interface SharingDrawingContext extends Pick<ClaimDrawing, 'relationLayerKey' | 'acceptedRelationDrawingKey' | 'queueAcceptedRelationDraw'>, Pick<TreeMeasurements, 'exactScreenTreeLabelRectNow' | 'exactScreenTreeLabelRectForNodeIdsNow'> {
  g: DrawingLayer;
  frameItems: RelationPlanItem[];
  overlayNodeById: Map<string, d3.HierarchyPointNode<SyntaxNode>>;
  labelBelongsToNode: (element: SVGGraphicsElement, id: string) => boolean;
}

export function createSharingDrawing({
  relationLayerKey,
  acceptedRelationDrawingKey,
  queueAcceptedRelationDraw,
  g,
  frameItems,
  overlayNodeById,
  labelBelongsToNode,
  exactScreenTreeLabelRectNow,
  exactScreenTreeLabelRectForNodeIdsNow
}: SharingDrawingContext) {
  const scheduledAcceptedSharingRelations = new Set<string>();
  const scheduleAcceptedSharingRelation = (
    item: RelationPlanItem,
    emphasis: RelationEmphasis
  ) => {
    if (
      item.familyId !== 'multidominance.shared-node'
      && item.familyId !== 'argument-sharing.domains'
    ) return false;
    const key = relationLayerKey(item);
    const drawingKey = acceptedRelationDrawingKey(item);
    if (!scheduledAcceptedSharingRelations.has(drawingKey)) {
      scheduledAcceptedSharingRelations.add(drawingKey);
      queueAcceptedRelationDraw(item, emphasis, () => {
        const root = g.node();
        if (!root) return;
        const layerNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
        const layer = d3.select<SVGGElement, unknown>(layerNode);

        if (item.familyId === 'multidominance.shared-node') {
          root.appendChild(layerNode);
          const sharedItem = frameItems.find((candidate) =>
            candidate.familyId === 'multidominance.shared-node'
            && relationLayerKey(candidate) === key
            && candidate.kind === 'shared-node');
          if (!sharedItem || sharedItem.kind !== 'shared-node') {
            layer.remove();
            return;
          }
          layer.attr('class', 'babel-multidominance-relation-layer');
          const sharedAnchor = overlayNodeById.get(sharedItem.sharedNodeId);
          const sharedIds = new Set(
            sharedAnchor?.descendants().map((candidate) =>
              getNodeId(candidate as unknown as HierNode)) || [sharedItem.sharedNodeId]
          );
          g.selectAll<SVGTextElement, HierNode>('.category-label, .terminal-label')
            .filter(function sharedSubtreeLabel() {
              return [...sharedIds].some((nodeId) =>
                labelBelongsToNode(this, String(nodeId)));
            })
            .classed('babel-multidominance-shared-label', true)
            .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
          if ((sharedAnchor?.children || []).length > 1) {
            const sharedTerminalIds = new Set(
              sharedAnchor?.descendants()
                .filter((candidate) => (candidate.children || []).length === 0)
                .map((candidate) => getNodeId(candidate as unknown as HierNode)) || []
            );
            g.selectAll<SVGTextElement, HierNode>('.terminal-label')
              .filter((candidate) => sharedTerminalIds.has(getNodeId(candidate)))
              .classed('babel-lens-node', true)
              .attr('data-lens-role', 'shared-node')
              .each(function markProductionSharedWitness() {
                (this as SVGTextElement & { __babelProductionLens?: true }).__babelProductionLens = true;
              });
          }
          const sharedRect = exactScreenTreeLabelRectNow(sharedItem.sharedNodeId, false);
          if (!sharedRect) {
            layer.remove();
            return;
          }
          const target = {
            x: sharedRect.x + sharedRect.width / 2,
            y: sharedRect.y + sharedRect.height / 2
          };
          const nativeParentId = sharedAnchor?.parent
            ? getNodeId(sharedAnchor.parent as unknown as HierNode)
            : null;
          sharedItem.parentNodeIds.filter((parentNodeId) => parentNodeId !== nativeParentId).forEach((parentNodeId) => {
            const parentRect = exactScreenTreeLabelRectNow(parentNodeId, false);
            if (!parentRect) return;
            const source = {
              x: parentRect.x + parentRect.width / 2,
              y: parentRect.y + parentRect.height / 2
            };
            const path = `M ${source.x.toFixed(1)} ${source.y.toFixed(1)} L ${target.x.toFixed(1)} ${target.y.toFixed(1)}`;
            layer.append('path')
              .attr('class', 'babel-multidominance-branch-shadow')
              .attr('d', path)
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
            layer.append('path')
              .attr('class', 'babel-multidominance-branch')
              .attr('d', path)
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
          });
          return;
        }

        const relatedItems = frameItems.filter((candidate) =>
          candidate.familyId === 'argument-sharing.domains'
          && relationLayerKey(candidate) === key);
        const domains = relatedItems.filter((candidate) => candidate.kind === 'domain-mark');
        const sharedNodeId = domains[0]?.sharedNodeId;
        if (domains.length < 2 || !sharedNodeId
          || domains.some((domain) => domain.sharedNodeId !== sharedNodeId)) {
          layer.remove();
          return;
        }
        const roleItem = relatedItems.find((candidate) =>
          candidate.kind === 'node-badges'
          && candidate.badgeStyle === 'shared-object'
          && candidate.badges.length === 1
          && candidate.badges[0].nodeId === sharedNodeId);
        const roleLabel = roleItem?.kind === 'node-badges'
          ? roleItem.badges[0]?.text || ''
          : '';
        const firstNodeGroup = g.select<SVGGElement>('.node-group').node();
        if (firstNodeGroup?.parentNode === root) root.insertBefore(layerNode, firstNodeGroup);
        else root.appendChild(layerNode);
        layer.attr('class', 'babel-argument-sharing-relation-layer');
        domains.forEach((domain, domainIndex) => {
          if (domain.kind !== 'domain-mark') return;
          const combinedRect = exactScreenTreeLabelRectForNodeIdsNow([
            domain.rootNodeId!,
            sharedNodeId
          ]);
          if (!combinedRect) return;
          const cx = combinedRect.x + combinedRect.width / 2;
          const cy = combinedRect.y + combinedRect.height / 2;
          const rx = (combinedRect.width / 2 + 18) * Math.SQRT2;
          const ry = (combinedRect.height / 2 + 16) * Math.SQRT2;
          const rotation = domainIndex === 0 ? -10 : 10;
          layer.append('ellipse')
            .attr('class', 'babel-argument-sharing-domain')
            .attr('data-argument-domain', String(domainIndex + 1))
            .attr('data-shared-node', sharedNodeId)
            .attr('cx', cx.toFixed(1))
            .attr('cy', cy.toFixed(1))
            .attr('rx', rx.toFixed(1))
            .attr('ry', ry.toFixed(1))
            .attr('transform', `rotate(${rotation} ${cx.toFixed(1)} ${cy.toFixed(1)})`)
            .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
        });
        if (!roleLabel) return;
        const sharedRect = exactScreenTreeLabelRectNow(sharedNodeId, false);
        if (!sharedRect) {
          layer.remove();
          return;
        }
        const boxWidth = Math.max(96, roleLabel.length * 24 + 36);
        const boxHeight = 48;
        const boxX = sharedRect.x + sharedRect.width / 2 - boxWidth / 2;
        const boxY = sharedRect.y - boxHeight - 28;
        layer.append('rect')
          .attr('class', 'babel-argument-sharing-object-box')
          .attr('x', boxX.toFixed(1))
          .attr('y', boxY.toFixed(1))
          .attr('width', boxWidth.toFixed(1))
          .attr('height', boxHeight.toFixed(1))
          .attr('rx', 4)
          .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
        layer.append('text')
          .attr('class', 'babel-argument-sharing-object-label')
          .attr('x', (boxX + boxWidth / 2).toFixed(1))
          .attr('y', (boxY + 33).toFixed(1))
          .attr('opacity', emphasis === 'quiet' ? 0.3 : null)
          .text(roleLabel);
      });
    }
    return true;
  };
  return { scheduleAcceptedSharingRelation };
}
