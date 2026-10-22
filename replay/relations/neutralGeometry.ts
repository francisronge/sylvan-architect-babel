import { spaceAuthoredName } from '../displayText.ts';
import type { BoundAnchorSetBadge, BoundFallbackMark } from './boundGeometry.ts';
import { FALLBACK_ROLE_STYLE, fallbackLabelRect, placeFallbackMark, routeFallbackSegments } from './fallbackGeometry.ts';
import type { GeometryBinders } from './geometryContext.ts';
import { fongEdgeOutlineRect } from './markGeometry.ts';
import type { Point } from './overlayGeometry.ts';
import { planAnchorSetLayout } from './overlayGeometry.ts';
import { fallbackPlaqueTextMeasure } from './plaqueTextLayout.ts';
import { planItemRelationRefs } from './renderPlan.ts';

export const neutralGeometry = {
  'fallback': (item, itemIndex, context) => {
    const {
      fallbackOccupied,
      requirePoint,
      rectFor,
      outlinedLabels,
      markerScale,
      nextStackIndex,
      primitives,
      pendingSegments,
      options
    } = context;
    const occupied = options.separateFallbackMoments
      ? [...(options.fallbackMeasurements?.labels ?? []), ...(options.fallbackMeasurements?.obstacles ?? [])]
      : fallbackOccupied;
    const markCenters = new Map<string, Point>();
    const ownedMarks: BoundFallbackMark[] = [];
    item.drawing.marks.forEach((mark) => {
      const point = requirePoint(itemIndex, mark.witness);
      if (!point) return;
      const measuredLabel = options.fallbackMeasurements?.labelFor(mark.witness) ?? rectFor(mark.witness)!;
      // The neutral role belongs outside the existing label's edge outline.
      // Reserve that outline without moving the syntax or enlarging the box.
      const labelRect = outlinedLabels.has(mark.witness) ? fongEdgeOutlineRect(measuredLabel) : measuredLabel;
      const text = spaceAuthoredName(mark.role, { snakeCase: true }) + (mark.position === null ? '' : `[${mark.position}]`);
      const measure = options.plaqueTextLayout?.measureText ?? fallbackPlaqueTextMeasure;
      const metrics = measure(text, FALLBACK_ROLE_STYLE);
      const textHeight = options.plaqueTextLayout?.measureText
        && Number.isFinite(metrics.ascent) && metrics.ascent! >= 0
        && Number.isFinite(metrics.descent) && metrics.descent! >= 0
        && metrics.ascent! + metrics.descent! > 0 ? metrics.ascent! + metrics.descent! : undefined;
      const shape = {
        labelRect, backward: mark.backward, numeral: mark.position, role: mark.role, text,
        textWidth: metrics.width, ...(textHeight === undefined ? {} : { textHeight })
      };
      const center = placeFallbackMark(shape, markerScale, occupied, undefined, options.direction);
      markCenters.set(mark.witness, center);
      const bound: BoundFallbackMark = {
        type: 'fallback-mark', nodeId: mark.witness, ...center, ...shape,
        frame: mark.frame, instance: mark.instance, allocationOrder: context.fallbackAllocationOrder++, stackIndex: nextStackIndex(mark.witness), itemIndex
      };
      ownedMarks.push(bound);
      primitives.push(bound);
    });
    // Fans join their own marks. Two-witness links start below their subtrees.
    if (item.drawing.link) {
      const subtreeBottom = (id: string): Point | null => {
        if (!markCenters.has(id)) return null;
        const rect = options.fallbackMeasurements?.subtreeFor(id) ?? rectFor(id);
        return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height } : null;
      };
      const first = subtreeBottom(item.drawing.link.endpoints[0]);
      const second = subtreeBottom(item.drawing.link.endpoints[1]);
      if (first && second) {
        const left = first.x <= second.x ? first : second;
        const right = left === first ? second : first;
        pendingSegments.push({
          type: 'segment',
          route: 'counter-lane',
          witnessNodeIds: [...item.drawing.link.endpoints],
          from: left,
          to: right,
          directed: false,
          itemIndex
        });
      }
    }
    if (item.drawing.fan) {
      const hub = ownedMarks.find(mark => mark.numeral === null);
      for (const target of ownedMarks.filter(mark => mark.numeral !== null)) {
        if (!hub || hub.nodeId === target.nodeId) continue;
        primitives.push(...routeFallbackSegments([{
          type: 'segment', route: 'direct', witnessNodeIds: [hub.nodeId, target.nodeId],
          from: { x: hub.x, y: hub.y }, to: { x: target.x, y: target.y },
          fromMark: hub.allocationOrder, toMark: target.allocationOrder, directed: false, itemIndex
        }], {
          markerScale, obstacles: options.fallbackMeasurements?.obstacles,
          labelClearances: ownedMarks.map(mark => fallbackLabelRect(mark, markerScale))
        }));
      }
    }
    return;
  },
  'anchor-set': (item, itemIndex, context) => {
    const { rectFor, badgeGap, markerScale, laneGap, policyFailed, failed, primitives, frame, options } = context;
    const layout = planAnchorSetLayout(
      [{
        relation: item.set.relation,
        instanceIndex: item.set.instanceIndex,
        roles: item.set.roles
      }],
      rectFor,
      { badgeOffsetY: badgeGap * markerScale, railGap: laneGap }
    );
    const unresolvedAtAuthoring = new Set(
      item.set.roles.flatMap((roleGroup) =>
        roleGroup.anchors
          .filter((anchor) => !anchor.resolved)
          .map((anchor) => String(anchor.nodeId || '')))
    );
    layout.failed.forEach((failure) => {
      const channel = unresolvedAtAuthoring.has(String(failure.nodeId || ''))
        ? policyFailed
        : failed;
      channel.push({ itemIndex, nodeId: failure.nodeId, reason: failure.reason });
    });
    const badges: BoundAnchorSetBadge[] = layout.badges.map((badge) => ({
      type: 'anchor-set-badge',
      nodeId: badge.nodeId,
      x: badge.x,
      y: badge.y,
      numeral: badge.arrayIndex + 1,
      stackIndex: badge.stackIndex,
      badgeSize: item.badgeEntries?.find(entry => entry.roleIndex === item.set.roles.find(role => role.role === badge.role)?.roleIndex
        && entry.arrayIndex === badge.arrayIndex)?.badgeSize ?? item.badgeSize,
      itemIndex
    }));
    const ownsBadge = (badge: typeof layout.badges[number]): boolean => item.badgeEntries
      ? item.badgeEntries.some(entry => entry.roleIndex === item.set.roles.find(role => role.role === badge.role)?.roleIndex
        && entry.arrayIndex === badge.arrayIndex)
      : item.showBadges;
    const neutralBadge = (badge: typeof layout.badges[number]): BoundFallbackMark | undefined => {
      const matches = primitives.filter((mark): mark is BoundFallbackMark => {
        if (mark.type !== 'fallback-mark' || mark.nodeId !== badge.nodeId || mark.role !== badge.role
          || options.isItemRevealed && !options.isItemRevealed(mark.itemIndex)) return false;
        return planItemRelationRefs(frame.items[mark.itemIndex]).some(owner =>
          owner.stageIndex === item.relationRef.stageIndex && owner.relationIndex === item.relationRef.relationIndex);
      });
      return matches.length === 1 ? matches[0] : undefined;
    };
    // A neutral remainder may include supported participants as context.
    // Its exact same-role numeral already organizes that entry at this moment.
    const neutralBadges = layout.badges.map(neutralBadge);
    primitives.push(...badges.filter((_badge, index) => ownsBadge(layout.badges[index]) && !neutralBadges[index]));
    layout.rails.forEach((rail) => {
      const anchors = layout.badges.flatMap<BoundFallbackMark | BoundAnchorSetBadge>((badge, index) => {
        if (badge.role !== rail.role) return [];
        if (neutralBadges[index]) return [neutralBadges[index]];
        return ownsBadge(badge) ? [badges[index]] : [];
      });
      if (anchors.length < 2) return;
      primitives.push({
        type: 'anchor-set-rail',
        x1: Math.min(...anchors.map(anchor => anchor.x)),
        x2: Math.max(...anchors.map(anchor => anchor.x)),
        lane: rail.lane,
        y: 0,
        anchors,
        itemIndex
      });
    });
    return;
  }
} satisfies Partial<GeometryBinders>;
