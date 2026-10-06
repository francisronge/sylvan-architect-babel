import type { Point } from './workspaceLifetimeContours.ts';

export type WorkspaceGapControl = { incarnation: number; split: number; side: 'left' | 'right' | 'both' };
export type WorkspaceGapRequest = WorkspaceGapControl & { increase: number; realizedGap?: number };
export type WorkspaceClearanceObstruction = WorkspaceGapControl & { nodeId: string };
export type WorkspaceClearanceWitness = {
  preference: WorkspaceGapRequest;
  obstructions: readonly WorkspaceClearanceObstruction[];
};
type Preferences = ReadonlyMap<number, ReadonlyMap<string, Point>>;
type Fork = { children: readonly { id: string }[] };
type ObstructionFork = {
  id: string; serial: number; first: number; last: number;
  children: readonly ObstructionFork[]; fixedSlots?: ReadonlyMap<number, Point>;
};
export type WorkspacePairBudget = { remaining: number; evaluations: number };
export const WORKSPACE_PAIRED_EVALUATION_LIMIT = 16;
const EPSILON = 1e-6;
const sameControl = (a: Pick<WorkspaceGapControl, 'incarnation' | 'split'>, b: Pick<WorkspaceGapControl, 'incarnation' | 'split'>) =>
  a.incarnation === b.incarnation && a.split === b.split;

/** Trace an actual rejected ink owner to its nearest free transient fork. A
 * neighboring fork, stable incarnation, or locked contacting side cannot help. */
export function workspaceClearanceObstructions(
  children: readonly ObstructionFork[], priorFirst: number, finalFrame: number,
  contacts: readonly { childIndex: number; nodeId: string }[],
): WorkspaceClearanceObstruction[] {
  const controls: WorkspaceClearanceObstruction[] = [];
  const pathTo = (item: ObstructionFork, id: string): ObstructionFork[] | undefined => {
    if (item.id === id) return [item];
    for (const child of item.children) { const path = pathTo(child, id); if (path) return [item, ...path]; }
    return undefined;
  };
  for (const contact of contacts.slice(0, 2)) {
    const child = children[contact.childIndex], path = child && pathTo(child, contact.nodeId);
    if (!path) continue;
    for (let index = path.length - 1; index >= 0; index--) {
      const fork = path[index], next = path[index + 1], childIndex = next ? fork.children.indexOf(next) : -1;
      if (fork.first <= priorFirst || fork.last >= finalFrame || fork.children.length < 2 || !fork.fixedSlots) continue;
      const fixed = [...fork.fixedSlots.keys()];
      let found = false;
      for (let split = 1; split < fork.children.length; split++) {
        const leftFree = fixed.every(i => i >= split), rightFree = fixed.every(i => i < split);
        // Its own category follows recentering only when one child side stays
        // fixed. Symmetric free movement does not move the fork's own origin.
        const controlsInk = next ? (childIndex < split ? leftFree : rightFree) : leftFree !== rightFree;
        if (!controlsInk) continue;
        controls.push({ incarnation: fork.serial, split, side: leftFree && rightFree ? 'both' : leftFree ? 'left' : 'right', nodeId: contact.nodeId });
        found = true; break;
      }
      if (found) break;
    }
  }
  return controls;
}

