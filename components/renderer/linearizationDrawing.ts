import * as d3 from 'd3';
import { getNodeId } from '../../replay/displayIdentity.ts';
import { spaceAuthoredName } from '../../replay/displayText.ts';
import {
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import { availableTreeViewport, linearizationViewport } from '../treeViewport.ts';
import type { ClaimDrawing, DrawingLayer, RelationEmphasis, TreeMeasurements } from './drawingContext.ts';

import { nativeLinearizationPlateHeight } from '../../replay/relations/nativeDrawingContent.ts';
import {
  planAnchorSetLayout
} from '../../replay/relations/overlayGeometry.ts';

interface LinearizationDrawingContext extends Pick<ClaimDrawing, 'relationLayerKey' | 'acceptedRelationDrawingKey' | 'queueAcceptedRelationDraw'>, Pick<TreeMeasurements, 'exactScreenTreeLabelRectNow' | 'exactScreenDirectTreeLabelRectNow'> {
  frameItems: RelationPlanItem[];
  scheduledAcceptedPfRelations: Set<string>;
  g: DrawingLayer;
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  treeData: d3.HierarchyPointNode<SyntaxNode>;
  uiBounds: { top: number; right: number; bottom: number; headerBottom: number; panelTop: number };
}

export function createLinearizationDrawing({
  relationLayerKey,
  frameItems,
  acceptedRelationDrawingKey,
  scheduledAcceptedPfRelations,
  queueAcceptedRelationDraw,
  g,
  svg,
  exactScreenTreeLabelRectNow,
  treeData,
  exactScreenDirectTreeLabelRectNow,
  uiBounds
}: LinearizationDrawingContext) {
  const scheduleAcceptedCyclicLinearization = (
    item: RelationPlanItem,
    emphasis: RelationEmphasis
  ) => {
    if (item.kind !== 'node-plaque' && item.kind !== 'anchor-set') return false;
    // A large-array rail belongs to its authored relation, not to one claim, so
    // it carries no Tier-2 claim identity. A Tier-2 Ordering owns its rail
    // through the rail's organization owners; a Tier-1 Ordering shares its key.
    const organizes = (owner: RelationPlanItem, rail: RelationPlanItem) => rail.kind === 'anchor-set'
      && rail.relationRef.stageIndex === owner.relationRef.stageIndex
      && rail.relationRef.relationIndex === owner.relationRef.relationIndex
      && (relationLayerKey(rail) === relationLayerKey(owner)
        || Boolean(owner.tier2ClaimIdentity && rail.organizationOwners?.includes(owner.tier2ClaimIdentity)));
    const cyclicItem = frameItems.find((candidate) =>
      candidate.familyId === 'pf.cyclic-linearization'
      && candidate.kind === 'node-plaque'
      && (item.kind === 'anchor-set' ? organizes(candidate, item) : relationLayerKey(candidate) === relationLayerKey(item)));
    const anchorSetItem = cyclicItem && frameItems.find((candidate) => organizes(cyclicItem, candidate));
    if (cyclicItem?.kind !== 'node-plaque' || cyclicItem.nativeContent?.kind !== 'linearization') return false;
    const content = cyclicItem.nativeContent;
    const drawingKey = acceptedRelationDrawingKey(cyclicItem);
    if (!scheduledAcceptedPfRelations.has(drawingKey)) {
      scheduledAcceptedPfRelations.add(drawingKey);
      queueAcceptedRelationDraw(item, emphasis, () => {
        const root = g.node();
        const matrix = root?.getScreenCTM();
        const svgRect = svg.node()?.getBoundingClientRect();
        if (!root || !matrix || !svgRect) return;
        const inverse = matrix.inverse();
        const toLocal = (clientX: number, clientY: number) =>
          new DOMPoint(clientX, clientY).matrixTransform(inverse);
        const screenScale = Math.max(0.001, Math.hypot(matrix.a, matrix.b));
        const localPx = (pixels: number) => pixels / screenScale;
        const viewport = availableTreeViewport(svgRect.width, svgRect.height, uiBounds);
        const treeLocalRect = exactScreenTreeLabelRectNow(
          getNodeId(treeData as unknown as HierNode),
          true
        );
        const anchorPlan = anchorSetItem?.kind === 'anchor-set' ? planAnchorSetLayout(
          [anchorSetItem.set],
          (nodeId) => exactScreenDirectTreeLabelRectNow(nodeId)
            || exactScreenTreeLabelRectNow(nodeId, true),
          {
            badgeOffsetY: localPx(16),
            railGap: localPx(14)
          }
        ) : { badges: [], rails: [] };
        if (anchorSetItem?.kind === 'anchor-set' && anchorPlan.badges.length > 0) {
          const anchorLayer = g.append('g')
            .attr('class', 'babel-anchor-set-relation-layer')
            .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
          const anchorLayerNode = anchorLayer.node();
          if (anchorLayerNode) {
            (anchorLayerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
          }
          const railBase = (treeLocalRect
            ? treeLocalRect.y + treeLocalRect.height
            : Math.max(...anchorPlan.badges.map((badge) => badge.y))) + localPx(52);
          const railYFor = (lane: number) => railBase + lane * localPx(26);
          const railLabelMinX = toLocal(svgRect.left + 18, svgRect.top).x;
          // Screen-sized captions are painted after fitting; retain the measured UI clearance.
          const canvasTop = svg.node()?.parentElement?.getBoundingClientRect().top ?? svgRect.top;
          const railLabelBottom = canvasTop + viewport.bottom;
          anchorPlan.rails.forEach((rail) => {
            const y = railYFor(rail.lane);
            anchorLayer.append('line')
              .attr('class', 'babel-anchor-set-rail')
              .attr('x1', rail.x1.toFixed(1))
              .attr('x2', rail.x2.toFixed(1))
              .attr('y1', y.toFixed(1))
              .attr('y2', y.toFixed(1));
            const caption = anchorLayer.append('text')
              .attr('class', 'babel-anchor-set-rail-label')
              .attr('x', Math.max(rail.x1, railLabelMinX).toFixed(1))
              .attr('y', (y - localPx(6)).toFixed(1))
              .style('font-size', `${localPx(10)}px`)
              .text(`${spaceAuthoredName(anchorSetItem.set.relation, { snakeCase: true })}${anchorSetItem.set.instanceIndex > 0
                ? ` (${anchorSetItem.set.instanceIndex + 1})`
                : ''} · ${spaceAuthoredName(rail.role, { snakeCase: true })}`);
            const overflow = (caption.node()?.getBoundingClientRect().bottom ?? 0) - railLabelBottom;
            if (overflow > 0) {
              caption.attr('y', (y - localPx(6) - localPx(overflow)).toFixed(1));
            }
            anchorPlan.badges
              .filter((badge) => badge.setIndex === rail.setIndex && badge.role === rail.role)
              .forEach((badge) => {
                anchorLayer.append('line')
                  .attr('class', 'babel-anchor-set-stub')
                  .attr('x1', badge.x.toFixed(1))
                  .attr('x2', badge.x.toFixed(1))
                  .attr('y1', (badge.y + localPx(5)).toFixed(1))
                  .attr('y2', y.toFixed(1));
              });
          });
          anchorPlan.badges.forEach((badge) => {
            anchorLayer.append('circle')
              .attr('class', 'babel-anchor-set-badge')
              .attr('data-anchor-set-node', badge.nodeId)
              .attr('data-anchor-set-role', badge.role)
              .attr('cx', badge.x.toFixed(1))
              .attr('cy', badge.y.toFixed(1))
              .attr('r', localPx(7).toFixed(2));
            anchorLayer.append('text')
              .attr('class', 'babel-anchor-set-badge-number')
              .attr('x', badge.x.toFixed(1))
              .attr('y', (badge.y + localPx(2.7)).toFixed(1))
              .attr('text-anchor', 'middle')
              .style('font-size', `${localPx(8)}px`)
              .text(String(badge.arrayIndex + 1));
          });
        }

        const { priorRows: priorPairs, currentRows: currentPairs, conflict } = content;
        const widthPx = 350;
        const rowGapPx = 17;
        const heightPx = nativeLinearizationPlateHeight(content);
        const width = localPx(widthPx);
        const height = localPx(heightPx);
        const placement = linearizationViewport(viewport, heightPx);
        const origin = toLocal(
          svgRect.left + placement.left,
          svgRect.top + placement.top
        );
        const layer = g.append('g')
          .attr('class', 'babel-pf-morphology-relation-layer')
          .attr('transform', `translate(${origin.x} ${origin.y}) scale(${placement.scale}) translate(${-origin.x} ${-origin.y})`)
          .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
        const layerNode = layer.node();
        if (layerNode) {
          (layerNode as SVGGElement & { __babelProductionRelation?: true }).__babelProductionRelation = true;
        }
        layer.append('rect')
          .attr('class', 'babel-pf-morphology-shell')
          .attr('x', origin.x.toFixed(1))
          .attr('y', origin.y.toFixed(1))
          .attr('width', width.toFixed(1))
          .attr('height', height.toFixed(1))
          .attr('rx', localPx(8).toFixed(1))
          .style('stroke-width', `${localPx(1.5)}px`);
        layer.append('text')
          .attr('class', conflict ? 'babel-linearization-failure-mark' : 'babel-pf-morphology-title')
          .attr('x', (origin.x + localPx(20)).toFixed(1))
          .attr('y', (origin.y + localPx(23)).toFixed(1))
          .style('font-size', `${localPx(13)}px`)
          .text(conflict ? '* ORDERING' : 'ORDERING');
        layer.append('line')
          .attr('class', 'babel-pf-morphology-rule')
          .attr('x1', (origin.x + localPx(20)).toFixed(1))
          .attr('y1', (origin.y + localPx(33)).toFixed(1))
          .attr('x2', (origin.x + width - localPx(20)).toFixed(1))
          .attr('y2', (origin.y + localPx(33)).toFixed(1))
          .style('stroke-width', `${localPx(1)}px`);
        const leftX = origin.x + localPx(22);
        const rightX = origin.x + localPx(widthPx / 2 + 7);
        const appendColumnTitle = (x: number, label: string) => layer.append('text')
          .attr('class', 'babel-linearization-column-title')
          .attr('x', x.toFixed(1))
          .attr('y', (origin.y + localPx(51)).toFixed(1))
          .style('font-size', `${localPx(10)}px`)
          .text(label);
        appendColumnTitle(leftX, 'PRIOR DOMAIN');
        appendColumnTitle(rightX, 'CURRENT DOMAIN');
        priorPairs.forEach((row, index) => {
          layer.append('text')
            .attr('class', 'babel-linearization-row')
            .attr('x', leftX.toFixed(1))
            .attr('y', (origin.y + localPx(70 + index * rowGapPx)).toFixed(1))
            .style('font-size', `${localPx(11)}px`)
            .text(row);
        });
        currentPairs.forEach((row, index) => {
          const current = layer.append('text')
            .attr('class', conflict
              ? 'babel-linearization-row babel-linearization-row-conflict'
              : 'babel-linearization-row babel-linearization-row-current')
            .attr('x', rightX.toFixed(1))
            .attr('y', (origin.y + localPx(70 + index * rowGapPx)).toFixed(1))
            .style('font-size', `${localPx(11)}px`)
            .text(row);
          if (conflict) current.style('text-decoration-thickness', `${localPx(1.5)}px`);
        });
      });
    }
    return true;
  };
  return { scheduleAcceptedCyclicLinearization };
}
