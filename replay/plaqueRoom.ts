import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import { getNodeId } from './displayIdentity.ts';
import type { PlaybackStep } from './types.ts';
import { nearbyPlaqueReach, PLAQUE_GAP, plaqueAnchorPoint, plaqueBranchObstacles, plaqueTreeObstacles,
  plaquesOverlap } from './relations/plaquePlacement.ts';

type Node = d3.HierarchyPointNode<SyntaxNode>;
type Painted = Map<string, Node>;
type Rect = { x: number; y: number; width: number; height: number };
/** A plaque that stands beside its anchor node by proximity, at its size. */
export type PlaqueAnchor = { anchor: string; width: number; height: number; thetaGrid?: boolean };
/** Each stage's proximity plaques (by stage index), and the plaque obstacles
 * of the relation marks one step paints over a frame's syntax. */
export type PlaqueRoom = { anchors: ReadonlyMap<number, readonly PlaqueAnchor[]>;
  marks?: (step: PlaybackStep, frame: Painted) => Rect[] };
type Framed = { frame: Painted; step: PlaybackStep };

/** How far, in nearby reaches, the search looks for a plaque's pocket: past
 * the tenth the visual audit's mark-distance allows, so that a plaque already
 * beyond it is not pushed farther. */
const SEARCHED_REACH = 1.5;
/** The room a plaque's pocket keeps from syntax it did not have to keep before,
 * beyond the plaque gap: the plaque layout carries a pocket by its exact
 * place, which this search finds only to within its grid. */
const KEPT_MARGIN = 2 * 12;
/** How much farther, as a fraction of its reach, a plaque's nearest pocket may move. */
const SLACK = 0.02;
/** The spacing of the pocket centres the search tries. */
const POCKET_STEP = 12;

// A frame's plaque obstacles (plaqueTreeObstacles over its painted syntax:
// labels, words, stems and the branches between painted nodes), by x.
const obstacleCache = new WeakMap<Painted, Rect[]>();
function obstaclesOf({ frame, step }: Framed, room: PlaqueRoom, measureCategoryText?: CategoryTextMeasure) {
  let result = obstacleCache.get(frame);
  if (!result) {
    result = [...room.marks?.(step, frame) ?? []];
    for (const node of frame.values()) {
      result.push(...plaqueTreeObstacles([node], measureCategoryText));
      const parent = node.parent;
      if (parent && frame.get(getNodeId(parent)) === parent) result.push(...plaqueBranchObstacles(parent, node));
    }
    result.sort((a, b) => a.x - b.x);
    obstacleCache.set(frame, result);
  }
  return result;
}

// Pocket centre offsets within a distance on the search grid, nearest first.
const offsetCache = new Map<string, { i: number; j: number; distance: number }[]>();
function pocketOffsets(within: number) {
  const key = within.toFixed(3);
  let offsets = offsetCache.get(key);
  if (!offsets) {
    offsets = [];
    const steps = Math.ceil(within / POCKET_STEP);
    for (let i = -steps; i <= steps; i++) for (let j = -steps; j <= steps; j++) {
      const distance = Math.hypot(i * POCKET_STEP, j * POCKET_STEP);
      if (distance <= within) offsets.push({ i, j, distance });
    }
    offsets.sort((a, b) => a.distance - b.distance);
    offsetCache.set(key, offsets);
  }
  return offsets;
}

/** The nearest pocket centre, on the search grid within `within` of the anchor
 * (the origin) and no farther than `limit`, at which a `width` by `height` plaque meets no blocker
 * (plaquesOverlap at the plaque gap): each blocker rules out the centres of the
 * rectangle around it that a pocket there would overlap. */
function nearestClearPocket(blockers: readonly Rect[], width: number, height: number, within: number, limit = within) {
  const steps = Math.ceil(within / POCKET_STEP), side = 2 * steps + 1;
  const blocked = new Uint8Array(side * side);
  const exact: Rect[] = [];
  for (const blocker of blockers) {
    const extra = blocker as Rect & { curve?: unknown; extendsDownward?: boolean };
    if (extra.curve || extra.extendsDownward) { exact.push(blocker); continue; }
    // Centres strictly inside (low, high) on each axis overlap the blocker.
    const lowX = blocker.x - PLAQUE_GAP - width / 2, highX = blocker.x + blocker.width + PLAQUE_GAP + width / 2;
    const lowY = blocker.y - PLAQUE_GAP - height / 2, highY = blocker.y + blocker.height + PLAQUE_GAP + height / 2;
    const i0 = Math.max(-steps, Math.floor(lowX / POCKET_STEP) + 1), i1 = Math.min(steps, Math.ceil(highX / POCKET_STEP) - 1);
    const j0 = Math.max(-steps, Math.floor(lowY / POCKET_STEP) + 1), j1 = Math.min(steps, Math.ceil(highY / POCKET_STEP) - 1);
    for (let j = j0; j <= j1; j++) blocked.fill(1, (j + steps) * side + i0 + steps, (j + steps) * side + i1 + steps + 1);
  }
  for (const { i, j, distance } of pocketOffsets(within)) {
    if (distance > limit) break;
    if (blocked[(j + steps) * side + i + steps]) continue;
    const pocket = { x: i * POCKET_STEP - width / 2, y: j * POCKET_STEP - height / 2, width, height };
    if (exact.some(blocker => plaquesOverlap(pocket, blocker, PLAQUE_GAP))) continue;
    return { pocket, distance };
  }
  return undefined;
}

