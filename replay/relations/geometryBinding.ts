import { annotationGeometry } from './annotationGeometry.ts';
import type { BindGeometryOptions, BoundAnchorSetBadge, BoundFrame, PlanPositionProvider } from './boundGeometry.ts';
import { fallbackRailY, routeFallbackSegments } from './fallbackGeometry.ts';
import { createGeometryContext, usesBoundBadgePosition, type GeometryBinders } from './geometryContext.ts';
import { neutralGeometry } from './neutralGeometry.ts';
import type { Point, Rect } from './overlayGeometry.ts';
import { pathGeometry } from './pathGeometry.ts';
import { regionGeometry } from './regionGeometry.ts';
import type { RelationPlanItem, RelationRenderPlan } from './renderPlan.ts';

/**
 * Pure geometry binding: a compiled plan frame plus the renderer's real
 * post-layout node positions in, positioned drawing primitives out.
 *
 * The renderer (TreeVisualizer) owns layout and supplies `positionFor`; this
 * module never reads a DOM and never guesses a position. A plan item whose
 * node has no measured position fails closed into `failed` with a reason —
 * nothing is drawn at an invented location. Fallback labels reproduce authored
 * roles and array positions; they do not
 * interpret a relation or introduce a linguistic claim.
 */

export const bindRelationPlanFrame = (
  plan: RelationRenderPlan,
  stageIndex: number,
  positionFor: PlanPositionProvider,
  options: BindGeometryOptions = {}
): BoundFrame => {
  const frame = plan.frames[stageIndex];
  if (!frame) return { stageIndex, primitives: [], failed: [] };
  const context = createGeometryContext(frame, positionFor, options);
  const {
    laneGap,
    markerScale,
    primitives,
    failed,
    policyFailed,
    routableCurves,
    plaqueRects,
    intersects,
    pendingSegments
  } = context;
  const bindPlanItem = <K extends RelationPlanItem['kind']>(item: Extract<RelationPlanItem, { kind: K }>, itemIndex: number) => {
    const binders: GeometryBinders = primitiveBinders;
    binders[item.kind](item, itemIndex, context);
  };

  // Draw-layer order can put a future badge before a persistent fallback.
  // Bind only the slot consumers chronologically, preserving every other
  // item's place and restoring primitive paint order after allocation.
  const entries = frame.items.map((item, itemIndex) => ({ item, itemIndex }));
  const badgeEntries = entries.filter(({ item }) => usesBoundBadgePosition(item))
    .map((entry) => ({
      ...entry,
      firstMoment: [entry.item.relationRef, ...(entry.item.coalescedRefs ?? []),
      ...(entry.item.composedRefs ?? [])].reduce((first, ref) => (
        ref.stageIndex < first.stageIndex
          || (ref.stageIndex === first.stageIndex && ref.relationIndex < first.relationIndex)
          ? ref : first
      ))
    }))
    .sort((left, right) => left.firstMoment.stageIndex - right.firstMoment.stageIndex
      || left.firstMoment.relationIndex - right.firstMoment.relationIndex
      || left.itemIndex - right.itemIndex);
  let badgeCursor = 0;
  entries.forEach((entry) => {
    const { item, itemIndex } = usesBoundBadgePosition(entry.item) ? badgeEntries[badgeCursor++] : entry;
    context.bindTransaction(item.kind, () => bindPlanItem(item, itemIndex));
  });
  primitives.sort((left, right) => left.itemIndex - right.itemIndex);

  /*
   * Collision routing over measured geometry, deterministic in item order.
   * Two curves conflict only when their sampled base routes actually come
   * within clearance of each other — coincident or crossing curves route
   * apart with within-cluster ordinals; far-apart curves of any style keep
   * ordinal 0 and are never shifted. Plates are treated as obstacles: a
   * curve crossing one deepens its route until clear when a lawful route
   * exists within the try budget; otherwise the mark keeps its
   * least-obstructive route and is flagged `routing: 'constrained'` instead
   * of being suppressed. Domain regions are containment semantics, not
   * occluders — a path may lawfully live inside its own domain — so they
   * are not obstacles.
   */
  const CURVE_CLEARANCE = 24;
  const OBSTACLE_MARGIN = 6;
  const PLAQUE_ROUTING_WIDTH = 150;
  if (routableCurves.length > 0) {
    const baseSamples = routableCurves.map((curve) => curve.sample(0));
    const parent = routableCurves.map((_curve, index) => index);
    const findRoot = (index: number): number => {
      let root = index;
      while (parent[root] !== root) root = parent[root];
      let cursor = index;
      while (parent[cursor] !== root) {
        const next = parent[cursor];
        parent[cursor] = root;
        cursor = next;
      }
      return root;
    };
    const near = (left: Point[], right: Point[]): boolean => {
      const limitSquared = CURVE_CLEARANCE * CURVE_CLEARANCE;
      return left.some((p) => right.some((q) => {
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        return dx * dx + dy * dy < limitSquared;
      }));
    };
    for (let i = 0; i < routableCurves.length; i += 1) {
      for (let j = i + 1; j < routableCurves.length; j += 1) {
        if (near(baseSamples[i], baseSamples[j])) parent[findRoot(i)] = findRoot(j);
      }
    }
    const obstacles = primitives.flatMap((primitive) =>
      primitive.type === 'plaque'
        ? [{
          x: primitive.x - OBSTACLE_MARGIN,
          y: primitive.y - OBSTACLE_MARGIN,
          width: Math.max(PLAQUE_ROUTING_WIDTH, primitive.width * markerScale) + OBSTACLE_MARGIN * 2,
          height: primitive.height * markerScale + OBSTACLE_MARGIN * 2
        }]
        : []);
    const insideObstacle = (point: Point): boolean =>
      obstacles.some((rect) =>
        point.x >= rect.x && point.x <= rect.x + rect.width
        && point.y >= rect.y && point.y <= rect.y + rect.height);
    const usedByCluster = new Map<number, Set<number>>();
    routableCurves.forEach((curve, index) => {
      const root = findRoot(index);
      const used = usedByCluster.get(root) ?? new Set<number>();
      usedByCluster.set(root, used);
      let base = 0;
      while (used.has(base)) base += 1;
      const clears = (ordinal: number): boolean =>
        !curve.sample(ordinal).some(insideObstacle);
      let chosen = base;
      let cleared = clears(base);
      for (let bump = 1; !cleared && bump <= 3; bump += 1) {
        const candidate = base + bump;
        if (used.has(candidate)) continue;
        if (clears(candidate)) {
          chosen = candidate;
          cleared = true;
        }
      }
      used.add(chosen);
      if (chosen !== 0) curve.rebuild(chosen);
      if (!cleared) curve.primitive.routing = 'constrained';
    });
  }

  /*
   * Path labels are screen-stable markers too. Stack only labels whose
   * measured boxes actually collide with another label or plate; unrelated
   * labels keep their source-backed position.
   */
  const labelRects: Rect[] = [];
  primitives.forEach((primitive) => {
    if (primitive.type !== 'shape-path' || !primitive.label || !primitive.labelAt) return;
    const width = Math.max(16, primitive.label.length * 7) * markerScale;
    const height = 16 * markerScale;
    const base = primitive.labelAt;
    const candidates = [0, 1, -1, 2, -2, 3, -3];
    let chosen = base;
    for (const lane of candidates) {
      const candidate = { x: base.x, y: base.y + lane * (height + 8 * markerScale) };
      const rect = {
        x: candidate.x - width / 2,
        y: candidate.y - height,
        width,
        height
      };
      if (![...plaqueRects, ...labelRects].some((occupied) => intersects(rect, occupied, 4 * markerScale))) {
        chosen = candidate;
        labelRects.push(rect);
        break;
      }
    }
    primitive.labelAt = chosen;
  });

  /*
   * Deterministic lanes for counter-lane fallback connectors, in item
   * order, rendered as COMPLETE geometry: the allocated lane picks the
   * connector's own below-row Y, and the path connects the two subtree bottoms. Colliding
   * spans therefore occupy visibly distinct lanes; the renderer draws `d`
   * verbatim and cannot discard the routing.
   */
  primitives.push(...routeFallbackSegments(pendingSegments, {
    markerScale, laneGap, obstacles: options.fallbackMeasurements?.obstacles,
    fallbackMeasurements: options.fallbackMeasurements, connectorBaselineY: options.connectorBaselineY
  }));
  /*
   * The one vertical allocation law: rails sit a safe gap below the deepest
   * ACTUALLY allocated connector lane (or at the caller's measured base,
   * whichever is deeper).
   */
  const deepestConnectorLaneY = primitives.reduce((deepest, primitive) =>
  (primitive.type === 'segment' && primitive.route === 'counter-lane'
    ? Math.max(deepest, primitive.laneY ?? 0)
    : deepest), 0);
  primitives.forEach((primitive) => {
    if (primitive.type === 'anchor-set-rail') {
      primitive.y = fallbackRailY(primitive, deepestConnectorLaneY, options);
    }
  });

  failed.push(...policyFailed);

  return { stageIndex, primitives, failed };
};

