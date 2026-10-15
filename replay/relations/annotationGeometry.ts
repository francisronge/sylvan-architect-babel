import type { GeometryBinders } from './geometryContext.ts';
import { usesBoundBadgePosition } from './geometryContext.ts';
import { splitAntecedenceLinkPath } from './markGeometry.ts';
import type { Point } from './overlayGeometry.ts';
import { placeRectBelowCollisions } from './overlayGeometry.ts';
import { preparePlaqueTextLayout } from './plaqueTextLayout.ts';

export const annotationGeometry = {
  'coindex': (item, itemIndex, context) => {
    const { primitives, requirePoint, nextStackIndex, labelWidth, badgeGap, markerScale } = context;
    if (item.familyId === 'identity.occurrences') {
      primitives.push({
        type: 'identity-lens',
        nodeIds: item.nodeIds,
        index: item.index,
        itemIndex
      });
      return;
    }
    item.nodeIds.forEach((nodeId) => {
      const point = requirePoint(itemIndex, nodeId);
      if (!point) return;
      const stackIndex = usesBoundBadgePosition(item) ? nextStackIndex(nodeId) : 0;
      const isParasiticGap = item.familyId === 'parasitic-gap.composition';
      primitives.push({
        type: 'index-badge',
        fitPolicy: 'tree-first',
        nodeId,
        x: (isParasiticGap ? point.x + 32 : point.x + labelWidth / 2) + stackIndex * badgeGap * markerScale,
        y: point.y,
        index: item.index,
        stackIndex,
        itemIndex
      });
    });
    return;
  },
  'parasitic-gap-copy': (item, itemIndex, context) => {
    const { requirePoint, primitives } = context;
    const content = requirePoint(itemIndex, item.contentNodeId, 'shell-bottom');
    const ordinaryGap = requirePoint(itemIndex, item.ordinaryGapNodeId, 'shell-top');
    const parasiticGaps = item.parasiticGapNodeIds.map((nodeId) =>
      requirePoint(itemIndex, nodeId, 'shell-top'));
    if (!content || !ordinaryGap || parasiticGaps.some((point) => !point)) return;
    primitives.push({
      type: 'parasitic-gap-copy',
      contentNodeId: item.contentNodeId,
      ordinaryGapNodeId: item.ordinaryGapNodeId,
      parasiticGapNodeIds: item.parasiticGapNodeIds,
      itemIndex
    });
    return;
  },
  'split-antecedence': (item, itemIndex, context) => {
    const { requirePoint, primitives } = context;
    const origin = requirePoint(itemIndex, item.dependentNodeId, 'terminal');
    const targets = item.antecedentNodeIds.map((nodeId) => ({
      nodeId,
      point: requirePoint(itemIndex, nodeId, 'terminal')
    }));
    if (!origin || targets.some((target) => !target.point)) return;
    primitives.push({
      type: 'split-antecedence',
      fitPolicy: 'tree-first',
      dependentNodeId: item.dependentNodeId,
      antecedentNodeIds: item.antecedentNodeIds,
      origin,
      links: targets.map((target, linkIndex) => ({
        antecedentNodeId: target.nodeId,
        target: target.point as Point,
        d: splitAntecedenceLinkPath(
          origin,
          target.point as Point,
          linkIndex,
          targets.length
        )
      })),
      itemIndex
    });
    return;
  },
  'node-plaque': (item, itemIndex, context) => {
    const { requirePoint, labelHeight, markerScale, plaqueRects, primitives, labelWidth, options, positionFor } = context;
    const anchorPoints = item.anchorNodeIds
      .map((nodeId) => requirePoint(itemIndex, nodeId))
      .filter((point): point is Point => Boolean(point));
    if (anchorPoints.length === 0) return;
    const textLayout = preparePlaqueTextLayout(item, {
      ...options.plaqueTextLayout,
      variant: item.plaqueStyle === 'feature' ? 'feature' : 'generic'
    });
    const { width, height } = textLayout;
    if (item.plaqueStyle === 'feature') {
      const positionIds = item.positionNodeIds?.length
        ? item.positionNodeIds
        : item.anchorNodeIds;
      const derivedPositionPoints = positionIds
        .map((nodeId) => positionFor(nodeId))
        .filter((point): point is Point => Boolean(point));
      const positionPoints = derivedPositionPoints.length > 0
        ? derivedPositionPoints
        : anchorPoints;
      const centerX = (Math.min(...positionPoints.map((point) => point.x))
        + Math.max(...positionPoints.map((point) => point.x))) / 2;
      const x = centerX - width / 2 - 18;
      // The renderer replaces this font-metric estimate with the measured
      // terminal rectangle before painting. It reserves the accepted plate
      // footprint so Replay does not refit when the relation is revealed.
      const preferredY = Math.max(...positionPoints.map((point) => point.y)) + labelHeight + 87.2;
      const worldRect = placeRectBelowCollisions({
        x,
        y: preferredY,
        width: width * markerScale,
        height: height * markerScale
      }, plaqueRects, 14 * markerScale, 10 * markerScale);
      primitives.push({
        type: 'plaque',
        plaqueStyle: item.plaqueStyle,
        x,
        y: worldRect.y,
        width,
        height,
        textLayout,
        anchorPoints,
        ...(item.title ? { title: item.title } : {}),
        rows: item.rows,
        ...(item.rowRefs ? { rowRefs: item.rowRefs } : {}),
        itemIndex
      });
      plaqueRects.push(worldRect);
      return;
    }
    const anchor = anchorPoints[0];
    const x = anchor.x + labelWidth / 2;
    const preferredY = anchor.y + labelHeight;
    const worldRect = placeRectBelowCollisions({
      x,
      y: preferredY,
      width: width * markerScale,
      height: height * markerScale
    }, plaqueRects, 14 * markerScale, 10 * markerScale);
    // Nearby plates, not only plates with the same exact anchor, stack
    // below one another. This uses their actual screen-stable footprint.
    primitives.push({
      type: 'plaque',
      plaqueStyle: item.plaqueStyle,
      x,
      y: worldRect.y,
      width,
      height,
      textLayout,
      anchorPoints,
      ...(item.title ? { title: item.title } : {}),
      rows: item.rows,
      ...(item.rowRefs ? { rowRefs: item.rowRefs } : {}),
      itemIndex
    });
    plaqueRects.push(worldRect);
    return;
  },
  'node-badges': (item, itemIndex, context) => {
    const { requirePoint, nextStackIndex, primitives, labelWidth, badgeGap, markerScale, options } = context;
    item.badges.forEach((badge) => {
      const point = requirePoint(itemIndex, badge.nodeId);
      if (!point) return;
      const reuseExistingNotation = item.badgeStyle === 'gap-notation'
        && options.hasExistingGapNotation?.(badge.nodeId, badge.text) === true;
      const stackIndex = !reuseExistingNotation && usesBoundBadgePosition(item) ? nextStackIndex(badge.nodeId) : 0;
      primitives.push({
        type: 'text-badge',
        badgeStyle: item.badgeStyle,
        nodeId: badge.nodeId,
        x: point.x + labelWidth / 2 + stackIndex * badgeGap * markerScale,
        y: point.y,
        text: badge.text,
        shape: badge.shape,
        stackIndex,
        ...(reuseExistingNotation ? { reuseExistingNotation: true as const } : {}),
        ...(item.outcome ? { outcome: item.outcome } : {}),
        itemIndex
      });
    });
    return;
  },
  'analysis-verdict': (item, itemIndex, context) => {
    const { requirePoint, primitives } = context;
    const point = requirePoint(itemIndex, item.analysisNodeId);
    if (!point) return;
    primitives.push({
      type: 'analysis-verdict',
      analysisNodeId: item.analysisNodeId,
      x: point.x,
      y: point.y,
      judgment: item.judgment,
      ...(item.label ? { label: item.label } : {}),
      itemIndex
    });
    return;
  },
  'gapping-alignment': (item, itemIndex, context) => {
    const { requirePoint, primitives } = context;
    const antecedent = requirePoint(itemIndex, item.antecedentNodeId);
    const gap = requirePoint(itemIndex, item.gapNodeId);
    const pairs = item.pairs.map((pair) => ({
      ...pair,
      correlate: requirePoint(itemIndex, pair.correlateNodeId),
      remnant: requirePoint(itemIndex, pair.remnantNodeId)
    }));
    if (!antecedent || !gap || pairs.some((pair) => !pair.correlate || !pair.remnant)) return;
    primitives.push({
      type: 'gapping-alignment',
      antecedentNodeId: item.antecedentNodeId,
      gapNodeId: item.gapNodeId,
      antecedent,
      gap,
      pairs: pairs.map((pair) => ({
        correlateNodeId: pair.correlateNodeId,
        remnantNodeId: pair.remnantNodeId,
        correlate: pair.correlate!,
        remnant: pair.remnant!,
        label: pair.label
      })),
      itemIndex
    });
    return;
  },
  'quantifier-raising': (item, itemIndex, context) => {
    const { requirePoint, primitives } = context;
    const pronounced = requirePoint(itemIndex, item.pronouncedNodeId, 'shell');
    const lf = requirePoint(itemIndex, item.lfNodeId, 'shell');
    const domain = item.scopeDomainNodeId
      ? requirePoint(itemIndex, item.scopeDomainNodeId, 'shell')
      : null;
    if (!pronounced || !lf || (item.scopeDomainNodeId && !domain)) return;
    primitives.push({
      type: 'quantifier-raising',
      pronouncedNodeId: item.pronouncedNodeId,
      lfNodeId: item.lfNodeId,
      ...(item.scopeDomainNodeId ? { scopeDomainNodeId: item.scopeDomainNodeId } : {}),
      index: item.index,
      itemIndex
    });
    return;
  },
  'operator-variable-binding': (item, itemIndex, context) => {
    const { requirePoint, primitives } = context;
    const operator = requirePoint(itemIndex, item.operatorNodeId, 'shell');
    const variable = requirePoint(itemIndex, item.variableNodeId, 'shell');
    const witness = item.traceWitnessNodeId
      ? requirePoint(itemIndex, item.traceWitnessNodeId)
      : null;
    const domain = item.scopeDomainNodeId
      ? requirePoint(itemIndex, item.scopeDomainNodeId, 'shell')
      : null;
    if (!operator || !variable
      || (item.traceWitnessNodeId && !witness)
      || (item.scopeDomainNodeId && !domain)) return;
    primitives.push({
      type: 'operator-variable-binding',
      operatorNodeId: item.operatorNodeId,
      variableNodeId: item.variableNodeId,
      ...(item.traceWitnessNodeId ? { traceWitnessNodeId: item.traceWitnessNodeId } : {}),
      ...(item.scopeDomainNodeId ? { scopeDomainNodeId: item.scopeDomainNodeId } : {}),
      index: item.index,
      itemIndex
    });
    return;
  }
} satisfies Partial<GeometryBinders>;
