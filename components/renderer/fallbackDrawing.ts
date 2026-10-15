import * as d3 from 'd3';
import { CATEGORY_LINE_HEIGHT, categoryTextLayout } from '../../replay/categoryTextLayout.ts';
import { getNodeId } from '../../replay/displayIdentity.ts';
import type { BoundFallbackMark, BoundFrame, FallbackMeasurements } from '../../replay/relations/boundGeometry.ts';
import { type BoundAnchorSetRail, type BoundPrimitive, type BoundSegment, type PlanPositionProvider } from '../../replay/relations/boundGeometry.ts';
import { anchorSetRailPaths, FALLBACK_ROLE_STYLE, fallbackMarkerScale, fitFallbackGeometry } from '../../replay/relations/fallbackGeometry.ts';
import {
  type Rect
} from '../../replay/relations/overlayGeometry.ts';
import type { PlaquePlacement } from '../../replay/relations/plaquePlacement.ts';
import type { RelationRenderPlan } from '../../replay/relations/renderPlan.ts';
import {
  isPlanItemRevealed,
  planItemDependencyNodeIds
} from '../../replay/relations/renderPlan.ts';
import { isSyntheticWorkspaceRootNode } from '../../replay/replayCanvas.ts';
import {
  isWordlessCategoryLeaf,
  shouldExpandPreterminalLeaf
} from '../../replay/replaySurfaceNotation.ts';
import { isUnderTriangulation } from '../../replay/triangulation.ts';
import { type HierNode } from '../../replay/types.ts';
import { type SyntaxNode } from '../../types.ts';
import { measureRelationInkObstacles } from '../relationInkObstacles.ts';
import type { DrawingLayer } from './drawingContext.ts';

export function drawFallbackMark(
  host: DrawingLayer,
  primitive: BoundFallbackMark,
  markerScale: number
) {
  const marker = host.append('g').attr('class', 'vr-fallback-mark')
    .attr('data-vr-witness', primitive.nodeId)
    .attr('transform', `translate(${primitive.x},${primitive.y}) scale(${markerScale})`);
  marker.attr('data-authored-role', primitive.role);
  marker.append('text').attr('class', 'vr-fallback-role')
    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
    .attr('font-size', FALLBACK_ROLE_STYLE.fontSize).text(primitive.text);
  return marker;
}

