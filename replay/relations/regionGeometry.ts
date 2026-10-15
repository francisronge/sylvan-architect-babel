import type { GeometryBinders } from './geometryContext.ts';
import {
  blockedEdgeDoubleSlash,
  domainBracketPath,
  fongEdgeOutlineRect,
  pathNodeEllipse,
  pathNodeSquare,
  phaseArcPath
} from './markGeometry.ts';
import type { Point, Rect } from './overlayGeometry.ts';

export const regionGeometry = {
  'binding-domain': (item, itemIndex, context) => {
    const {
      failed,
      labelWidth,
      labelHeight,
      primitives,
      requirePoint,
      nextStackIndex,
      badgeGap,
      markerScale,
      positionFor
    } = context;
    const memberPoints = item.domainMemberNodeIds
      .map((nodeId) => positionFor(nodeId))
      .filter((point): point is Point => Boolean(point));
    if (memberPoints.length === 0) {
      failed.push({
        itemIndex,
        nodeId: item.domainNodeId,
        reason: 'no measured positions inside the domain; mark fails closed'
      });
      return;
    }
    const xs = memberPoints.map((point) => point.x);
    const ys = memberPoints.map((point) => point.y);
    const minX = Math.min(...xs) - labelWidth / 2;
    const maxX = Math.max(...xs) + labelWidth / 2;
    const minY = Math.min(...ys) - labelHeight;
    const maxY = Math.max(...ys) + labelHeight;
    const halfWidth = (maxX - minX) / 2;
    const halfHeight = (maxY - minY) / 2;
    primitives.push({
      type: 'domain-ellipse',
      fitPolicy: 'tree-first',
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      rx: halfWidth * Math.SQRT2,
      ry: halfHeight * Math.SQRT2,
      outcome: item.outcome,
      itemIndex
    });
    [item.binderNodeId, item.boundNodeId].forEach((nodeId) => {
      const point = requirePoint(itemIndex, nodeId);
      if (!point) return;
      const stackIndex = nextStackIndex(nodeId);
      primitives.push({
        type: 'index-badge',
        fitPolicy: 'tree-first',
        nodeId,
        x: point.x + labelWidth / 2 + stackIndex * badgeGap * markerScale,
        y: point.y,
        index: item.index,
        stackIndex,
        itemIndex
      });
    });
    return;
  },
  'ellipsis-site': (item, itemIndex, context) => {
    const { primitives } = context;
    primitives.push({ type: 'ghost-set', nodeIds: item.ghostNodeIds, itemIndex });
    return;
  },
  'path-status': (item, itemIndex, context) => {
    const { rectFor, failed, primitives, positionFor } = context;
    const ringFor = (nodeId: string, role: 'primary' | 'secondary') => {
      const labelRect = rectFor(nodeId);
      if (!labelRect) {
        failed.push({
          itemIndex,
          nodeId,
          reason: 'no measured position for the path node; mark fails closed'
        });
        return;
      }
      primitives.push({
        type: 'path-node-ring',
        role,
        nodeId,
        ...(role === 'primary'
          ? { ellipse: pathNodeEllipse(labelRect) }
          : { rect: pathNodeSquare(labelRect) }),
        itemIndex
      });
    };
    item.primaryNodeIds.forEach((nodeId) => ringFor(nodeId, 'primary'));
    item.secondaryNodeIds.forEach((nodeId) => ringFor(nodeId, 'secondary'));
    if (item.outcome === 'blocked' && item.blockedEdgeNodeId) {
      const child = positionFor(item.blockedEdgeNodeId, 'shell');
      const parent = positionFor(item.blockedEdgeNodeId, 'parent');
      // A branch with no measurable direction (missing parent, or parent
      // coinciding with the child) cannot carry the slash honestly.
      const measurableBranch = Boolean(child && parent)
        && Math.hypot((child!.x - parent!.x), (child!.y - parent!.y)) > 1;
      if (child && parent && measurableBranch) {
        blockedEdgeDoubleSlash(parent, child).forEach((slash) => {
          primitives.push({
            type: 'shape-path',
            shapeStyle: 'blocked-edge-slash',
            d: `M ${slash.x1.toFixed(1)} ${slash.y1.toFixed(1)} L ${slash.x2.toFixed(1)} ${slash.y2.toFixed(1)}`,
            stroke: 'solid',
            arrowhead: false,
            blocked: true,
            itemIndex
          });
        });
      } else {
        failed.push({
          itemIndex,
          nodeId: item.blockedEdgeNodeId,
          reason: 'no measured branch geometry for the blocked edge; the slash fails closed'
        });
      }
    }
    return;
  },
  'domain-mark': (item, itemIndex, context) => {
    const { rectFor, failed, primitives, requirePoint, labelWidth, labelHeight, positionFor } = context;
    if (item.domainStyle === 'transfer-edge') {
      // The accepted Phase-edge outline box around the edge label.
      const edgeRect = rectFor(item.rootNodeId || item.memberNodeIds[0] || '');
      if (!edgeRect) {
        failed.push({
          itemIndex,
          nodeId: item.rootNodeId || item.memberNodeIds[0] || '(none)',
          reason: 'no measured position for the phase edge; mark fails closed'
        });
        return;
      }
      const outline = fongEdgeOutlineRect(edgeRect);
      primitives.push({
        type: 'domain-region',
        domainStyle: 'transfer-edge',
        x: outline.x,
        y: outline.y,
        width: outline.width,
        height: outline.height,
        ...(item.label ? { label: item.label } : {}),
        itemIndex
      });
      return;
    }
    if (item.domainStyle === 'adjunct-domain') {
      const targetNodeId = item.rootNodeId || item.memberNodeIds[0] || '';
      if (!targetNodeId) {
        failed.push({
          itemIndex,
          nodeId: '(none)',
          reason: 'no authored adjunct branch target; mark fails closed'
        });
        return;
      }
      primitives.push({
        type: 'native-branch-overlay',
        targetNodeIds: [targetNodeId],
        requireSharedParent: false,
        variant: 'adjunct-domain',
        itemIndex
      });
      return;
    }
    /*
     * Members declared subtree-derived are presentational and may shrink
     * to the currently measurable subset (mid-assembly reality). Members
     * NOT declared derived are the authored claim itself (Improper
     * Movement's forbidden region): every one is required, and a missing
     * one is diagnosed — never a silently smaller region.
     */
    const membersAreDerived = (item.subtreeDerived || [])
      .some((declaration) => declaration.field === 'memberNodeIds');
    const memberPoints = item.memberNodeIds
      .map((nodeId) => (membersAreDerived ? positionFor(nodeId) : requirePoint(itemIndex, nodeId)))
      .filter((point): point is Point => Boolean(point));
    if (memberPoints.length === 0) {
      failed.push({
        itemIndex,
        nodeId: item.rootNodeId || item.memberNodeIds[0] || '(none)',
        reason: 'no measured positions inside the domain; mark fails closed'
      });
      return;
    }
    const xs = memberPoints.map((point) => point.x);
    const ys = memberPoints.map((point) => point.y);
    const domainRect: Rect = {
      x: Math.min(...xs) - labelWidth / 2,
      y: Math.min(...ys) - labelHeight,
      width: Math.max(...xs) - Math.min(...xs) + labelWidth,
      height: Math.max(...ys) - Math.min(...ys) + labelHeight * 2
    };

    if (item.domainStyle === 'phase') {
      // The accepted phase arc, apexed above the phase head — never a
      // rectangle.
      const headRect = (item.rootNodeId ? rectFor(item.rootNodeId) : null) || domainRect;
      const edgeRect = item.phaseEdgeNodeId ? rectFor(item.phaseEdgeNodeId) : null;
      primitives.push({
        type: 'shape-path',
        shapeStyle: 'phase-arc',
        d: phaseArcPath(headRect, domainRect, edgeRect, item.phasePrimary === true),
        stroke: 'solid',
        arrowhead: false,
        itemIndex
      });
      return;
    }
    if (item.domainStyle === 'idiom') {
      // The interpretation bracket beneath the domain.
      primitives.push({
        type: 'shape-path',
        shapeStyle: 'idiom-bracket',
        d: domainBracketPath(domainRect.x, domainRect.x + domainRect.width, domainRect.y + domainRect.height + 20),
        stroke: 'solid',
        arrowhead: false,
        itemIndex
      });
      return;
    }
    if (item.domainStyle === 'argument-domain') {
      // Argument-sharing draws its stretched ovals, not boxes.
      primitives.push({
        type: 'domain-ellipse',
        cx: domainRect.x + domainRect.width / 2,
        cy: domainRect.y + domainRect.height / 2,
        rx: (domainRect.width / 2) * Math.SQRT2,
        ry: (domainRect.height / 2) * Math.SQRT2,
        outcome: 'licensed',
        itemIndex
      });
      return;
    }
    primitives.push({
      type: 'domain-region',
      domainStyle: item.domainStyle,
      ...(item.domainStyle === 'control-domain' ? { fitPolicy: 'tree-first' as const } : {}),
      x: domainRect.x,
      y: domainRect.y,
      width: domainRect.width,
      height: domainRect.height,
      ...(item.label ? { label: item.label } : {}),
      ...(item.outcome ? { outcome: item.outcome } : {}),
      itemIndex
    });
    return;
  },
  'strike-ghost': (item, itemIndex, context) => {
    const { requirePoint, primitives, labelWidth } = context;
    item.strikeNodeIds.forEach((nodeId) => {
      const point = requirePoint(itemIndex, nodeId);
      if (!point) return;
      primitives.push({
        type: 'strike',
        x1: point.x - labelWidth / 2,
        x2: point.x + labelWidth / 2,
        y: point.y,
        ghostNodeIds: item.ghostNodeIds,
        itemIndex
      });
    });
    return;
  },
  'enclosure': (item, itemIndex, context) => {
    const { requirePoint, primitives, labelWidth, labelHeight } = context;
    const point = requirePoint(itemIndex, item.nodeId, 'shell');
    if (!point) return;
    primitives.push({
      type: 'enclosure',
      licence: item.licence,
      x: point.x - labelWidth,
      y: point.y - labelHeight,
      width: labelWidth * 2,
      height: labelHeight * 3,
      itemIndex
    });
    return;
  },
  'branch-emphasis': (item, itemIndex, context) => {
    const { requirePoint, primitives } = context;
    const bindEdges = (edges: Array<{ fromNodeId: string; toNodeId: string }>) =>
      edges.flatMap((edge) => {
        const from = requirePoint(itemIndex, edge.fromNodeId);
        const to = requirePoint(itemIndex, edge.toNodeId);
        return from && to ? [{ from, to }] : [];
      });
    const strongEdges = bindEdges(item.strongEdges);
    const weakEdges = bindEdges(item.weakEdges);
    if (strongEdges.length === 0 && weakEdges.length === 0) return;
    primitives.push({ type: 'branch-emphasis', strongEdges, weakEdges, itemIndex });
    return;
  },
  'shared-node': (item, itemIndex, context) => {
    const { requirePoint, primitives } = context;
    const shared = requirePoint(itemIndex, item.sharedNodeId, 'shell');
    if (!shared) return;
    item.parentNodeIds.forEach((parentNodeId) => {
      const parent = requirePoint(itemIndex, parentNodeId, 'shell');
      if (!parent) return;
      primitives.push({ type: 'shared-branch', from: parent, to: shared, itemIndex });
    });
    return;
  }
} satisfies Partial<GeometryBinders>;
