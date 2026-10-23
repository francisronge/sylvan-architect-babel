import { quadraticTrajectoryBellyY, TRAJECTORY_ROUTES } from '../rendererMetrics.ts';
import type { BoundShapePath } from './boundGeometry.ts';
import type { GeometryBinders } from './geometryContext.ts';
import {
  barCapPath,
  caseAssignmentPath,
  checkMarkPath,
  dottedCollectionControls,
  dottedCollectionPath,
  featureSharingVinePaths,
  fongComponentArcPath,
  fongComponentLabelPoint,
  nestedUnderArcPath,
  orthogonalElbowPath,
  orthogonalTrajectoryPath,
  routedAgreementControls,
  routedAgreementPath,
  sampleCubic,
  sampleQuadratic,
  sweepingCurveControl,
  sweepingCurvePath,
  transferAccessLanePath,
  vineConvergence
} from './markGeometry.ts';
import type { Point, Rect } from './overlayGeometry.ts';
import { trajectorySourceNodeId } from './renderPlan.ts';

export const pathGeometry = {
  'trajectory': (item, itemIndex, context) => {
    const { requirePoint, nextStyleOrdinal, primitives, options } = context;
    // Endpoint attachment comes from the semantic plan: the departure is
    // the witness (or source) resolved per sourceAttachment, the landing is
    // the target resolved per targetAttachment. Initial head landings use
    // their terminal; retained wordless witnesses use their category shell.
    const departureNodeId = trajectorySourceNodeId(item);
    const from = requirePoint(itemIndex, departureNodeId, item.sourceAttachment);
    const to = requirePoint(itemIndex, item.targetNodeId, item.targetAttachment);
    if (!from || !to) return;
    /*
     * The complete production movement path is pure binder geometry:
     * coincident routes fan by ordinal, endpoints inset toward each
     * other, and the belly deepens with horizontal span. The renderer
     * draws this path verbatim, and overlay bounds use its exact
     * extrema — no duplicated or guessed curve math anywhere else.
     */
    const ordinal = nextStyleOrdinal(`trajectory:${item.sourceNodeId}->${item.targetNodeId}`);
    const fanOffset = ordinal * 20;
    if (item.trajectoryKind === 'sideward') {
      const crestY = options.trajectoryCeilingY
        ?? Math.min(from.y - TRAJECTORY_ROUTES.crestAboveEndpoint, to.y - TRAJECTORY_ROUTES.crestAboveEndpoint);
      const control = { x: from.x, y: crestY };
      const control2 = { x: to.x, y: crestY };
      primitives.push({
        type: 'trajectory-path',
        trajectoryKind: item.trajectoryKind,
        route: 'cubic',
        fitPolicy: 'tree-first',
        from,
        to,
        ordinal,
        d: `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} C ${control.x.toFixed(1)} ${control.y.toFixed(1)}, ${control2.x.toFixed(1)} ${control2.y.toFixed(1)}, ${to.x.toFixed(1)} ${to.y.toFixed(1)}`,
        control,
        control2,
        start: from,
        end: to,
        itemIndex
      });
      return;
    }
    if (
      item.trajectoryKind === 'remnant'
      || item.trajectoryKind === 'roll-up'
      || item.trajectoryKind === 'smuggling'
    ) {
      const laneY = item.trajectoryKind === 'roll-up'
        ? Math.max(from.y, to.y) + TRAJECTORY_ROUTES.rollUpLaneOffset + ordinal * TRAJECTORY_ROUTES.rollUpLaneStep
        : options.trajectoryFloorY
        ?? Math.max(from.y, to.y) + TRAJECTORY_ROUTES.orthogonalLaneSpacing * (ordinal + 1);
      const control = { x: from.x, y: laneY };
      primitives.push({
        type: 'trajectory-path',
        trajectoryKind: item.trajectoryKind,
        route: 'orthogonal',
        fitPolicy: 'tree-first',
        from,
        to,
        ordinal,
        d: orthogonalTrajectoryPath(from, to, laneY),
        control,
        start: from,
        end: to,
        itemIndex
      });
      return;
    }
    const direction = Math.sign(to.x - from.x) || 1;
    const inset = TRAJECTORY_ROUTES.quadraticEndpointInset;
    const start = { x: from.x + inset * direction, y: from.y + fanOffset };
    const end = { x: to.x - inset * direction, y: to.y + fanOffset };
    const control = { x: (start.x + end.x) / 2, y: quadraticTrajectoryBellyY(start, end) + fanOffset };
    primitives.push({
      type: 'trajectory-path',
      trajectoryKind: item.trajectoryKind,
      route: 'quadratic',
      fitPolicy: 'tree-first',
      from,
      to,
      ordinal,
      d: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
      control,
      start,
      end,
      itemIndex
    });
    return;
  },
  'directed-path': (item, itemIndex, context) => {
    const { requirePoint, primitives, registerRoutedCurve, labelHeight } = context;
    const from = requirePoint(itemIndex, item.fromNodeId);
    const to = requirePoint(itemIndex, item.toNodeId);
    if (!from || !to) return;
    const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const below = (point: Point, dy: number): Point => ({ x: point.x, y: point.y + dy });
    const push = (shape: Omit<BoundShapePath, 'type' | 'itemIndex'>) =>
      primitives.push({ type: 'shape-path', itemIndex, ...shape });
    /** A sweeping curve whose belly the collision router may deepen. */
    const registerSweep = (
      start: Point,
      end: Point,
      build: (ordinal: number) => Omit<BoundShapePath, 'type' | 'itemIndex'>
    ) =>
      registerRoutedCurve(
        itemIndex,
        (ordinal) => sampleQuadratic(start, sweepingCurveControl(start, end, ordinal * 26), end),
        build
      );

    switch (item.pathStyle) {
      case 'dependent-case': {
        // The accepted elbow: down from the probe, across to the goal, with
        // filled circular endpoints and never an arrowhead.
        const upper = below(from, labelHeight);
        const lower = { x: to.x - 14, y: to.y };
        push({
          shapeStyle: 'dependent-case',
          fitPolicy: 'tree-first',
          d: orthogonalElbowPath(upper, lower),
          stroke: 'solid',
          arrowhead: false,
          endpointDots: [upper, lower],
          ...(item.label ? { label: item.label, labelAt: below(upper, 18) } : {}),
          ...(item.secondaryLabel
            ? { badge: { text: item.secondaryLabel, at: below(lower, 24) } }
            : {})
        });
        return;
      }
      case 'accord': {
        // Hoyt's dashed orthogonal dependency path between the indexed
        // polarity features.
        const upper = below(from, labelHeight);
        const lower = { x: to.x, y: to.y + labelHeight };
        push({
          shapeStyle: 'accord',
          d: orthogonalElbowPath(upper, lower),
          stroke: 'dashed',
          arrowhead: true,
          ...(item.label ? { label: item.label, labelAt: below(upper, 18) } : {})
        });
        return;
      }
      case 'anti-locality': {
        // AntiLocality judges an independently authored DP chain. Its
        // source-backed dotted path and verdict restyle that chain without
        // owning the syntax transition that created its occurrences.
        const sourceShell = requirePoint(itemIndex, item.fromNodeId, 'shell-bottom');
        const landingShell = requirePoint(itemIndex, item.toNodeId, 'shell-bottom');
        if (!sourceShell || !landingShell) return;
        const direction = Math.sign(landingShell.x - sourceShell.x) || 1;
        const start = { x: sourceShell.x + 8 * direction, y: sourceShell.y };
        const insetEnd = { x: landingShell.x - 8 * direction, y: landingShell.y };
        const end = item.outcome === 'blocked'
          ? { x: landingShell.x, y: insetEnd.y }
          : insetEnd;
        const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
        registerSweep(start, end, (ordinal) => {
          const control = item.outcome === 'blocked'
            ? {
              x: end.x,
              y: Math.max(start.y, end.y)
                + Math.max(180, Math.abs(start.x - end.x) * 0.2)
            }
            : {
              x: (start.x + end.x) / 2,
              y: Math.max(start.y, end.y)
                + Math.max(42, Math.abs(end.x - start.x) * 0.2)
                + ordinal * 20
            };
          return {
            shapeStyle: 'anti-locality',
            fitPolicy: 'tree-first',
            d: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
            stroke: 'dashed',
            arrowhead: false,
            blocked: item.outcome === 'blocked',
            // The bar cap and the licensed check are authored judgments; an
            // instance with no recognized outcome draws the comparison curve
            // with no judgment mark at all.
            ...(item.outcome === 'blocked'
              ? { tip: { kind: 'bar' as const, d: barCapPath(end), at: end } }
              : item.outcome === 'licensed'
                ? { tip: { kind: 'check' as const, d: checkMarkPath(below(midpoint, 30)), at: below(midpoint, 30) } }
                : {})
          };
        });
        return;
      }
      case 'agree-multiple':
      case 'agree-cyclic': {
        const start = below(from, 24);
        const end = below(to, 24);
        registerRoutedCurve(
          itemIndex,
          (ordinal) => {
            const [c1, c2] = routedAgreementControls(start, end, ordinal);
            return sampleCubic(start, c1, c2, end);
          },
          (ordinal) => ({
            shapeStyle: item.pathStyle,
            fitPolicy: 'tree-first',
            d: routedAgreementPath(start, end, ordinal),
            stroke: 'solid',
            arrowhead: true,
            ...(item.pathStyle === 'agree-cyclic' && item.label
              ? { badge: { text: item.label, at: below(midpoint, 40 + ordinal * 26) } }
              : {}),
            ...(item.pathStyle === 'agree-multiple' && item.label
              ? { label: item.label, labelAt: below(midpoint, 40 + ordinal * 26) }
              : {}),
            ...(item.secondaryLabel
              ? { label: item.secondaryLabel, labelAt: below(midpoint, 62 + ordinal * 26) }
              : {})
          })
        );
        return;
      }
      case 'case-assignment': {
        push({
          shapeStyle: 'case-assignment',
          fitPolicy: 'tree-first',
          d: caseAssignmentPath(below(from, 8), to),
          stroke: 'solid',
          arrowhead: item.outcome !== 'blocked',
          ...(item.outcome === 'blocked' ? {
            blocked: true,
            tip: { kind: 'cross' as const, at: midpoint }
          } : {}),
          ...(item.label ? { label: item.label, labelAt: below(midpoint, 26) } : {})
        });
        return;
      }
      case 'case-agree': {
        // The quieter dotted collection curve feeding the Case path.
        const start = below(from, 16);
        const end = below(to, 16);
        registerRoutedCurve(
          itemIndex,
          (ordinal) => {
            const [c1, c2] = dottedCollectionControls(start, end, ordinal);
            return sampleCubic(start, c1, c2, end);
          },
          (ordinal) => ({
            shapeStyle: 'case-agree',
            fitPolicy: 'tree-first',
            d: dottedCollectionPath(start, end, ordinal),
            stroke: 'dotted',
            arrowhead: false,
            ...(item.outcome === 'blocked' ? {
              blocked: true,
              tip: { kind: 'cross' as const, at: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } }
            } : {}),
            ...(item.label ? { label: item.label, labelAt: below(midpoint, 46 + ordinal * 22) } : {})
          })
        );
        return;
      }
      case 'blocked-access': {
        const start = below(from, 24);
        const end = below(to, 24);
        registerSweep(start, end, (ordinal) => ({
          shapeStyle: 'blocked-access',
          d: sweepingCurvePath(start, end, ordinal * 26),
          stroke: 'dashed',
          arrowhead: false,
          blocked: true,
          originDot: start,
          tip: { kind: 'cross', at: below(midpoint, 30) }
        }));
        return;
      }
      case 'blocked-extraction': {
        // Oseki's double-ended diagnostic with the authored star label.
        const start = below(from, 24);
        const end = below(to, 24);
        registerSweep(start, end, (ordinal) => ({
          shapeStyle: 'blocked-extraction',
          d: sweepingCurvePath(start, end, ordinal * 26),
          stroke: 'dashed',
          arrowhead: true,
          arrowheadBoth: true,
          blocked: true,
          ...(item.label ? { label: item.label, labelAt: below(midpoint, 34) } : {})
        }));
        return;
      }
      case 'intervention': {
        const start = below(from, 24);
        const end = below(to, 24);
        registerSweep(start, end, (ordinal) => ({
          shapeStyle: 'intervention',
          d: sweepingCurvePath(start, end, ordinal * 26),
          stroke: 'dashed',
          arrowhead: true,
          blocked: true,
          tip: { kind: 'cross', at: below(midpoint, 30) }
        }));
        return;
      }
      case 'covert-qr':
      case 'f-projection': {
        const start = below(from, 24);
        const end = below(to, 24);
        registerSweep(start, end, (ordinal) => ({
          shapeStyle: item.pathStyle,
          d: sweepingCurvePath(start, end, ordinal * 26),
          stroke: 'dashed',
          arrowhead: true,
          ...(item.label ? { label: item.label, labelAt: below(midpoint, 30) } : {})
        }));
        return;
      }
      case 'improper-candidate': {
        // A rejected landing candidate: dashed, into the forbidden region,
        // with the blocking X.
        const start = below(from, 24);
        const end = below(to, 24);
        registerSweep(start, end, (ordinal) => ({
          shapeStyle: 'improper-candidate',
          fitPolicy: 'tree-first',
          d: sweepingCurvePath(start, end, ordinal * 26),
          stroke: 'dashed',
          arrowhead: true,
          blocked: true,
          tip: { kind: 'cross', at: below(midpoint, 30) }
        }));
        return;
      }
      default: {
        // Control's sourced directed dependency curve.
        const start = below(from, 24);
        const end = below(to, 24);
        registerSweep(start, end, (ordinal) => ({
          shapeStyle: item.pathStyle,
          ...(item.pathStyle === 'control' ? { fitPolicy: 'tree-first' as const } : {}),
          d: sweepingCurvePath(start, end, ordinal * 26),
          stroke: 'solid',
          arrowhead: true,
          ...(item.label ? { label: item.label, labelAt: below(midpoint, 30) } : {}),
          ...(item.outcome === 'blocked' ? { blocked: true, tip: { kind: 'cross', at: below(midpoint, 30) } } : {})
        }));
      }
    }
    return;
  },
  'undirected-link': (item, itemIndex, context) => {
    const { primitives, rectFor, failed, requirePoint, labelHeight } = context;
    if (item.linkStyle === 'pair-merge') {
      const targetNodeIds = item.pairs.flatMap((pair) => [pair.fromNodeId, pair.toNodeId]);
      primitives.push({
        type: 'native-branch-overlay',
        targetNodeIds: [...new Set(targetNodeIds)],
        requireSharedParent: true,
        variant: 'pair-merge',
        itemIndex
      });
      return;
    }
    if (item.linkStyle === 'feature-sharing') {
      // The accepted vine geometry: one cubic per bearer converging on the
      // shared feature point beneath them.
      const bearerIds = [
        ...new Set(item.pairs.flatMap((pair) => [pair.fromNodeId, pair.toNodeId]))
      ];
      const bearerRects = bearerIds
        .map((nodeId) => ({ nodeId, rect: rectFor(nodeId) }))
        .filter((entry): entry is { nodeId: string; rect: Rect } => {
          if (entry.rect) return true;
          failed.push({
            itemIndex,
            nodeId: entry.nodeId,
            reason: 'no measured position for the anchored node; mark fails closed'
          });
          return false;
        });
      if (bearerRects.length < 2) return;
      const convergence = vineConvergence(bearerRects.map((entry) => entry.rect));
      const vinePaths = featureSharingVinePaths(bearerRects.map(entry => ({
        x: entry.rect.x + entry.rect.width / 2,
        y: entry.rect.y + entry.rect.height + 22
      })), convergence, bearerRects.map(entry => entry.rect));
      vinePaths.forEach(path => {
        primitives.push({
          type: 'shape-path',
          shapeStyle: 'feature-sharing-vine',
          fitPolicy: 'tree-first',
          d: path,
          stroke: 'solid',
          arrowhead: false,
          itemIndex
        });
      });
      if (item.label) {
        primitives.push({
          type: 'shape-path',
          shapeStyle: 'feature-sharing-label',
          fitPolicy: 'tree-first',
          d: `M ${convergence.x} ${convergence.y} L ${convergence.x} ${convergence.y}`,
          stroke: 'solid',
          arrowhead: false,
          label: item.label,
          labelAt: { x: convergence.x, y: convergence.y + 28 },
          itemIndex
        });
      }
      return;
    }
    if (item.linkStyle === 'strong-npi') {
      // Two nested, unheaded licensing curves beneath the authored labels;
      // the outer nest dips deeper.
      item.pairs.forEach((pair, pairIndex) => {
        const from = requirePoint(itemIndex, pair.fromNodeId);
        const to = requirePoint(itemIndex, pair.toNodeId);
        if (!from || !to) return;
        const startY = from.y + labelHeight + 12;
        const endY = to.y + labelHeight + 12;
        primitives.push({
          type: 'shape-path',
          shapeStyle: 'strong-npi',
          d: nestedUnderArcPath(from.x, to.x, startY, 44 + pairIndex * 30, endY),
          stroke: 'solid',
          arrowhead: false,
          ...(pairIndex === 0 && item.label
            ? { label: item.label, labelAt: { x: (from.x + to.x) / 2, y: Math.max(startY, endY) + 60 } }
            : {}),
          itemIndex
        });
      });
      return;
    }
    // Predication's dotted interpretive paths and the gapping pair rails.
    item.pairs.forEach((pair) => {
      const from = requirePoint(itemIndex, pair.fromNodeId);
      const to = requirePoint(itemIndex, pair.toNodeId);
      if (!from || !to) return;
      primitives.push({
        type: 'shape-path',
        shapeStyle: item.linkStyle,
        ...(item.linkStyle === 'predication' ? { fitPolicy: 'tree-first' as const } : {}),
        d: `M ${from.x} ${from.y + 30} L ${to.x} ${to.y + 30}`,
        stroke: 'dotted',
        arrowhead: false,
        ...(pair.label || item.label
          ? {
            label: pair.label || item.label,
            labelAt: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + 48 }
          }
          : {}),
        itemIndex
      });
    });
    return;
  },
  'fong-component': (item, itemIndex, context) => {
    const { rectFor, failed, primitives } = context;
    // Fong's tilted component arc, labelled at its accepted endpoint.
    const headRect = rectFor(item.headNodeId);
    if (!headRect) {
      failed.push({
        itemIndex,
        nodeId: item.headNodeId,
        reason: 'no measured position for the component head; mark fails closed'
      });
      return;
    }
    const labelAt = fongComponentLabelPoint(headRect);
    primitives.push({
      type: 'shape-path',
      shapeStyle: 'fong-component-arc',
      d: fongComponentArcPath(headRect),
      stroke: 'solid',
      arrowhead: false,
      label: item.componentLabel,
      labelAt,
      itemIndex
    });
    return;
  },
  'blocked-access-lane': (item, itemIndex, context) => {
    const { requirePoint, labelHeight, primitives, positionFor } = context;
    const source = requirePoint(itemIndex, item.sourceNodeId);
    const target = requirePoint(itemIndex, item.targetNodeId);
    if (!source || !target) return;
    const domainBottom = item.domainMemberNodeIds
      .map((nodeId) => positionFor(nodeId))
      .filter((point): point is Point => Boolean(point))
      .reduce((bottom, point) => Math.max(bottom, point.y + labelHeight), Math.max(source.y, target.y));
    const start = { x: source.x, y: source.y + labelHeight / 2 + 12 };
    const end = { x: target.x, y: target.y + labelHeight / 2 + 12 };
    const lane = transferAccessLanePath(start, end, domainBottom);
    primitives.push({
      type: 'shape-path',
      fitPolicy: 'tree-first',
      shapeStyle: 'transfer-access',
      d: lane.d,
      stroke: 'dashed',
      arrowhead: false,
      blocked: true,
      originDot: start,
      tip: { kind: 'cross', at: { x: (start.x + end.x) / 2, y: lane.laneY } },
      itemIndex
    });
    return;
  }
} satisfies Partial<GeometryBinders>;