interface FallbackLabelsContext {
  relationRenderPlan: RelationRenderPlan;
  activeDerivationFrameIndex: number;
  g: DrawingLayer;
  frameLayoutById: Map<string, d3.HierarchyPointNode<SyntaxNode>>;
  getReplayRenderedTerminalText: (d: HierNode) => string;
  measureCategoryText: (text: string) => number;
  replayPlaqueLayout: Map<number, PlaquePlacement>;
  replayVisibleNodeIdSet: Set<string> | null;
  playedRelationIndices: Set<number> | undefined;
  activeRelationMoment: { stageIndex: number; relationIndex: number; } | null;
  resolveOverlayAnchor: PlanPositionProvider;
}
export function measureFallbackLabels({
  relationRenderPlan,
  activeDerivationFrameIndex,
  g,
  frameLayoutById,
  getReplayRenderedTerminalText,
  measureCategoryText,
  replayPlaqueLayout,
  replayVisibleNodeIdSet,
  playedRelationIndices,
  activeRelationMoment,
  resolveOverlayAnchor
}: FallbackLabelsContext) {
  const hasFallback = relationRenderPlan.frames[activeDerivationFrameIndex]?.items.some(item => item.kind === 'fallback');
  // Measure the complete stage, including unrevealed labels, in tree coordinates.
  // These invisible measurement texts never enter the syntax or camera bounds.
  const fallbackLabelRects = new Map<string, { x: number; y: number; width: number; height: number }>();
  const fallbackMeasure = g.append('g').attr('visibility', 'hidden').attr('aria-hidden', 'true');
  const fallbackTextMetrics = new Map<string, DOMRect>();
  const categorySample = g.select<SVGTextElement>('.category-label').node();
  const terminalSample = g.select<SVGTextElement>('.terminal-label').node();
  if (hasFallback) new Set(frameLayoutById.values()).forEach(node => {
    if (isSyntheticWorkspaceRootNode(node) || isUnderTriangulation(node)) return;
    const category = Boolean(node.children?.length) || shouldExpandPreterminalLeaf(node.data) || isWordlessCategoryLeaf(node.data);
    const label = category ? node.data.label : getReplayRenderedTerminalText(node as unknown as HierNode);
    const metricKey = JSON.stringify([category, label]);
    let rect = fallbackTextMetrics.get(metricKey);
    if (!rect) {
      const sample = category ? categorySample : terminalSample;
      const text = sample?.cloneNode(false) as SVGTextElement | undefined
        ?? document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.removeAttribute('class');
      text.removeAttribute('id');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('y', category ? '-10' : '115');
      text.setAttribute('font-size', category ? '42' : '56');
      text.setAttribute('font-weight', '900');
      text.style.fontFamily = 'Quicksand, sans-serif';
      text.style.fontStyle = category ? 'normal' : 'italic';
      if (category) {
        const { lines } = categoryTextLayout(label, measureCategoryText);
        lines.forEach((line, index) => {
          const span = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          span.setAttribute('x', '0');
          span.setAttribute('y', String(-10 - (lines.length - 1 - index) * CATEGORY_LINE_HEIGHT));
          span.textContent = line;
          text.appendChild(span);
        });
      } else text.textContent = label;
      fallbackMeasure.node()?.appendChild(text);
      rect = text.getBBox();
      fallbackTextMetrics.set(metricKey, rect);
      text.remove();
    }
    if (rect.width || rect.height) fallbackLabelRects.set(getNodeId(node as unknown as HierNode), {
      x: node.x + rect.x, y: node.y + rect.y, width: rect.width, height: rect.height
    });
  });
  fallbackMeasure.remove();
  const fallbackRectFor = (nodeId: string, subtree = false) => {
    const anchor = frameLayoutById.get(nodeId);
    if (!anchor) return null;
    const rects = (subtree ? anchor.descendants() : [anchor]).flatMap(node => {
      const rect = fallbackLabelRects.get(getNodeId(node as unknown as HierNode));
      return rect ? [rect] : [];
    });
    if (!rects.length) return null;
    const x = Math.min(...rects.map(rect => rect.x));
    const y = Math.min(...rects.map(rect => rect.y));
    return {
      x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x,
      height: Math.max(...rects.map(rect => rect.y + rect.height)) - y
    };
  };
  const fallbackMeasurements = {
    labels: [...fallbackLabelRects.values()],
    obstacles: [...replayPlaqueLayout.values()],
    visibleLabels: [...fallbackLabelRects].filter(([id]) =>
      !replayVisibleNodeIdSet || replayVisibleNodeIdSet.has(id)).map(([, rect]) => rect),
    visibleObstacles: [...replayPlaqueLayout].filter(([index]) => {
      const item = relationRenderPlan.frames[activeDerivationFrameIndex]?.items[index];
      return item && isPlanItemRevealed(item, activeDerivationFrameIndex, playedRelationIndices,
        activeRelationMoment?.relationIndex ?? null)
        && planItemDependencyNodeIds(item).every(id => Boolean(resolveOverlayAnchor(id)));
    }).map(([, rect]) => rect),
    labelFor: (id: string) => fallbackRectFor(id),
    subtreeFor: (id: string) => fallbackRectFor(id, true),
    bottom: Math.max(0, ...[...fallbackLabelRects.values()].map(rect => rect.y + rect.height))
  };

  return { fallbackMeasurements };
}