const primitiveBinders = { ...pathGeometry, ...regionGeometry, ...annotationGeometry, ...neutralGeometry } satisfies GeometryBinders;

/**
 * The anchor-set badges `bindRelationPlanFrame` places for the same frame and
 * options, every one its binder computes (also those a neutral mark replaces).
 * Badge placement depends on its own item, the frame's badge obstacles and the
 * badges of revealed anchor sets bound before it, all of which this replays in
 * the frame's item order, so Fit re-places the drawn badges for the marker
 * scale it settles (`options.markerScale`), which can differ from the scale
 * the frame was bound at. A badge is identified by its `itemIndex`, `nodeId`
 * and `stackIndex`.
 */
export const bindAnchorSetBadges = (
  plan: RelationRenderPlan,
  stageIndex: number,
  positionFor: PlanPositionProvider,
  options: BindGeometryOptions = {}
): BoundAnchorSetBadge[] => {
  const frame = plan.frames[stageIndex];
  if (!frame) return [];
  const context = createGeometryContext(frame, positionFor, options);
  frame.items.forEach((item, itemIndex) => {
    if (item.kind === 'anchor-set') context.bindTransaction(item.kind, () => neutralGeometry['anchor-set'](item, itemIndex, context));
  });
  return context.primitives.filter((primitive): primitive is BoundAnchorSetBadge => primitive.type === 'anchor-set-badge');
};
