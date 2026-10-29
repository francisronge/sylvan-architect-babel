import type { PlaybackStep } from '../types.ts';
import { isPlanItemRevealed, type RelationPlanItem, type RelationRenderPlan } from './renderPlan.ts';

type ScopeItem = Extract<RelationPlanItem, { kind: 'operator-variable-binding' }>;

/** How one operator-variable scope domain paints at one Replay step. `rank` and
 * `count` set its hull padding and binding lane; `colourSlot` sets only its
 * palette entry. */
export interface ScopeDomainPaint { rank: number; count: number; colourSlot: number }

const isScopeItem = (item: RelationPlanItem): item is ScopeItem =>
  item.kind === 'operator-variable-binding' && Boolean(item.scopeDomainNodeId);

interface ScopeTimeline {
  plan: RelationRenderPlan;
  /** Each step's colour slot per domain node on screen. */
  colours: Array<Map<string, number>>;
  /** Each domain node's hull and lane rank, fixed for the whole Replay. */
  geometry: Map<string, { rank: number; count: number }>;
}

const timelines = new WeakMap<readonly PlaybackStep[], ScopeTimeline>();

/**
 * Plays the scope domains through the Replay once, keyed by domain node, so two
 * items on one domain count as one domain.
 *
 * Colour: a domain takes the lowest slot no domain on screen holds at the step it
 * first appears, in played order, and keeps it while it stays on screen. One
 * domain alone is the base colour; a second colour appears only beside another
 * domain. A later domain never recolours a shown one; the step that retires a
 * domain closes the others up to the lowest slots, so one left alone is the
 * base colour again.
 *
 * Geometry: domains that ever share the screen are ranked together by size, the
 * larger outside (main's order), and each keeps that rank throughout, as space
 * reserved for the domains still to come. A step therefore never moves another
 * domain's hull or lane.
 */
function scopeTimeline(plan: RelationRenderPlan, steps: readonly PlaybackStep[]): ScopeTimeline {
  const cached = timelines.get(steps);
  if (cached?.plan === plan) return cached;
  const colours: Array<Map<string, number>> = [];
  const size = new Map<string, number>(), firstShown: string[] = [];
  const group = new Map<string, string>();
  const groupOf = (domain: string): string => {
    const parent = group.get(domain) ?? domain;
    if (parent === domain) return domain;
    const top = groupOf(parent);
    group.set(domain, top);
    return top;
  };
  // Each stage's moments played so far, as the renderer reveals them.
  const playedByStage = new Map<number, Set<number>>();
  let held = new Map<string, number>();
  for (const step of steps) {
    const identity = step.replayKind === 'relation' ? step.replayRelationIdentity : undefined;
    if (identity) playedByStage.set(identity.stageIndex, (playedByStage.get(identity.stageIndex) ?? new Set()).add(identity.relationIndex));
    const stageIndex = step.replayFrameIndex;
    if (stageIndex === undefined || !Number.isInteger(stageIndex)) { colours.push(held); continue; }
    const played = playedByStage.get(stageIndex) ?? new Set<number>();
    const shown = new Set<string>();
    for (const item of plan.frames[stageIndex]?.items ?? []) {
      if (!isScopeItem(item) || !isPlanItemRevealed(item, stageIndex, played, identity?.relationIndex ?? null)) continue;
      const domain = item.scopeDomainNodeId!;
      shown.add(domain);
      size.set(domain, Math.max(size.get(domain) ?? 0, item.scopeMemberNodeIds?.length || 0));
    }
    const staying = [...held].filter(([domain]) => shown.has(domain));
    // The step that retires a domain owns the one recolouring: the domains that
    // stay close up to the lowest slots, in their order, so one left alone is
    // the base colour again.
    const next = new Map(staying.length < held.size
      ? [...staying].sort((left, right) => left[1] - right[1]).map(([domain], slot) => [domain, slot] as [string, number])
      : staying);
    for (const domain of shown) {
      if (!group.has(domain)) { group.set(domain, domain); firstShown.push(domain); }
      if (next.has(domain)) continue;
      const taken = new Set(next.values());
      let slot = 0;
      while (taken.has(slot)) slot += 1;
      next.set(domain, slot);
    }
    const [first, ...others] = shown;
    for (const domain of others) group.set(groupOf(domain), groupOf(first));
    colours.push(held = next);
  }
  const members = new Map<string, string[]>();
  for (const domain of firstShown) members.set(groupOf(domain), [...members.get(groupOf(domain)) ?? [], domain]);
  const geometry = new Map<string, { rank: number; count: number }>();
  for (const domains of members.values()) {
    [...domains].sort((left, right) => size.get(right)! - size.get(left)! || firstShown.indexOf(left) - firstShown.indexOf(right))
      .forEach((domain, rank) => geometry.set(domain, { rank, count: domains.length }));
  }
  const timeline = { plan, colours, geometry };
  timelines.set(steps, timeline);
  return timeline;
}

/** The paint of every scope item in the stage frame shown at `stepIndex`, by item index. */
export function scopeDomainPaint(plan: RelationRenderPlan, stageIndex: number,
  steps: readonly PlaybackStep[], stepIndex: number): Map<number, ScopeDomainPaint> {
  const { colours, geometry } = scopeTimeline(plan, steps);
  const colour = colours[Math.min(stepIndex, colours.length - 1)];
  const paint = new Map<number, ScopeDomainPaint>();
  (plan.frames[stageIndex]?.items ?? []).forEach((item, itemIndex) => {
    if (!isScopeItem(item)) return;
    const domain = item.scopeDomainNodeId!;
    paint.set(itemIndex, { ...geometry.get(domain) ?? { rank: 0, count: 1 }, colourSlot: colour?.get(domain) ?? 0 });
  });
  return paint;
}