function preferenceGap(preferences: Preferences, control: WorkspaceGapControl, forks: ReadonlyMap<number, Fork>): number {
  const children = forks.get(control.incarnation)?.children, points = preferences.get(control.incarnation);
  const left = children?.[control.split - 1], right = children?.[control.split];
  return left && right ? (points?.get(right.id)?.x ?? NaN) - (points?.get(left.id)?.x ?? NaN) : NaN;
}
function shift(preferences: Preferences, control: WorkspaceGapControl, increase: number, forks: ReadonlyMap<number, Fork>): Preferences | undefined {
  const fork = forks.get(control.incarnation), original = preferences.get(control.incarnation);
  if (!fork || !original || !Number.isFinite(increase) || control.split < 1 || control.split >= fork.children.length) return undefined;
  const points = new Map(original);
  for (const [index, child] of fork.children.entries()) {
    const point = original.get(child.id);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
    const scale = control.side === 'both' ? (index < control.split ? -.5 : .5)
      : control.side === 'left' ? (index < control.split ? -1 : 0) : (index < control.split ? 0 : 1);
    points.set(child.id, { x: point.x + scale * increase, y: point.y });
  }
  if (fork.children.some((child, index) => index > 0 && points.get(child.id)!.x <= points.get(fork.children[index - 1].id)!.x)) return undefined;
  return new Map(preferences).set(control.incarnation, points);
}

/** A rejected earlier contraction identifies the later ink that needs its room.
 * Move only that ink's free transient fork together with the contraction. No
 * intermediate state is accepted, and one measured repair may restore part of
 * the earlier room. The caller retains all score, geometry and placement gates. */
export function pairedWorkspaceClearance<T>(input: {
  attempted: Pick<WorkspaceGapControl, 'incarnation' | 'split'>;
  accepted: Preferences;
  rejected: Preferences;
  witness: WorkspaceClearanceWitness;
  forks: ReadonlyMap<number, Fork>;
  currentGap: (control: WorkspaceGapControl) => number | undefined;
  evaluate: (preferences: Preferences) => { value?: T; clearance?: WorkspaceClearanceWitness };
  budget: WorkspacePairBudget;
}): Array<{ preferences: Preferences; candidate: T }> {
  const { witness, forks, budget } = input, reservation = witness.preference;
  const acceptedGap = preferenceGap(input.accepted, reservation, forks), rejectedGap = preferenceGap(input.rejected, reservation, forks);
  if (!sameControl(input.attempted, reservation) || !(reservation.increase > 0)
    || !Number.isFinite(acceptedGap) || !(rejectedGap < acceptedGap - EPSILON)) return [];
  const results: Array<{ preferences: Preferences; candidate: T }> = [], seen = new Set<string>();
  const attempt = (preferences: Preferences) => {
    if (budget.remaining <= 0) return undefined;
    budget.remaining--; budget.evaluations++;
    return input.evaluate(preferences);
  };
  for (const obstruction of witness.obstructions.slice(0, 2)) {
    const key = `${obstruction.incarnation}:${obstruction.split}:${obstruction.side}`;
    if (seen.has(key) || sameControl(obstruction, reservation)) continue;
    seen.add(key);
    const current = input.currentGap(obstruction);
    if (current === undefined || !Number.isFinite(current) || current <= 0) continue;
    for (const factor of [.75, .5]) {
      let preferences = shift(input.rejected, obstruction, current * (factor - 1), forks);
      if (!preferences) continue;
      let result = attempt(preferences);
      const repair = result?.clearance?.preference;
      if (result?.value === undefined && repair && sameControl(repair, reservation) && Number.isFinite(repair.increase) && repair.increase > 0) {
        const storedGap = preferenceGap(preferences, repair, forks);
        // This deficit belongs to the composed fork, which may already be wider
        // than its preference because child ink forced additional separation.
        const increase = repair.realizedGap === undefined ? repair.increase
          : Number.isFinite(repair.realizedGap) && repair.realizedGap > 0
            ? repair.realizedGap + repair.increase - storedGap : NaN;
        const repaired = Number.isFinite(increase) && increase > 0 ? shift(preferences, repair, increase, forks) : undefined;
        // A full undo provides no paired improvement and must not spend a retry.
        if (repaired && preferenceGap(repaired, reservation, forks) < acceptedGap - EPSILON) {
          preferences = repaired;
          result = attempt(preferences);
        }
      }
      if (result?.value !== undefined) results.push({ preferences, candidate: result.value });
      if (budget.remaining <= 0) return results;
    }
  }
  return results;
}
