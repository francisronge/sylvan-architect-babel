import type { SyntaxNode } from '../../types.ts';
import type { RelationStage } from '../relationStages.ts';
import { railEntrySequence, type LargeAnchorSet } from './largeAnchorSets.ts';
import type { PlaybackStep } from '../types.ts';
import { isPlanItemRevealed, type AnchorSetPlanItem, type RelationRenderPlan } from './renderPlan.ts';

/** One large-array organization, however many owners materialize it: the
 * renderer merges these items into one rail per role. */
const railKey = (item: AnchorSetPlanItem): string =>
  JSON.stringify([item.set.stageIndex, item.set.relationIndex, item.set.instanceIndex]);

/** A rail's entries across the items that materialize it. */
const railEntries = (items: readonly AnchorSetPlanItem[]): string => {
  const roles = new Map<number, LargeAnchorSet['roles'][number]>();
  for (const item of items) for (const role of item.set.roles) {
    const known = roles.get(role.roleIndex);
    const anchors = [...known?.anchors ?? [], ...role.anchors.filter(anchor =>
      !known?.anchors.some(other => other.arrayIndex === anchor.arrayIndex && other.nodeId === anchor.nodeId))];
    roles.set(role.roleIndex, { ...role, large: role.large || Boolean(known?.large), anchors });
  }
  return railEntrySequence([...roles.values()]);
};

/** Each node's span of terminal positions, in forest order. A badge sits at its
 * node's centre, which lies within that span, so rails whose spans are disjoint
 * never meet on screen. */
const terminalSpans = (forest: readonly SyntaxNode[]): Map<string, [number, number]> => {
  const spans = new Map<string, [number, number]>();
  let next = 0;
  const visit = (node: SyntaxNode): [number, number] => {
    const children = node.children ?? [];
    const span: [number, number] = children.length
      ? children.map(visit).reduce(([lo, hi], [childLo, childHi]) => [Math.min(lo, childLo), Math.max(hi, childHi)])
      : [next, next++];
    if (node.id !== undefined && node.id !== null) spans.set(String(node.id), span);
    return span;
  };
  forest.forEach(visit);
  return spans;
};

/** Lanes and badge stack slots one rail can use: one per large role, or more
 * when one node carries several of its entries. */
const bandWidth = (items: readonly AnchorSetPlanItem[]): number => {
  const roles = new Set<number>(), entries = new Map<string, Set<string>>();
  for (const item of items) for (const role of item.set.roles) {
    if (!role.large) continue;
    roles.add(role.roleIndex);
    for (const anchor of role.anchors) {
      const atNode = entries.get(anchor.nodeId) ?? new Set<string>();
      atNode.add(`${role.roleIndex}:${anchor.arrayIndex}`);
      entries.set(anchor.nodeId, atNode);
    }
  }
  return Math.max(1, roles.size, ...[...entries.values()].map(atNode => atNode.size));
};

/**
 * Plays the large-array rails through the Replay once, recognized and neutral
 * alike, and gives each rail a band of lanes and badge stack slots
 * (`railBand`) that it keeps for its whole life.
 *
 * Each stage is played as its stage entry, then each relation moment in the
 * order Replay plays them (`momentOrders`, authored order for a stage it does
 * not list), then the completed stage. Two rails conflict when some such
 * step shows both and their entries' terminal spans overlap, unless they
 * number the same entry sequence (`railEntrySequence`): such restatements
 * draw one rail and share one band. In order of first appearance, a rail takes
 * the lowest band that no conflicting rail already holds, so a lone rail keeps
 * band 0 and paints as before, a later rail never moves an earlier one, and
 * different rails shown together never share a lane or a badge position.
 * A rail that replaces another with a different sequence appears at its own
 * moment and may take the band its predecessor leaves. Each rail also records
 * its rank in that order of first appearance (`railAppearance`).
 */
