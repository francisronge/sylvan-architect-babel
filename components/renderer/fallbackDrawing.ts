import * as d3 from 'd3';
import {
  ANCHOR_SET_BADGE, anchorSetBadgeRadius, CATEGORY_LABEL, categoryLineBaselineY, markerScaleAtZoom, RELATION_BINDING_METRICS,
  RELATION_LANES_BELOW_DEEPEST_NODE, TERMINAL_LABEL, TRIANGLE_WORDS
} from '../../replay/rendererMetrics.ts';
import { getNodeId } from '../../replay/displayIdentity.ts';
import type { BoundFallbackMark, BoundFrame, FallbackMeasurements } from '../../replay/relations/boundGeometry.ts';
import { type BoundAnchorSetBadge, type BoundAnchorSetRail, type BoundPrimitive, type BoundSegment } from '../../replay/relations/boundGeometry.ts';
import { anchorSetRailPaths, FALLBACK_ROLE_STYLE, FALLBACK_STROKE_WIDTHS, fallbackMarkerScale, fitFallbackGeometry } from '../../replay/relations/fallbackGeometry.ts';
import {
  type Rect
} from '../../replay/relations/overlayGeometry.ts';
import type { PlaquePlacement } from '../../replay/relations/plaquePlacement.ts';
import { boundingRect } from '../../replay/relations/rectGeometry.ts';
import { coveredWordSpan, fallbackBranchBox } from '../../replay/relations/fallbackSpans.ts';
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
  if (primitive.connectorLabel) marker.attr('data-vr-connector-label', primitive.connectorLabel);
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
  getReplayRenderedCategoryLines: (d: HierNode) => string[];
  replayPlaqueLayout: Map<number, PlaquePlacement>;
  replayVisibleNodeIdSet: Set<string> | null;
  playedRelationIndices: Set<number> | null;
  activeRelationMoment: { stageIndex: number; relationIndex: number; } | null;
  resolveOverlayAnchor: (nodeId: string) => object | null | undefined;
  direction: 'ltr' | 'rtl';
}
export function measureFallbackLabels({
  relationRenderPlan,
  activeDerivationFrameIndex,
  g,
  frameLayoutById,
  getReplayRenderedTerminalText,
  getReplayRenderedCategoryLines,
  replayPlaqueLayout,
  replayVisibleNodeIdSet,
  playedRelationIndices,
  activeRelationMoment,
  resolveOverlayAnchor,
  direction
}: FallbackLabelsContext) {
  const hasFallback = relationRenderPlan.frames[activeDerivationFrameIndex]?.items.some(item => item.kind === 'fallback');
  // Measure the complete stage, including unrevealed labels, in tree coordinates.
  // These invisible measurement texts never enter the syntax or camera bounds.
  const fallbackLabelRects = new Map<string, { x: number; y: number; width: number; height: number }>();
  // The word string Constituent Glyphing paints on a triangle, by the triangle's node.
  const triangleWordRects = new Map<string, Rect>();
  const fallbackMeasure = g.append('g').attr('visibility', 'hidden').attr('aria-hidden', 'true');
  const fallbackTextMetrics = new Map<string, DOMRect>();
  const categorySample = g.select<SVGTextElement>('.category-label').node();
  const terminalSample = g.select<SVGTextElement>('.terminal-label').node();
  if (hasFallback) new Set(frameLayoutById.values()).forEach(node => {
    if (isSyntheticWorkspaceRootNode(node) || isUnderTriangulation(node)) return;
    const category = Boolean(node.children?.length) || shouldExpandPreterminalLeaf(node.data) || isWordlessCategoryLeaf(node.data);
    const lines = category ? getReplayRenderedCategoryLines(node as unknown as HierNode) : [];
    const label = category ? lines.join('') : getReplayRenderedTerminalText(node as unknown as HierNode);
    const metricKey = JSON.stringify([category, category ? lines : label]);
    let rect = fallbackTextMetrics.get(metricKey);
    if (!rect) {
      const sample = category ? categorySample : terminalSample;
      const text = sample?.cloneNode(false) as SVGTextElement | undefined
        ?? document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.removeAttribute('class');
      text.removeAttribute('id');
      text.setAttribute('text-anchor', 'middle');
      const style = category ? CATEGORY_LABEL : TERMINAL_LABEL;
      text.setAttribute('y', String(style.baselineY));
      text.setAttribute('font-size', String(style.fontSize));
      text.setAttribute('font-weight', String(style.fontWeight));
      text.style.fontFamily = 'Quicksand, sans-serif';
      text.style.fontStyle = category ? 'normal' : 'italic';
      if (category) {
        lines.forEach((line, index) => {
          const span = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          span.setAttribute('x', '0');
          span.setAttribute('y', String(categoryLineBaselineY(index, lines.length)));
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
    const triangleWords = (node as { isTriangulated?: boolean; triangulatedWords?: string }).isTriangulated
      ? (node as { triangulatedWords?: string }).triangulatedWords : undefined;
    if (triangleWords) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('y', String(TRIANGLE_WORDS.baselineY));
      text.setAttribute('font-size', String(TRIANGLE_WORDS.fontSize));
      text.setAttribute('font-weight', String(TRIANGLE_WORDS.fontWeight));
      text.style.fontFamily = 'Quicksand, sans-serif';
      text.style.fontStyle = 'italic';
      text.textContent = triangleWords;
      fallbackMeasure.node()?.appendChild(text);
      const box = text.getBBox();
      text.remove();
      if (box.width || box.height) triangleWordRects.set(getNodeId(node as unknown as HierNode), {
        x: node.x + box.x, y: node.y + box.y, width: box.width, height: box.height
      });
    }
  });
  fallbackMeasure.remove();
  const fallbackRectFor = (nodeId: string, subtree = false) => {
    const anchor = frameLayoutById.get(nodeId);
    if (!anchor) return null;
    const rects = (subtree ? anchor.descendants() : [anchor]).flatMap(node => {
      const id = getNodeId(node as unknown as HierNode);
      return [fallbackLabelRects.get(id), subtree ? triangleWordRects.get(id) : undefined].filter((rect): rect is Rect => Boolean(rect));
    });
    return rects.length ? boundingRect(rects) : null;
  };
  const paintedTextRects = [...fallbackLabelRects, ...triangleWordRects];
  const fallbackMeasurements = {
    labels: paintedTextRects.map(([, rect]) => rect),
    obstacles: [...replayPlaqueLayout.values()],
    visibleLabels: paintedTextRects.filter(([id]) =>
      !replayVisibleNodeIdSet || replayVisibleNodeIdSet.has(id)).map(([, rect]) => rect),
    visibleObstacles: [...replayPlaqueLayout].filter(([index]) => {
      const item = relationRenderPlan.frames[activeDerivationFrameIndex]?.items[index];
      return item && isPlanItemRevealed(item, activeDerivationFrameIndex, playedRelationIndices,
        activeRelationMoment?.relationIndex ?? null)
        && planItemDependencyNodeIds(item).every(id => Boolean(resolveOverlayAnchor(id)));
    }).map(([, rect]) => rect),
    branches: [...new Set(frameLayoutById.values())].flatMap(node => node.parent && !isSyntheticWorkspaceRootNode(node.parent)
      && !isUnderTriangulation(node as unknown as HierNode) && (!replayVisibleNodeIdSet
        || replayVisibleNodeIdSet.has(getNodeId(node as unknown as HierNode)) && replayVisibleNodeIdSet.has(getNodeId(node.parent as unknown as HierNode)))
      ? [fallbackBranchBox(node.parent, node)] : []),
    labelFor: (id: string) => fallbackRectFor(id),
    subtreeFor: (id: string) => fallbackRectFor(id, true),
    spanFor: (id: string) => {
      const anchor = frameLayoutById.get(id);
      return anchor ? coveredWordSpan(anchor, node => {
        const wordId = getNodeId(node as unknown as HierNode);
        if (replayVisibleNodeIdSet && !replayVisibleNodeIdSet.has(wordId)) return null;
        return ((node as { isTriangulated?: boolean }).isTriangulated ? triangleWordRects : fallbackLabelRects).get(wordId) ?? null;
      }, direction, getReplayRenderedCategoryLines(anchor as unknown as HierNode).join(' ')) : null;
    },
    bottom: Math.max(0, ...paintedTextRects.map(([, rect]) => rect.y + rect.height))
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
  direction: 'ltr' | 'rtl';
  /** The frame's anchor-set badges bound again at another marker scale
   * (`bindAnchorSetBadges` with the frame's options). */
  placeAnchorSetBadges?: (markerScale: number) => readonly BoundAnchorSetBadge[];
}
/**
 * Neutral marks, anchor-set badges and rails, drawn at the binder's marker
 * scale and placed again by `fit` for the automatic Fit. Like role labels,
 * badges then keep that size and share the tree's scale during manual zoom, so
 * the clearance Fit gives them from labels and plaques holds at every zoom.
 */
export function createFallbackPlacement({ fallbackMeasurements, boundFrame, markerScale, badgeGap, frameMaxNodeY, animated, usesDerivationFrames, g, direction, placeAnchorSetBadges }: FallbackPlacementContext) {
  const fallbackConnectorPaths = new Map<BoundSegment, DrawingLayer>();
  const fallbackMarkGroups = new Map<BoundPrimitive, DrawingLayer>();
  const fallbackRailGroups = new Map<BoundAnchorSetRail, DrawingLayer>();
  const anchorSetBadgeGroups = new Map<BoundAnchorSetBadge, DrawingLayer>();
  let lastFallbackFit: { zoom: number; viewport: Rect } | undefined;
  let relationInkObstacles: Rect[] = [];
  const badgeKey = (badge: BoundAnchorSetBadge) => `${badge.itemIndex} ${badge.stackIndex} ${badge.nodeId}`;
  /** Every bound badge at `anchorScale`, placed by the binder at that scale. */
  const fitAnchorSetBadges = (anchorScale: number) => {
    const bound = boundFrame.primitives.filter((primitive): primitive is BoundAnchorSetBadge => primitive.type === 'anchor-set-badge');
    const placed = bound.length && anchorScale !== markerScale && placeAnchorSetBadges
      ? new Map(placeAnchorSetBadges(anchorScale).map(badge => [badgeKey(badge), badge])) : null;
    const fitted = new Map(bound.map(badge => {
      const at = placed?.get(badgeKey(badge)) ?? badge;
      return [badge, { x: at.x, y: at.y }];
    }));
    anchorSetBadgeGroups.forEach((group, badge) => {
      const at = fitted.get(badge) ?? badge;
      group.attr('transform', `translate(${at.x},${at.y}) scale(${anchorScale})`);
    });
    return fitted;
  };
  const fitFallbackOverlays = (fitZoom: number, fittedViewport: Rect) => {
    lastFallbackFit = { zoom: fitZoom, viewport: fittedViewport };
    const scale = fallbackMarkerScale(fitZoom, fallbackMeasurements.labels.map(rect => rect.height));
    const anchorScale = markerScaleAtZoom(fitZoom);
    fitFallbackGeometry(boundFrame, {
      markerScale, fittedMarkerScale: scale, fittedAnchorScale: anchorScale, badgeGap, laneGap: RELATION_BINDING_METRICS.laneGap, fallbackMeasurements,
      railBaseY: frameMaxNodeY + RELATION_LANES_BELOW_DEEPEST_NODE.railBase, fittedViewport, relationInkObstacles,
      separateFallbackMoments: animated && usesDerivationFrames, direction, fittedAnchorSetBadges: fitAnchorSetBadges(anchorScale)
    }).forEach((fitted, original) => {
      if (original.type === 'fallback-mark' && fitted.type === 'fallback-mark') {
        fallbackMarkGroups.get(original)?.attr('transform', `translate(${fitted.x},${fitted.y}) scale(${scale})`);
      } else if (original.type === 'segment' && fitted.type === 'segment') {
        const group = fallbackConnectorPaths.get(original);
        group?.selectAll('path').attr('d', fitted.d);
        const strokes = FALLBACK_STROKE_WIDTHS[original.route];
        group?.select('.vr-fallback-segment').attr('stroke-width', strokes.line * scale);
        group?.select('.vr-fallback-shadow').attr('stroke-width', strokes.shadow * scale);
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
  const drawBadge = (primitive: BoundAnchorSetBadge, host: DrawingLayer) => {
    const compact = primitive.badgeSize === 'compact';
    const marker = host.append('g').attr('class', 'vr-anchor-set-marker')
      .attr('transform', `translate(${primitive.x},${primitive.y}) scale(${markerScale})`);
    marker.append('circle')
      .attr('class', 'vr-anchor-set-badge')
      .attr('r', anchorSetBadgeRadius(primitive.badgeSize))
      .attr('fill', 'rgba(2,24,15,0.92)')
      .attr('stroke', '#34d399')
      .attr('stroke-width', ANCHOR_SET_BADGE.strokeWidth);
    marker.append('text')
      .attr('text-anchor', 'middle')
      .attr('y', compact ? 3 : 4)
      .attr('font-size', compact ? '8px' : '10px')
      .attr('fill', '#a7f3d0')
      .attr('font-family', "'IBM Plex Mono', monospace")
      .text(String(primitive.numeral));
    anchorSetBadgeGroups.set(primitive, marker);
    return marker;
  };
  return { drawSegment, drawMark, drawRail, drawBadge, fit: fitFallbackOverlays, finish: finishFallbackPlacement };
}
