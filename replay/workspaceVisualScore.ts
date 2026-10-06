import { ROOT_DISPLACEMENT_FRACTION, LOCAL_SPAN_FRACTION } from './workspaceVisualPreference.ts';
import type { ContourFrame, LifetimeContour, Point } from './workspaceLifetimeContours.ts';

const EPSILON = 1e-6;
type RootDeviation = { widthError: number; maxX: number };
export type WorkspaceVisualScore = {
  localDistortions: readonly number[];
  rootDisplacement: number;
  widthDeviation: number;
  squaredDisplacement: number;
  maxX: number;
  roots: ReadonlyMap<string, RootDeviation>;
};
export type WorkspaceVisualSummary = { worstLocal: number | 'unbounded'; rootDisplacement: number;
  widthDeviation: number; maxX: number; squaredDisplacement: number };
const compare = (a: number, b: number) => a < b ? -1 : a > b ? 1 : 0;
// Equivalent composed spans can differ by a few rounding steps. Only the
// preference ranking ignores that noise; all geometry and extent checks remain
// independent, and sorting retains its exact total order.
const comparePreference = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= 32 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) ? 0 : compare(a, b);
const errorProfiles = new WeakMap<WorkspaceVisualScore, readonly number[]>();
const preferenceErrors = (score: WorkspaceVisualScore) => {
  let result = errorProfiles.get(score);
  if (!result) {
    result = [...score.localDistortions.map(value => value / LOCAL_SPAN_FRACTION),
      score.rootDisplacement / ROOT_DISPLACEMENT_FRACTION, score.widthDeviation / LOCAL_SPAN_FRACTION]
      .sort((a, b) => compare(b, a));
    errorProfiles.set(score, result);
  }
  return result;
};

/** Compare the existing visual-preference dimensions on their own scales.
 * Neither local spans nor aggregate X error may dominate by their units alone. */
export function compareWorkspaceVisualScores(a: WorkspaceVisualScore, b: WorkspaceVisualScore): number {
  const left = preferenceErrors(a), right = preferenceErrors(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const order = comparePreference(left[index] ?? 0, right[index] ?? 0);
    if (order) return order;
  }
  return comparePreference(a.squaredDisplacement, b.squaredDisplacement);
}

/** Refinement may not worsen any final root's width deviation or displacement.
 * This cap is the accepted candidate itself, not a relaxed release threshold. */
export function keepsWorkspaceFinalExtent(candidate: WorkspaceVisualScore, accepted: WorkspaceVisualScore): boolean {
  if (candidate.roots.size !== accepted.roots.size) return false;
  return [...candidate.roots].every(([id, value]) => {
    const prior = accepted.roots.get(id);
    return prior && value.widthError <= prior.widthError + EPSILON && value.maxX <= prior.maxX + EPSILON;
  });
}

export function workspaceVisualSummary(score: WorkspaceVisualScore): WorkspaceVisualSummary {
  const worst = score.localDistortions[0] ?? 0;
  return { worstLocal: Number.isFinite(worst) ? worst : 'unbounded', rootDisplacement: score.rootDisplacement,
    widthDeviation: score.widthDeviation, maxX: score.maxX, squaredDisplacement: score.squaredDisplacement };
}

export function workspaceVisualScore(frame: ContourFrame, reference: ReadonlyMap<string, Point>): WorkspaceVisualScore | undefined {
  const localDistortions: number[] = [];
  let rootDisplacement = 0, widthDeviation = 0, squaredDisplacement = 0, maxX = 0;
  const roots = new Map<string, RootDeviation>();
  const spanChange = (before: number, after: number) => Math.abs(after - before) <= EPSILON ? 0
    : Math.abs(before) <= EPSILON ? Infinity : Math.abs((after - before) / before);
  for (const root of frame.roots) {
    const oldRoot = reference.get(root.id);
    if (!oldRoot || [...root.members].some(([id, point]) => {
      const old = reference.get(id);
      return !old || ![old.x, old.y, point.x, point.y].every(Number.isFinite);
    })) return undefined;
    const oldXs = [...root.members.keys()].map(id => reference.get(id)!.x);
    const width = Math.max(...oldXs) - Math.min(...oldXs);
    let rootMax = 0;
    for (const [id, point] of root.members) {
      const raw = point.x - (reference.get(id)!.x - oldRoot.x), delta = Math.abs(raw) <= EPSILON ? 0 : raw;
      squaredDisplacement += delta * delta;
      rootMax = Math.max(rootMax, Math.abs(delta));
    }
    const currentXs = [...root.members.values()].map(point => point.x);
    const currentWidth = Math.max(...currentXs) - Math.min(...currentXs), rawWidthError = Math.abs(currentWidth - width);
    const widthError = rawWidthError <= EPSILON ? 0 : rawWidthError;
    roots.set(root.id, { widthError, maxX: rootMax });
    widthDeviation = Math.max(widthDeviation, width > EPSILON ? widthError / width : widthError <= EPSILON ? 0 : Infinity);
    maxX = Math.max(maxX, rootMax);
    rootDisplacement = Math.max(rootDisplacement, width > EPSILON ? rootMax / width : rootMax <= EPSILON ? 0 : Infinity);
    const visit = (part: LifetimeContour) => {
      const oldParent = reference.get(part.id)!, currentParent = root.members.get(part.id)!;
      for (const [index, child] of part.children.entries()) {
        const old = reference.get(child.id)!, current = root.members.get(child.id)!;
        localDistortions.push(spanChange(old.x - oldParent.x, current.x - currentParent.x));
        if (index) {
          const prior = part.children[index - 1];
          localDistortions.push(spanChange(old.x - reference.get(prior.id)!.x, current.x - root.members.get(prior.id)!.x));
        }
        visit(child);
      }
    };
    visit(root);
  }
  localDistortions.sort((a, b) => compare(b, a));
  return { localDistortions, rootDisplacement, widthDeviation, squaredDisplacement, maxX, roots };
}