export const assignAnchorRailBands = (
  frames: RelationRenderPlan['frames'],
  stages: readonly RelationStage[],
  momentOrders?: ReadonlyMap<number, readonly number[]>
): void => {
  const itemsByRail = new Map<string, AnchorSetPlanItem[]>();
  const order = new Set<string>();
  const conflicts = new Map<string, Set<string>>();
  const conflict = (left: string, right: string) => {
    conflicts.set(left, (conflicts.get(left) ?? new Set()).add(right));
    conflicts.set(right, (conflicts.get(right) ?? new Set()).add(left));
  };
  frames.forEach((frame, frameIndex) => {
    const rails = frame.items.filter((item): item is AnchorSetPlanItem => item.kind === 'anchor-set');
    if (!rails.length) return;
    rails.forEach(item => {
      const key = railKey(item);
      itemsByRail.set(key, [...itemsByRail.get(key) ?? [], item]);
    });
    const spans = terminalSpans(stages[frameIndex]?.workspaceForest ?? []);
    const moments = momentOrders?.get(frameIndex)
      ?? Array.from({ length: stages[frameIndex]?.relations.length ?? 0 }, (_unused, index) => index);
    const steps: Array<[ReadonlySet<number> | null, number | null]> = [[new Set(), null],
      ...moments.map((relationIndex, position): [ReadonlySet<number>, number] => [new Set(moments.slice(0, position + 1)), relationIndex]),
      [null, null]];
    for (const [played, active] of steps) {
      const shown = new Map<string, [number, number]>();
      rails.forEach(item => {
        if (!isPlanItemRevealed(item, frameIndex, played, active)) return;
        const key = railKey(item);
        order.add(key);
        let span = shown.get(key) ?? [Infinity, -Infinity];
        for (const role of item.set.roles) {
          if (!role.large) continue;
          for (const anchor of role.anchors) {
            const at = spans.get(anchor.nodeId);
            if (at) span = [Math.min(span[0], at[0]), Math.max(span[1], at[1])];
          }
        }
        shown.set(key, span);
      });
      const shownRails = [...shown];
      shownRails.forEach(([left, [leftLo, leftHi]], index) => shownRails.slice(index + 1)
        .forEach(([right, [rightLo, rightHi]]) => {
          if (leftLo <= rightHi && rightLo <= leftHi) conflict(left, right);
        }));
    }
  });
  [...order].forEach((key, rank) => itemsByRail.get(key)!.forEach(item => { item.railAppearance = rank; }));
  // Rails numbering one entry sequence hold one band, from the first of them
  // to appear, and never conflict with each other.
  const groupOf = new Map([...itemsByRail].map(([key, items]) => [key, railEntries(items)]));
  const groupItems = new Map<string, AnchorSetPlanItem[]>();
  const groupConflicts = new Map<string, Set<string>>();
  for (const key of order) {
    const group = groupOf.get(key)!;
    groupItems.set(group, [...groupItems.get(group) ?? [], ...itemsByRail.get(key)!]);
    const blocked = groupConflicts.get(group) ?? new Set<string>();
    conflicts.get(key)?.forEach(other => { if (groupOf.get(other) !== group) blocked.add(groupOf.get(other)!); });
    groupConflicts.set(group, blocked);
  }
  const bands = new Map<string, [number, number]>();
  for (const [group, items] of groupItems) {
    const width = bandWidth(items);
    const taken = [...groupConflicts.get(group)!].flatMap(other => bands.has(other) ? [bands.get(other)!] : []);
    let start = 0;
    for (;;) {
      const blocking = taken.find(([otherStart, otherWidth]) => start < otherStart + otherWidth && otherStart < start + width);
      if (!blocking) break;
      start = blocking[0] + blocking[1];
    }
    bands.set(group, [start, width]);
    if (start > 0) items.forEach(item => { item.railBand = start; });
  }
};

/** Each of `stageCount` stages' relation indexes in the order the Replay steps
 * play their moments, which `orderRelationMoments` decides (stageScheduling.ts);
 * a stage whose relations get no moment plays none. */
export const relationMomentOrders = (steps: readonly PlaybackStep[], stageCount: number): Map<number, number[]> => {
  const orders = new Map<number, number[]>(Array.from({ length: stageCount }, (_unused, index) => [index, []]));
  for (const step of steps) {
    if (step.replayKind !== 'relation' || !step.replayRelationIdentity) continue;
    const { stageIndex, relationIndex } = step.replayRelationIdentity;
    if (!Number.isInteger(stageIndex) || !Number.isInteger(relationIndex)) continue;
    const order = orders.get(stageIndex) ?? [];
    if (!order.includes(relationIndex)) order.push(relationIndex);
    orders.set(stageIndex, order);
  }
  return orders;
};