interface FallbackPlacementContext {
  fallbackMeasurements: FallbackMeasurements;
  boundFrame: BoundFrame;
  markerScale: number;
  badgeGap: number;
  frameMaxNodeY: number;
  animated: boolean;
  usesDerivationFrames: boolean;
  g: DrawingLayer;
}
export function createFallbackPlacement({ fallbackMeasurements, boundFrame, markerScale, badgeGap, frameMaxNodeY, animated, usesDerivationFrames, g }: FallbackPlacementContext) {
  const fallbackConnectorPaths = new Map<BoundSegment, DrawingLayer>();
  const fallbackMarkGroups = new Map<BoundPrimitive, DrawingLayer>();
  const fallbackRailGroups = new Map<BoundAnchorSetRail, DrawingLayer>();
  let lastFallbackFit: { zoom: number; viewport: Rect } | undefined;
  let relationInkObstacles: Rect[] = [];
  const fitFallbackOverlays = (fitZoom: number, fittedViewport: Rect) => {
    lastFallbackFit = { zoom: fitZoom, viewport: fittedViewport };
    const scale = fallbackMarkerScale(fitZoom, fallbackMeasurements.labels.map(rect => rect.height));
    const anchorScale = Math.min(1 / fitZoom, 3);
    fitFallbackGeometry(boundFrame, {
      markerScale, fittedMarkerScale: scale, fittedAnchorScale: anchorScale, badgeGap, laneGap: 60, fallbackMeasurements,
      railBaseY: frameMaxNodeY + 240, fittedViewport, relationInkObstacles,
      separateFallbackMoments: animated && usesDerivationFrames
    }).forEach((fitted, original) => {
      if (original.type === 'fallback-mark' && fitted.type === 'fallback-mark') {
        fallbackMarkGroups.get(original)?.attr('transform', `translate(${fitted.x},${fitted.y}) scale(${scale})`);
      } else if (original.type === 'segment' && fitted.type === 'segment') {
        const group = fallbackConnectorPaths.get(original);
        group?.selectAll('path').attr('d', fitted.d);
        group?.select('.vr-fallback-segment').attr('stroke-width', (original.route === 'direct' ? 1.5 : 1.9) * scale);
        group?.select('.vr-fallback-shadow').attr('stroke-width', (original.route === 'direct' ? 3.6 : 4.4) * scale);
      } else if (original.type === 'anchor-set-rail' && fitted.type === 'anchor-set-rail') {
        const paths = anchorSetRailPaths(fitted, anchorScale, scale);
        const group = fallbackRailGroups.get(original);
        group?.select('.babel-anchor-set-rail').attr('d', paths.rail);
        group?.select('.babel-anchor-set-stub').attr('d', paths.joins);
      }
    });
  };
  const finishFallbackPlacement = () => {
    const root = g.node();
    if (!root || !lastFallbackFit || !fallbackMarkGroups.size) return;
    relationInkObstacles = measureRelationInkObstacles(root);
    fitFallbackOverlays?.(lastFallbackFit.zoom, lastFallbackFit.viewport);
  };

  const drawSegment = (primitive: Extract<BoundPrimitive, { type: 'segment' }>, host: DrawingLayer) => {
    const group = host.append('g').attr('class', 'vr-fallback-connector');
    group.append('path').attr('class', 'vr-fallback-shadow').attr('d', primitive.d);
    group.append('path')
      .attr('class', `vr-fallback-segment vr-fallback-segment-${primitive.route}`)
      .attr('data-vr-lane', primitive.lane === null ? 'direct' : String(primitive.lane))
      .attr('d', primitive.d);
    fallbackConnectorPaths.set(primitive, group);
  };

  const drawMark = (primitive: Extract<BoundPrimitive, { type: 'fallback-mark' }>, host: DrawingLayer) => {
    fallbackMarkGroups.set(primitive, drawFallbackMark(host, primitive, markerScale));
  };

  const drawRail = (primitive: Extract<BoundPrimitive, { type: 'anchor-set-rail' }>, host: DrawingLayer) => {
    const paths = anchorSetRailPaths(primitive, markerScale);
    const group = host.append('g').attr('class', 'vr-anchor-set').attr('fill', 'none');
    group.append('path').attr('class', 'vr-anchor-set-rail babel-anchor-set-rail').attr('d', paths.rail);
    group.append('path').attr('class', 'babel-anchor-set-stub').attr('d', paths.joins);
    fallbackRailGroups.set(primitive, group);
  };
  return { drawSegment, drawMark, drawRail, fit: fitFallbackOverlays, finish: finishFallbackPlacement };
}
