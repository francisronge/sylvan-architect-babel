import type { Point } from './workspaceLifetimeContours.ts';
import type { WorkspaceGapRequest } from './workspacePairedClearance.ts';

type Preferences = ReadonlyMap<number, ReadonlyMap<string, Point>>;
type Fork = { incarnation: number; children: readonly { id: string }[] };
export const WORKSPACE_INITIAL_CLEARANCE_CORRECTIONS = 8;
export const WORKSPACE_SEED_CLEARANCE_CORRECTIONS = 4;

/** Apply only the earlier free fork named by a measured clearance failure.
 * The caller obtains this request from WorkspaceContourClearanceError; changing
 * the preference grants no ownership and must be followed by full evaluation. */
export function correctWorkspaceClearancePreference(
  preferences: Preferences, forks: ReadonlyMap<number, Fork>, request: WorkspaceGapRequest,
): Preferences | undefined {
  const fork = forks.get(request.incarnation), original = preferences.get(request.incarnation);
  if (!fork || fork.incarnation !== request.incarnation || !original
    || !Number.isInteger(request.split) || request.split <= 0 || request.split >= fork.children.length
    || !Number.isFinite(request.increase) || request.increase <= 0
    || !['left', 'right', 'both'].includes(request.side)) return undefined;
  const left = original.get(fork.children[request.split - 1].id), right = original.get(fork.children[request.split].id);
  const preferredGap = left && right ? right.x - left.x : NaN;
  if (!Number.isFinite(preferredGap) || preferredGap <= 0
    || (request.realizedGap !== undefined && (!Number.isFinite(request.realizedGap) || request.realizedGap <= 0))) return undefined;
  // Target the measured gap plus its missing room in one correction. Adding
  // that room to a smaller preference can repeat without changing the contour.
  const increase = request.realizedGap === undefined ? request.increase : request.realizedGap + request.increase - preferredGap;
  if (!Number.isFinite(increase) || increase <= 0) return undefined;
  const points = new Map([...original].map(([id, point]) => [id, { ...point }]));
  let changed = false;
  for (const [index, child] of fork.children.entries()) {
    const point = points.get(child.id);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
    const scale = request.side === 'both' ? (index < request.split ? -.5 : .5)
      : request.side === 'left' ? (index < request.split ? -1 : 0) : (index < request.split ? 0 : 1);
    const x = point.x + scale * increase;
    if (!Number.isFinite(x)) return undefined;
    changed ||= !Object.is(x, point.x);
    point.x = x;
  }
  return changed ? new Map(preferences).set(request.incarnation, points) : undefined;
}

/** Recompose after each exact request, within one caller-selected small budget.
 * Score, pose or other failures have no clearance request and stop immediately. */
export function evaluateWorkspaceClearance<T>(
  initial: Preferences,
  forks: ReadonlyMap<number, Fork>,
  correctionLimit: typeof WORKSPACE_INITIAL_CLEARANCE_CORRECTIONS | typeof WORKSPACE_SEED_CLEARANCE_CORRECTIONS,
  evaluate: (preferences: Preferences) => { value?: T; clearance?: WorkspaceGapRequest },
): { preferences: Preferences; value?: T; evaluations: number; corrections: number } {
  const budget = correctionLimit === WORKSPACE_INITIAL_CLEARANCE_CORRECTIONS ? WORKSPACE_INITIAL_CLEARANCE_CORRECTIONS
    : correctionLimit === WORKSPACE_SEED_CLEARANCE_CORRECTIONS ? WORKSPACE_SEED_CLEARANCE_CORRECTIONS : 0;
  let preferences = initial, result = evaluate(preferences), evaluations = 1, corrections = 0;
  while (result.value === undefined && result.clearance && corrections < budget) {
    const next = correctWorkspaceClearancePreference(preferences, forks, result.clearance);
    if (!next) break;
    preferences = next; corrections++; evaluations++;
    result = evaluate(preferences);
  }
  return { preferences, value: result.value, evaluations, corrections };
}
