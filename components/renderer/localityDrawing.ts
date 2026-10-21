import * as d3 from 'd3';
import { type BoundPrimitive } from '../../replay/relations/boundGeometry.ts';
import { boundingRect } from '../../replay/relations/rectGeometry.ts';
import {
  type DirectedPathPlanItem,
  type RelationPlanItem
} from '../../replay/relations/renderPlan.ts';
import type { ClaimDrawing, DrawingLayer, RelationEmphasis, TreeMeasurements } from './drawingContext.ts';

import {
  blockingCrossSegments
} from '../../replay/relations/markGeometry.ts';

interface LocalityDrawingContext extends Pick<ClaimDrawing, 'relationLayerKey' | 'queueAcceptedRelationDraw'>, Pick<TreeMeasurements, 'measuredTreeLabelRectNow'> {
  g: DrawingLayer;
  activeDerivationFrameIndex: number;
  frameItems: RelationPlanItem[];
}

export function createLocalityDrawing({ g, activeDerivationFrameIndex, relationLayerKey, queueAcceptedRelationDraw, frameItems, measuredTreeLabelRectNow }: LocalityDrawingContext) {
  let domainLocalityBackgroundLayer: DrawingLayer | null = null;
  let domainLocalityForegroundLayer: DrawingLayer | null = null;
  const ensureDomainLocalityLayers = () => {
    if (domainLocalityBackgroundLayer && domainLocalityForegroundLayer) {
      return {
        background: domainLocalityBackgroundLayer,
        foreground: domainLocalityForegroundLayer,
        markerId: domainLocalityForegroundLayer.attr('data-marker-id')
      };
    }
    const background = g.insert('g', ':first-child')
      .attr('class', 'babel-domain-locality-relation-layer');
    const foreground = g.append('g')
      .attr('class', 'babel-domain-locality-relation-layer');
    const markerId = `babel-domain-locality-arrow-${activeDerivationFrameIndex}`;
    foreground.attr('data-marker-id', markerId);
    const marker = foreground.append('defs').append('marker')
      .attr('id', markerId)
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 9)
      .attr('refY', 5)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto-start-reverse')
      .attr('markerUnits', 'strokeWidth');
    marker.append('path')
      .attr('class', 'babel-domain-locality-arrowhead')
      .attr('d', 'M 0 0 L 10 5 L 0 10 z');
    domainLocalityBackgroundLayer = background;
    domainLocalityForegroundLayer = foreground;
    return { background, foreground, markerId };
  };
  const acceptedTrajectoryFor = (sourceNodeId: string, targetNodeId: string) =>
    g.selectAll<SVGPathElement, unknown>('.babel-trajectory-path')
      .filter(function matchAcceptedTrajectory() {
        return this.getAttribute('data-trajectory-from') === sourceNodeId
          && this.getAttribute('data-trajectory-to') === targetNodeId;
      })
      .node() || null;
  const pathPointAt = (path: SVGPathElement, fraction: number) => {
    const length = path.getTotalLength();
    const point = path.getPointAtLength(length * fraction);
    return { x: point.x, y: point.y };
  };
  const setAcceptedTrajectoryEmphasis = (
    path: SVGPathElement,
    emphasis: RelationEmphasis
  ) => {
    const host = path.parentElement ? d3.select(path.parentElement) : null;
    if (!host) return;
    host.attr('opacity', emphasis === 'quiet' ? 0.3 : null);
  };
  const scheduledAcceptedLocalityRelations = new Set<string>();
  const scheduleAcceptedAntiLocality = (
    item: RelationPlanItem,
    emphasis: RelationEmphasis,
    primitive: BoundPrimitive
  ) => {
    if (item.familyId !== 'anti-locality.paths') return false;
    const key = relationLayerKey(item);
    if (!scheduledAcceptedLocalityRelations.has(key)) {
      scheduledAcceptedLocalityRelations.add(key);
      queueAcceptedRelationDraw(item, emphasis, () => {
        const pathItem = frameItems.find((candidate) =>
          candidate.familyId === 'anti-locality.paths'
          && relationLayerKey(candidate) === key
          && candidate.kind === 'directed-path'
          && candidate.pathStyle === 'anti-locality');
        if (!pathItem || pathItem.kind !== 'directed-path') return;
        const movementItem = frameItems.find((candidate) =>
          candidate.kind === 'trajectory'
          && candidate.sourceNodeId === pathItem.fromNodeId
          && candidate.targetNodeId === pathItem.toNodeId);
        let pathNode = movementItem && movementItem.kind === 'trajectory'
          ? acceptedTrajectoryFor(movementItem.sourceNodeId, movementItem.targetNodeId)
          : null;
        if (!pathNode && primitive.type === 'shape-path' && primitive.shapeStyle === 'anti-locality') {
          const { foreground } = ensureDomainLocalityLayers();
          const styleClass = pathItem.outcome === 'blocked'
            ? 'babel-locality-path-failed'
            : 'babel-locality-path-licensed';
          foreground.append('path')
            .attr('class', `babel-trajectory-path-shadow ${styleClass}`)
            .attr('data-trajectory-from', pathItem.fromNodeId)
            .attr('data-trajectory-to', pathItem.toNodeId)
            .attr('d', primitive.d)
            .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
          pathNode = foreground.append('path')
            .attr('class', `babel-trajectory-path ${styleClass}`)
            .attr('data-trajectory-from', pathItem.fromNodeId)
            .attr('data-trajectory-to', pathItem.toNodeId)
            .attr('d', primitive.d)
            .attr('opacity', emphasis === 'quiet' ? 0.3 : null)
            .node();
        }
        if (!pathNode) return;
        const path = d3.select(pathNode);
        const shadowNode = pathNode.previousElementSibling instanceof SVGPathElement
          && pathNode.previousElementSibling.classList.contains('babel-trajectory-path-shadow')
          ? pathNode.previousElementSibling
          : null;
        const outcome = pathItem.outcome;
        if (outcome !== 'blocked' && outcome !== 'licensed') return;
        const styleClass = outcome === 'blocked'
          ? 'babel-locality-path-failed'
          : 'babel-locality-path-licensed';
        path.classed(styleClass, true);
        if (shadowNode) d3.select(shadowNode).classed(styleClass, true);
        setAcceptedTrajectoryEmphasis(pathNode, emphasis);

        let endpoint = pathPointAt(pathNode, 1);
        if (outcome === 'blocked') {
          const landingRect = measuredTreeLabelRectNow(pathItem.toNodeId, false);
          const start = pathPointAt(pathNode, 0);
          const end = {
            x: landingRect
              ? landingRect.x + landingRect.width / 2
              : endpoint.x,
            y: endpoint.y
          };
          const depth = Math.max(start.y, end.y)
            + Math.max(180, Math.abs(start.x - end.x) * 0.2);
          const d = [
            `M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`,
            `Q ${end.x.toFixed(1)} ${depth.toFixed(1)}`,
            `${end.x.toFixed(1)} ${end.y.toFixed(1)}`
          ].join(' ');
          path.attr('d', d).attr('marker-end', null);
          if (shadowNode) d3.select(shadowNode).attr('d', d);
          endpoint = end;
        }

        const { background, foreground } = ensureDomainLocalityLayers();
        if (outcome === 'blocked') {
          const cap = [
            `M ${(endpoint.x - 14).toFixed(1)} ${endpoint.y.toFixed(1)}`,
            `L ${(endpoint.x + 14).toFixed(1)} ${endpoint.y.toFixed(1)}`
          ].join(' ');
          foreground.append('path')
            .attr('class', 'babel-anti-locality-cap-shadow')
            .attr('d', cap)
            .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
          foreground.append('path')
            .attr('class', 'babel-anti-locality-cap')
            .attr('d', cap)
            .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
        }
        foreground.append('text')
          .attr('class', 'babel-anti-locality-face')
          .attr('x', (endpoint.x + 28).toFixed(1))
          .attr('y', (endpoint.y + 10).toFixed(1))
          .attr('opacity', emphasis === 'quiet' ? 0.3 : null)
          .text(outcome === 'blocked' ? '☹' : '☺');
        if ((background.node()?.childNodes.length || 0) === 0) {
          background.remove();
          domainLocalityBackgroundLayer = null;
        }
      });
    }
    return true;
  };
  const scheduleAcceptedImproperMovement = (
    item: RelationPlanItem,
    emphasis: RelationEmphasis
  ) => {
    if (item.familyId !== 'improper-movement.landing') return false;
    const key = relationLayerKey(item);
    if (!scheduledAcceptedLocalityRelations.has(key)) {
      scheduledAcceptedLocalityRelations.add(key);
      queueAcceptedRelationDraw(item, emphasis, () => {
        const relatedItems = frameItems.filter((candidate) =>
          candidate.familyId === 'improper-movement.landing'
          && relationLayerKey(candidate) === key);
        const domainItem = relatedItems.find((candidate) =>
          candidate.kind === 'domain-mark'
          && candidate.domainStyle === 'forbidden-region');
        const candidatePaths = relatedItems.filter((candidate): candidate is DirectedPathPlanItem =>
          candidate.kind === 'directed-path'
          && ['anti-locality', 'improper-candidate'].includes(candidate.pathStyle)
          && (candidate.outcome === 'licensed' || candidate.outcome === 'blocked'));
        if (!candidatePaths.length) return;
        const sourceNodeId = candidatePaths[0].sourceOccurrenceNodeId || candidatePaths[0].fromNodeId;
        if (candidatePaths.some((path) => (path.sourceOccurrenceNodeId || path.fromNodeId) !== sourceNodeId)) return;
        const memberRects = domainItem?.kind === 'domain-mark'
          ? domainItem.memberNodeIds
            .map((nodeId) => measuredTreeLabelRectNow(nodeId, true))
            .filter((rect): rect is { x: number; y: number; width: number; height: number } => Boolean(rect))
          : [];
        const region = memberRects.length ? boundingRect(memberRects) : null;
        const source = measuredTreeLabelRectNow(sourceNodeId, false)
          || measuredTreeLabelRectNow(sourceNodeId, true);
        if (!source) return;

        const forbiddenBox = region ? {
          x: region.x - 38,
          y: region.y - 32,
          width: region.width + 76,
          height: region.height + 64
        } : null;
        const candidates = candidatePaths.map((path) => ({ nodeId: path.toNodeId, outcome: path.outcome! }))
          .map((candidate) => ({
            ...candidate,
            rect: measuredTreeLabelRectNow(candidate.nodeId, false)
          }))
          .filter((candidate): candidate is {
            nodeId: string;
            outcome: 'licensed' | 'blocked';
            rect: { x: number; y: number; width: number; height: number };
          } => Boolean(candidate.rect));
        if (candidates.length === 0) return;

        const { background, foreground, markerId } = ensureDomainLocalityLayers();
        if (forbiddenBox) {
          const gradientId = `babel-improper-region-gradient-${activeDerivationFrameIndex}-${item.relationRef.relationIndex}`;
          const gradient = background.append('defs').append('linearGradient')
            .attr('id', gradientId)
            .attr('x1', 0)
            .attr('y1', 0)
            .attr('x2', 0)
            .attr('y2', 1);
          gradient.append('stop')
            .attr('offset', '0%')
            .attr('stop-color', 'rgba(16, 185, 129, 0.32)');
          gradient.append('stop')
            .attr('offset', '100%')
            .attr('stop-color', 'rgba(4, 120, 87, 0.10)');
          background.append('rect')
            .attr('class', 'babel-constituent-enclosure babel-enclosure-carrier-chunk babel-improper-forbidden-region')
            .attr('x', forbiddenBox.x.toFixed(1))
            .attr('y', forbiddenBox.y.toFixed(1))
            .attr('width', forbiddenBox.width.toFixed(1))
            .attr('height', forbiddenBox.height.toFixed(1))
            .attr('opacity', emphasis === 'quiet' ? 0.3 : null)
            .style('fill', `url(#${gradientId})`);
        }

        const endpoints = candidates.map((candidate) => ({
          ...candidate,
          point: {
            x: candidate.rect.x + candidate.rect.width / 2,
            y: candidate.rect.y + candidate.rect.height + 18
          }
        }));
        const sourcePoint = {
          x: source.x + source.width / 2,
          y: source.y + source.height + 12
        };
        const laneY = Math.max(
          sourcePoint.y + 68,
          forbiddenBox ? forbiddenBox.y + forbiddenBox.height + 240 : sourcePoint.y,
          ...endpoints.map((entry) => entry.point.y + 170)
        );
        const railLeft = Math.min(...endpoints.map((entry) => entry.point.x));
        background.append('path')
          .attr('class', 'babel-improper-candidate-rail')
          .attr('d', [
            `M ${sourcePoint.x.toFixed(1)} ${sourcePoint.y.toFixed(1)}`,
            `L ${sourcePoint.x.toFixed(1)} ${laneY.toFixed(1)}`,
            `L ${railLeft.toFixed(1)} ${laneY.toFixed(1)}`
          ].join(' '))
          .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
        endpoints.forEach((entry) => {
          background.append('path')
            .attr('class', [
              'babel-improper-candidate-path',
              entry.outcome === 'blocked'
                ? 'babel-improper-candidate-path-blocked'
                : 'babel-improper-candidate-path-licensed'
            ].join(' '))
            .attr('data-candidate-node', entry.nodeId)
            .attr('data-candidate-outcome', entry.outcome)
            .attr('d', [
              `M ${entry.point.x.toFixed(1)} ${laneY.toFixed(1)}`,
              `L ${entry.point.x.toFixed(1)} ${entry.point.y.toFixed(1)}`
            ].join(' '))
            .attr('marker-end', entry.outcome === 'blocked' ? null : `url(#${markerId})`)
            .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
          if (entry.outcome !== 'blocked') return;
          const crossY = forbiddenBox ? forbiddenBox.y + forbiddenBox.height : entry.point.y + 28;
          blockingCrossSegments({ x: entry.point.x, y: crossY }).forEach(({ x1, y1, x2, y2 }) => {
            foreground.append('line')
              .attr('class', 'babel-domain-locality-x-shadow')
              .attr('x1', x1.toFixed(1))
              .attr('y1', y1.toFixed(1))
              .attr('x2', x2.toFixed(1))
              .attr('y2', y2.toFixed(1))
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
            foreground.append('line')
              .attr('class', 'babel-domain-locality-x')
              .attr('x1', x1.toFixed(1))
              .attr('y1', y1.toFixed(1))
              .attr('x2', x2.toFixed(1))
              .attr('y2', y2.toFixed(1))
              .attr('opacity', emphasis === 'quiet' ? 0.3 : null);
          });
        });
      });
    }
    return true;
  };
  return {
    scheduleAcceptedAntiLocality,
    scheduleAcceptedImproperMovement,
    ensureDomainLocalityLayers,
    scheduledAcceptedLocalityRelations
  };
}