/** Where a run of frames lets each proximity plaque stand, as the plaque layout
 * gives a plaque one pocket beside its anchor for its lifetime: in order, each
 * plaque takes the nearest pocket clear, relative to its anchor, in every frame
 * of the run that paints the anchor, of the syntax and marks and of the pockets
 * taken before it. For each plaque (undefined where no frame paints its
 * anchor): its distance as a fraction of its nearby reach (Infinity with no
 * pocket within SEARCHED_REACH, or none nearer than its `bounds`), the pocket
 * relative to the anchor, the syntax and marks within KEPT_MARGIN of it, and
 * whether its `keep` pocket meets nothing within that margin it did not meet. */
function plaquePockets(window: readonly Framed[], plaques: readonly PlaqueAnchor[], room: PlaqueRoom, measureCategoryText?: CategoryTextMeasure,
  keep: readonly ({ pocket?: Rect; near: readonly Rect[] } | undefined)[] = [], bounds: readonly number[] = []) {
  // Frames that paint the same syntax at the same relative places, with the
  // same relations, block alike.
  const frames: Framed[] = [], seen = new Set<string>();
  for (const framed of window) {
    const origin = framed.frame.values().next().value;
    const key = (framed.step.replayRelationLinks ?? []).map(link => link.authoredRelationKey).join(',') + '|'
      + (origin ? [...framed.frame].map(([id, node]) => `${id}@${Math.round((node.x - origin.x) * 2)},${Math.round((node.y - origin.y) * 2)}`).join(' ') : '');
    if (!seen.has(key)) { seen.add(key); frames.push(framed); }
  }
  const taken = new Map<Framed, Rect[]>(frames.map(framed => [framed, []]));
  return plaques.map((plaque, index) => {
    const reach = nearbyPlaqueReach(plaque), within = reach * SEARCHED_REACH;
    const extentX = within + plaque.width / 2 + PLAQUE_GAP, extentY = within + plaque.height / 2 + PLAQUE_GAP;
    const blockers: Rect[] = [], others: Rect[] = [], points: [Framed, { x: number; y: number }][] = [];
    for (const framed of frames) {
      const node = framed.frame.get(plaque.anchor);
      if (!node) continue;
      const point = plaqueAnchorPoint(node);
      points.push([framed, point]);
      const relative = (into: Rect[]) => (box: Rect) => {
        const x = box.x - point.x, y = box.y - point.y;
        if (x < extentX && x + box.width > -extentX && y < extentY && y + box.height > -extentY) into.push({ ...box, x, y });
      };
      const obstacles = obstaclesOf(framed, room, measureCategoryText);
      // Obstacles are ordered by their left edges; none is wider than a long label.
      let low = 0, high = obstacles.length;
      while (low < high) { const mid = (low + high) >> 1; if (obstacles[mid].x < point.x - extentX - 2000) low = mid + 1; else high = mid; }
      const syntax = relative(blockers);
      for (let index = low; index < obstacles.length && obstacles[index].x < point.x + extentX; index++) syntax(obstacles[index]);
      taken.get(framed)!.forEach(relative(others));
    }
    if (!points.length) return undefined;
    // Whether the pocket it had meets no syntax or mark nearer than a margin
    // beyond the plaque gap that it did not meet before.
    const nearOf = (box: Rect) => blockers.filter(blocker => plaquesOverlap(box, blocker, PLAQUE_GAP + KEPT_MARGIN));
    const prior = keep[index];
    const same = (a: Rect, b: Rect) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
      && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
    const kept = !prior?.pocket || nearOf(prior.pocket).every(blocker => prior.near.some(old => same(old, blocker)));
    // A search that only needs to find one nearer than `bounds` gives up there.
    const found = nearestClearPocket([...blockers, ...others], plaque.width, plaque.height, within, (bounds[index] ?? Infinity) * reach);
    if (!found) return { ratio: Infinity, pocket: undefined, kept, near: [] };
    const { pocket, distance } = found;
    for (const [framed, point] of points) taken.get(framed)!.push({ ...pocket, x: pocket.x + point.x, y: pocket.y + point.y });
    return { ratio: distance / reach, pocket, kept, near: nearOf(pocket) };
  });
}

