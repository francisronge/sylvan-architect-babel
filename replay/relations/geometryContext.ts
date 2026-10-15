import type {
  BindGeometryOptions,
  BoundFrame,
  BoundPrimitive,
  BoundShapePath,
  PlanPositionProvider
} from './boundGeometry.ts';
import type { UnroutedFallbackSegment } from './fallbackGeometry.ts';
import type { Point, Rect } from './overlayGeometry.ts';
import type { RelationPlanItem, RelationRenderPlan } from './renderPlan.ts';

type RoutableCurve = {
  primitive: BoundShapePath;
  sample: (ordinal: number) => Point[];
  rebuild: (ordinal: number) => void;
};

export const createGeometryContext = (frame: RelationRenderPlan['frames'][number], positionFor: PlanPositionProvider, options: BindGeometryOptions) => {
  const labelWidth = options.labelWidth ?? 80;
  const labelHeight = options.labelHeight ?? 28;
  const badgeGap = options.badgeGap ?? 22;
  const laneGap = options.laneGap ?? 24;
  const markerScale = Math.max(0.1, options.markerScale ?? 1);
  const primitives: BoundPrimitive[] = [];
  const failed: BoundFrame['failed'] = [];
  /*
   * Policy diagnostics are NOT binding failures: an anchor-set entry that
   * never resolved at its authoring stage is, per the accepted large-array
   * policy, a diagnostic while every resolved participant still renders.
   * They live in their own channel so the per-item binding transaction
   * (which rolls back on real missing-geometry failures) never mistakes
   * accepted policy for a broken mark; they merge into `failed` at the end.
   */
  const policyFailed: BoundFrame['failed'] = [];
  const outlinedLabels = new Set(frame.items.flatMap(item =>
    item.kind === 'domain-mark' && item.domainStyle === 'transfer-edge'
      ? item.memberNodeIds.length ? item.memberNodeIds : item.rootNodeId ? [item.rootNodeId] : []
      : []));

  const rectFor = (nodeId: string): Rect | null => {
    const point = positionFor(nodeId);
    if (!point) return null;
    return {
      x: point.x - labelWidth / 2,
      y: point.y - labelHeight / 2,
      width: labelWidth,
      height: labelHeight
    };
  };
  const requirePoint = (
    itemIndex: number,
    nodeId: string,
    attachment: 'terminal' | 'shell' | 'shell-top' | 'shell-bottom' | 'position' = 'position'
  ): Point | null => {
    const point = positionFor(nodeId, attachment);
    if (!point) {
      failed.push({
        itemIndex,
        nodeId,
        reason: attachment === 'terminal'
          ? 'no visible materialized terminal for the anchored endpoint; mark fails closed'
          : 'no measured position for the anchored node; mark fails closed'
      });
    }
    return point;
  };

  /** Same-node badges form one row, allocated in authored order left to right. */
  const stackCounts = new Map<string, number>();
  const nextStackIndex = (nodeId: string): number => {
    const stackIndex = stackCounts.get(nodeId) ?? 0;
    stackCounts.set(nodeId, stackIndex + 1);
    return stackIndex;
  };
  /** Per-route ordinal for coincident trajectories, deterministic in item order. */
  const styleOrdinals = new Map<string, number>();
  const nextStyleOrdinal = (style: string): number => {
    const ordinal = styleOrdinals.get(style) ?? 0;
    styleOrdinals.set(style, ordinal + 1);
    return ordinal;
  };
  /*
   * Geometry-aware curve routing. Routed curves are bound at their base
   * route first and registered here; after every primitive of the frame is
   * bound, the router measures which curves actually come close to each
   * other or cross a plate, and re-routes ONLY those. Far-apart curves keep
   * their base geometry untouched, whatever their style.
   */
  const routableCurves: RoutableCurve[] = [];
  const registerRoutedCurve = (
    itemIndex: number,
    sample: (ordinal: number) => Point[],
    build: (ordinal: number) => Omit<BoundShapePath, 'type' | 'itemIndex'>
  ) => {
    const primitive: BoundShapePath = { type: 'shape-path', itemIndex, ...build(0) };
    primitives.push(primitive);
    routableCurves.push({
      primitive,
      sample,
      rebuild: (ordinal) => {
        const carrier = primitive as unknown as Record<string, unknown>;
        Object.keys(carrier).forEach((key) => {
          if (key !== 'type' && key !== 'itemIndex') delete carrier[key];
        });
        Object.assign(carrier, build(ordinal));
      }
    });
  };
  /** World-space plate rectangles, including the marker counter-scale. */
  const plaqueRects: Rect[] = [];
  const intersects = (left: Rect, right: Rect, gap = 0): boolean => !(
    left.x + left.width + gap <= right.x
    || right.x + right.width + gap <= left.x
    || left.y + left.height + gap <= right.y
    || right.y + right.height + gap <= left.y
  );

  const pendingSegments: UnroutedFallbackSegment[] = [];
  const fallbackAllocationOrder = 0;
  const fallbackOccupied = [...(options.fallbackMeasurements?.labels ?? []), ...(options.fallbackMeasurements?.obstacles ?? [])];
  /*
   * Neutral badges identify individual authored participants. A missing peer
   * suppresses only its badge and connectors that need it; diagnostics remain.
   * All other items are complete visual assertions: either
   * every geometry dependency it requires resolves and the COMPLETE set of
   * primitives is emitted, or the item emits nothing and only its truthful
   * `failed` diagnostics remain. A lone index badge is not a two-node
   * coreference. Each item runs inside a transaction over every piece of
   * mutable binder state; any failure recorded while binding the item rolls
   * all of it back — primitives, routed-curve registrations, segment lanes,
   * plaque occupancy, and the stacking/ordinal counters the next valid item
   * must not inherit. Independent plan items still bind or fail
   * independently.
   */
  const restoreMap = <K, V>(target: Map<K, V>, snapshot: Map<K, V>) => {
    target.clear();
    snapshot.forEach((value, key) => target.set(key, value));
  };
  const bindTransaction = (kind: RelationPlanItem['kind'], bind: () => void): void => {
    const txn = {
      primitives: primitives.length,
      failed: failed.length,
      routable: routableCurves.length,
      pending: pendingSegments.length,
      plaques: plaqueRects.length,
      stacks: new Map(stackCounts),
      ordinals: new Map(styleOrdinals)
    };
    bind();
    if (failed.length > txn.failed && kind !== 'fallback') {
      primitives.length = txn.primitives;
      routableCurves.length = txn.routable;
      pendingSegments.length = txn.pending;
      plaqueRects.length = txn.plaques;
      restoreMap(stackCounts, txn.stacks);
      restoreMap(styleOrdinals, txn.ordinals);
    }
  };
  return {
    frame,
    positionFor,
    options,
    labelWidth,
    labelHeight,
    badgeGap,
    laneGap,
    markerScale,
    primitives,
    bindTransaction,
    failed,
    policyFailed,
    outlinedLabels,
    rectFor,
    requirePoint,
    nextStackIndex,
    nextStyleOrdinal,
    routableCurves,
    registerRoutedCurve,
    plaqueRects,
    intersects,
    pendingSegments,
    fallbackAllocationOrder,
    fallbackOccupied
  };
};

export type GeometryContext = ReturnType<typeof createGeometryContext>;
export type GeometryBinders = {
  [K in RelationPlanItem['kind']]: (item: Extract<RelationPlanItem, { kind: K }>, itemIndex: number, context: GeometryContext) => void;
};

/** Native painters retain these binding records but position their own marks. */
export const usesBoundBadgePosition = (item: RelationPlanItem): boolean => {
  if (item.kind === 'fallback' || item.kind === 'binding-domain') return true;
  if (item.kind === 'coindex') {
    return item.familyId !== 'identity.occurrences' && item.familyId !== 'lf.reconstruction';
  }
  if (item.kind !== 'node-badges') return false;
  if (['agreement-goal', 'idiom-chunk', 'boundary-cut'].includes(item.badgeStyle)) return false;
  if (item.badgeStyle === 'gap-notation'
    && ['trajectory.across-the-board', 'trajectory.sideward'].includes(item.familyId ?? '')) return false;
  return ![
    'theta.grid',
    'anti-locality.paths',
    'improper-movement.landing',
    'multidominance.shared-node',
    'argument-sharing.domains',
    'intervention.blocked-path'
  ].includes(item.familyId ?? '');
};

