import type { SyntaxNode } from '../../types.ts';
import type { RelationStage } from '../relationStages.ts';
import { isPlanItemRevealed, type AnchorSetPlanItem, type RelationRenderPlan } from './renderPlan.ts';

/** One large-array organization, however many owners materialize it: the
 * renderer merges these items into one rail per role. */
const railKey = (item: AnchorSetPlanItem): string =>
  JSON.stringify([item.set.stageIndex, item.set.relationIndex, item.set.instanceIndex]);

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
 * Each stage is played as its stage entry, then each relation moment in
 * authored order, then the completed stage. Two rails conflict when some such
 * step shows both and their entries' terminal spans overlap. In order of first
 * appearance, a rail takes the lowest band that no conflicting rail already
 * holds, so a lone rail keeps band 0 and paints as before, a later rail never
 * moves an earlier one, and rails shown together never share a lane or a
 * badge position. A rail that replaces another appears at its own moment and
 * may take the band its predecessor leaves.
 */
export const assignAnchorRailBands = (
  frames: RelationRenderPlan['frames'],
  stages: readonly RelationStage[]
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
    const relationCount = stages[frameIndex]?.relations.length ?? 0;
    const steps: Array<[ReadonlySet<number> | null, number | null]> = [[new Set(), null]];
    for (let relationIndex = 0; relationIndex < relationCount; relationIndex++) {
      steps.push([new Set(Array.from({ length: relationIndex + 1 }, (_unused, index) => index)), relationIndex]);
    }
    steps.push([null, null]);
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
  const bands = new Map<string, [number, number]>();
  for (const key of order) {
    const width = bandWidth(itemsByRail.get(key)!);
    const taken = [...conflicts.get(key) ?? []].flatMap(other => bands.has(other) ? [bands.get(other)!] : []);
    let start = 0;
    for (;;) {
      const blocking = taken.find(([otherStart, otherWidth]) => start < otherStart + otherWidth && otherStart < start + width);
      if (!blocking) break;
      start = blocking[0] + blocking[1];
    }
    bands.set(key, [start, width]);
    if (start > 0) itemsByRail.get(key)!.forEach(item => { item.railBand = start; });
  }
};
