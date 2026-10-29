import { spaceAuthoredName } from '../displayText.ts';
import { ANCHOR_SET_BADGE_CLEARANCE, anchorSetBadgeOuterRadius } from '../rendererMetrics.ts';
import type { BoundAnchorSetBadge, BoundFallbackMark } from './boundGeometry.ts';
import { FALLBACK_ROLE_STYLE, fallbackLabelRect, placeFallbackMark, routeFallbackSegments } from './fallbackGeometry.ts';
import type { FallbackWordSpan } from './fallbackSpans.ts';
import type { GeometryBinders } from './geometryContext.ts';
import { fongEdgeOutlineRect } from './markGeometry.ts';
import type { Point } from './overlayGeometry.ts';
import { planAnchorSetLayout } from './overlayGeometry.ts';
import { railEntrySequence } from './largeAnchorSets.ts';
import { fallbackPlaqueTextMeasure } from './plaqueTextLayout.ts';
import { planItemRelationRefs } from './renderPlan.ts';

/** Brackets closer than this, in tree units, would read as one; the narrower nests instead. */
const BRACKET_SEPARATION = 28;

export const neutralGeometry = {
  'fallback': (item, itemIndex, context) => {
    const {
      fallbackOccupied,
      positionFor,
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
    const subtreeBottom = (id: string): Point | null => {
      const rect = options.fallbackMeasurements?.subtreeFor(id) ?? rectFor(id);
      return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height } : null;
    };
    // A two-witness link brackets the words its participants cover. Only a
    // caller that measures no words keeps stems below each subtree.
    const link = item.drawing.link;
    const spanFor = options.fallbackMeasurements?.spanFor;
    const linkBottoms = link?.endpoints.map(subtreeBottom);
    const spans = link && spanFor && linkBottoms?.every(Boolean)
      && link.endpoints.every(id => positionFor(id)) && link.endpoints[0] !== link.endpoints[1]
      ? link.endpoints.map(id => spanFor(id)) : null;
    const brackets = spans?.every(Boolean) ? spans as FallbackWordSpan[] : null;
    const measure = options.plaqueTextLayout?.measureText ?? fallbackPlaqueTextMeasure;
    const measuredHeight = (metrics: ReturnType<typeof measure>) => options.plaqueTextLayout?.measureText
      && Number.isFinite(metrics.ascent) && metrics.ascent! >= 0
      && Number.isFinite(metrics.descent) && metrics.descent! >= 0
      && metrics.ascent! + metrics.descent! > 0 ? metrics.ascent! + metrics.descent! : undefined;
    const connectorText = (text: string, nodeId: string, role: string, kind: 'end' | 'relation'): BoundFallbackMark => {
      const metrics = measure(text, FALLBACK_ROLE_STYLE);
      const textHeight = measuredHeight(metrics);
      const at = positionFor(nodeId)!;
      return {
        type: 'fallback-mark', nodeId, x: at.x, y: at.y, role, text, textWidth: metrics.width,
        ...(textHeight === undefined ? {} : { textHeight }),
        labelRect: options.fallbackMeasurements?.labelFor(nodeId) ?? rectFor(nodeId)!,
        connectorLabel: kind, connectorWitnesses: [link!.endpoints[0], link!.endpoints[1]],
        backward: false, numeral: null, frame: 'circle', instance: item.drawing.instance,
        allocationOrder: context.fallbackAllocationOrder++, stackIndex: 0, itemIndex
      };
    };
    item.drawing.marks.forEach((mark) => {
      const point = requirePoint(itemIndex, mark.witness);
      if (!point) return;
      const end = brackets && link ? link.endpoints.indexOf(mark.witness) : -1;
      if (end >= 0 && brackets) {
        // Placed under the routed connector once it is routed (geometryBinding.ts).
        const category = brackets[end].category;
        const text = `${category ? `${category} · ` : ''}${spaceAuthoredName(mark.role, { snakeCase: true })}`;
        const bound = connectorText(text, mark.witness, mark.role, 'end');
        Object.assign(bound, { frame: mark.frame, instance: mark.instance, backward: mark.backward, stackIndex: nextStackIndex(mark.witness) });
        ownedMarks.push(bound);
        primitives.push(bound);
        return;
      }
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
    // Fans join their own marks. Two-witness links bracket the words their
    // participants cover, or without measured words start below their subtrees.
    if (link && brackets) {
      const ends = link.endpoints.map((nodeId, index) => ({ nodeId, runs: brackets[index].runs, tick: brackets[index].tick }));
      // Two silent participants in one gap of the words keep two ticks, in tree order.
      if (ends[0].tick !== null && ends[1].tick !== null && Math.abs(ends[0].tick - ends[1].tick) < BRACKET_SEPARATION) {
        const middle = (ends[0].tick + ends[1].tick) / 2, first = brackets[0].leaves[0] <= brackets[1].leaves[0] ? 0 : 1;
        const side = options.direction === 'rtl' ? 1 : -1;
        ends[first].tick = middle + side * BRACKET_SEPARATION / 2;
        ends[1 - first].tick = middle - side * BRACKET_SEPARATION / 2;
      }
      // A dominated participant's bracket nests inside; so does the narrower of
      // two whose words overlap in x, as words hung at different rows can.
      const [a, b] = brackets.map(span => span.leaves);
      const hulls = ends.map(end => end.tick !== null ? [end.tick, end.tick]
        : [Math.min(...end.runs.map(run => run.x1)), Math.max(...end.runs.map(run => run.x2))]);
      const overlap = hulls[0][0] < hulls[1][1] + BRACKET_SEPARATION && hulls[1][0] < hulls[0][1] + BRACKET_SEPARATION;
      const inner = a[0] <= b[0] && a[1] >= b[1] ? 1 : b[0] <= a[0] && b[1] >= a[1] ? 0
        : overlap ? (hulls[0][1] - hulls[0][0] <= hulls[1][1] - hulls[1][0] ? 0 : 1) : null;
      const relation = String(options.relationNameFor?.(item.relationRef) ?? '').trim();
      if (relation) {
        const bound = connectorText(spaceAuthoredName(relation, { snakeCase: true }), link.endpoints[0], relation, 'relation');
        ownedMarks.push(bound);
        primitives.push(bound);
      }
      pendingSegments.push({
        type: 'segment',
        route: 'counter-lane',
        witnessNodeIds: [...link.endpoints],
        from: linkBottoms![0]!,
        to: linkBottoms![1]!,
        brackets: { ends: [ends[0], ends[1]], inner },
        directed: false,
        itemIndex
      });
    } else if (link) {
      const first = markCenters.has(link.endpoints[0]) ? linkBottoms![0] : null;
      const second = markCenters.has(link.endpoints[1]) ? linkBottoms![1] : null;
      if (first && second) {
        const left = first.x <= second.x ? first : second;
        const right = left === first ? second : first;
        pendingSegments.push({
          type: 'segment',
          route: 'counter-lane',
          witnessNodeIds: [...link.endpoints],
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
    const { rectFor, badgeGap, markerScale, laneGap, policyFailed, failed, primitives, frame, options, anchorSetBadgeBoxes } = context;
    const badgeSizeFor = (role: string, arrayIndex: number) => item.badgeEntries?.find(entry =>
      entry.roleIndex === item.set.roles.find(group => group.role === role)?.roleIndex
      && entry.arrayIndex === arrayIndex)?.badgeSize ?? item.badgeSize;
    const badgeRadius = (role: string, arrayIndex: number) => anchorSetBadgeOuterRadius(badgeSizeFor(role, arrayIndex)) * markerScale;
    const railEntries = railEntrySequence(item.set.roles);
    const layout = planAnchorSetLayout(
      [{
        relation: item.set.relation,
        instanceIndex: item.set.instanceIndex,
        roles: item.set.roles
      }],
      rectFor,
      {
        badgeOffsetY: badgeGap * markerScale,
        railGap: laneGap,
        band: item.railBand,
        ...(options.badgeObstacles ? { clearance: { obstacles: [...options.badgeObstacles, ...anchorSetBadgeBoxes.filter(box => box.railEntries !== railEntries)],
          radiusFor: badgeRadius,
          gap: ANCHOR_SET_BADGE_CLEARANCE * markerScale } } : {})
      }
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
    // Only a revealed rail's badges are on screen: a hidden item, such as a
    // predecessor its restatement supersedes, must not push later badges off.
    if (options.badgeObstacles && (!options.isItemRevealed || options.isItemRevealed(itemIndex))) anchorSetBadgeBoxes.push(...layout.badges.map(badge => {
      const radius = badgeRadius(badge.role, badge.arrayIndex);
      return { x: badge.x - radius, y: badge.y - radius, width: 2 * radius, height: 2 * radius, railEntries };
    }));
    const badges: BoundAnchorSetBadge[] = layout.badges.map((badge) => ({
      type: 'anchor-set-badge',
      nodeId: badge.nodeId,
      x: badge.x,
      y: badge.y,
      numeral: badge.arrayIndex + 1,
      stackIndex: badge.stackIndex,
      badgeSize: badgeSizeFor(badge.role, badge.arrayIndex),
      itemIndex
    }));
    const ownsBadge = (badge: typeof layout.badges[number]): boolean => item.badgeEntries
      ? item.badgeEntries.some(entry => entry.roleIndex === item.set.roles.find(role => role.role === badge.role)?.roleIndex
        && entry.arrayIndex === badge.arrayIndex)
      : item.showBadges;
    const neutralBadge = (badge: typeof layout.badges[number]): BoundFallbackMark | undefined => {
      if (item.ownNumerals) return undefined;
      const matches = primitives.filter((mark): mark is BoundFallbackMark => {
        if (mark.type !== 'fallback-mark' || mark.connectorLabel || mark.nodeId !== badge.nodeId || mark.role !== badge.role
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