// The unchanged frames' pockets, by the frames of the run: a closing tried
// again at the same movement judges against the same earlier frames.
const frameIds = new WeakMap<Painted, number>();
let nextFrameId = 0;
const pocketCache = new WeakMap<PlaqueRoom, Map<string, ReturnType<typeof plaquePockets>>>();
function cachedPockets(window: readonly Framed[], plaques: readonly PlaqueAnchor[], room: PlaqueRoom, measureCategoryText?: CategoryTextMeasure) {
  const id = (frame: Painted) => { let known = frameIds.get(frame); if (known === undefined) frameIds.set(frame, known = nextFrameId++); return known; };
  let cache = pocketCache.get(room);
  if (!cache) pocketCache.set(room, cache = new Map());
  const key = `${window.map(framed => id(framed.frame)).join(',')}|${JSON.stringify(plaques)}`;
  let result = cache.get(key);
  if (!result) cache.set(key, result = plaquePockets(window, plaques, room, measureCategoryText));
  return result;
}

/** Whether frames `after` (changed from `before` from index `first` on) keep
 * every proximity plaque as near its anchor as it could stand. In each stage
 * the change reaches, over its frames from the change on (with, and without,
 * the frame before the change), each plaque of the stage still finds a pocket
 * no farther than before, and the pocket it had meets no syntax or mark it did
 * not meet before: the plaque layout keeps a pocket while it stays clear, and
 * when it must search again it may not find the one this search finds.
 * Used by closeMovementGaps, which does not see plaques, so that the room a
 * closing takes is never a plaque's. */
export function keepsPlaqueRoom(steps: readonly PlaybackStep[], before: readonly Painted[], after: readonly Painted[],
  first: number, room: PlaqueRoom, measureCategoryText?: CategoryTextMeasure) {
  if (!room.anchors.size) return true;
  const runs = new Map<number, number[]>();
  for (let index = Math.max(0, first - 1); index < after.length; index++) {
    const stage = steps[index].replayFrameIndex!;
    runs.set(stage, [...(runs.get(stage) ?? []), index]);
  }
  for (const [stage, indices] of runs) {
    const own = room.anchors.get(stage);
    if (!own?.length || !indices.some(index => index >= first && before[index] !== after[index]
      && own.some(plaque => surroundingsMoved(before[index], after[index], plaque)))) continue;
    // A plaque's lifetime may begin with the change (its participants move) or
    // run through it from before.
    const later = indices.filter(index => index >= first);
    for (const window of later.length < indices.length ? [indices, later] : [indices]) {
      const was = cachedPockets(window.map(index => ({ frame: before[index], step: steps[index] })), own, room, measureCategoryText);
      const now = plaquePockets(window.map(index => ({ frame: after[index], step: steps[index] })), own, room, measureCategoryText,
        was, was.map(entry => (entry?.ratio ?? 0) + SLACK));
      if (now.some((entry, index) => entry && (!entry.kept || entry.ratio > (was[index]?.ratio ?? 0) + SLACK))) return false;
    }
  }
  return true;
}

/** Whether any syntax near a plaque's anchor stands elsewhere relative to it in `after`. */
function surroundingsMoved(before: Painted, after: Painted, plaque: PlaqueAnchor) {
  const old = before.get(plaque.anchor), node = after.get(plaque.anchor);
  if (!old || !node) return Boolean(old) !== Boolean(node);
  // As far as a pocket reaches, a long label beyond it, and other plaques' pockets.
  const reach = 2 * (nearbyPlaqueReach(plaque) * SEARCHED_REACH + Math.max(plaque.width, plaque.height)) + 1200;
  const dx = node.x - old.x, dy = node.y - old.y;
  for (const [id, other] of after) {
    const prior = before.get(id);
    if (Math.abs(other.x - node.x) > reach && (!prior || Math.abs(prior.x - old.x) > reach)) continue;
    if (!prior || Math.abs(other.x - prior.x - dx) > 0.5 || Math.abs(other.y - prior.y - dy) > 0.5) return true;
  }
  for (const [id, prior] of before) if (!after.has(id) && Math.abs(prior.x - old.x) <= reach) return true;
  return false;
}