/** Try the exact reference without increasing the three-proposal search budget. */
export function workspaceGapProposals(current: number, reference: number): number[] {
  const result: number[] = [];
  for (const value of [reference, current * .75, current * 1.5, current * .25]) {
    if (Number.isFinite(value) && value > 0 && Math.abs(value - current) > EPSILON
      && !result.some(prior => Math.abs(prior - value) <= EPSILON)) result.push(value);
  }
  return result.slice(0, 3);
}

/** Change a realized gap by translating the stored slots on its two sides.
 * Composed child contours can offset a preference, so assigning the desired
 * realized gap directly to the stored preference would apply that offset twice. */
export function adjustWorkspaceGapPreference(
  preference: ReadonlyMap<string, Point>, childIds: readonly string[], split: number,
  current: number, wanted: number,
): Map<string, Point> | undefined {
  if (split <= 0 || split >= childIds.length || !Number.isInteger(split)
    || ![current, wanted].every(value => Number.isFinite(value) && value > 0)
    || childIds.some(id => !preference.has(id))) return undefined;
  const delta = wanted - current;
  const left = preference.get(childIds[split - 1])!, right = preference.get(childIds[split])!;
  if (!Number.isFinite(right.x - left.x + delta) || right.x - left.x + delta <= 0) return undefined;
  const result = new Map([...preference].map(([id, point]) => [id, { ...point }]));
  childIds.forEach((id, index) => result.get(id)!.x += index < split ? -delta / 2 : delta / 2);
  return result;
}

/** Use the composed final gap when this fork still exists there. Earlier-only
 * forks use their composed last occurrence and corresponding saved reference. */
export function workspaceRealizedGap(
  part: LifetimeContour, index: number, frames: readonly ContourFrame[],
  finalReference: ReadonlyMap<string, Point>, lifetimeReference: ReadonlyMap<string, Point>,
): { current: number; reference: number } | undefined {
  const final = frames.at(-1)?.nodes.get(part.id);
  const finalFork = final && final.children.length === part.children.length
    && final.children.every((child, i) => child.id === part.children[i].id);
  const current = finalFork ? final : frames[part.last]?.nodes.get(part.id);
  if (!current || (!finalFork && current.incarnation !== part.incarnation)) return undefined;
  const leftId = part.children[index - 1]?.id, rightId = part.children[index]?.id;
  const left = leftId && current.members.get(leftId), right = rightId && current.members.get(rightId);
  const reference = finalFork ? finalReference : lifetimeReference;
  const oldLeft = leftId && reference.get(leftId), oldRight = rightId && reference.get(rightId);
  if (!left || !right || !oldLeft || !oldRight) return undefined;
  const gap = right.x - left.x, previousGap = oldRight.x - oldLeft.x;
  return Number.isFinite(gap) && gap > 0 && Number.isFinite(previousGap) && previousGap > 0
    ? { current: gap, reference: previousGap } : undefined;
}

export function workspaceFinalWidth(coordinates: ReadonlyMap<string, Point>): number {
  const xs = [...coordinates.values()].map(point => point.x);
  return xs.length && xs.every(Number.isFinite) ? Math.max(...xs) - Math.min(...xs) : NaN;
}

/** Covers separation between final roots as well as each root's own contour. */
export function keepsWorkspaceFinalWidth(candidate: number, accepted: number, reference: number): boolean {
  return [candidate, accepted, reference].every(value => Number.isFinite(value) && value >= 0)
    && Math.abs(candidate - reference) <= Math.abs(accepted - reference) + EPSILON;
}
