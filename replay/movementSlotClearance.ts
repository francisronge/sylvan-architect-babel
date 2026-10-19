import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { carriedShift } from './cameraCarry.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import { currentWorkspaceMovements } from './currentWorkspaceMovements.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { cubicIntersectsRect, type Cubic } from './relations/curveClearance.ts';
import type { PlaqueRect } from './relations/plaquePlacement.ts';
import { siblingContoursOrdered } from './siblingContours.ts';
import { prepareTreeInkSubtrees, type TreeInkTextMeasure } from './treeInkGeometry.ts';
import type { PreparedTreeLabelRuns, TreeLabelMeasure } from './treeLabelRuns.ts';
import { layoutSyntaxTree, type TreeCoordinateReservation, type TreeDirection } from './treeLayout.ts';
import type { PlaybackStep } from './types.ts';
import { verticalObstacleIndex } from './verticalObstacleIndex.ts';
import { workspaceContinuityReflows } from './workspaceShapeReflows.ts';

type Node = d3.HierarchyPointNode<SyntaxNode>;
type Reservations = ReadonlyMap<SyntaxNode, TreeCoordinateReservation>;
type Frame = { step: PlaybackStep; canvas: SyntaxNode; size: [number, number]; visible: ReadonlySet<string> };
type Painted = { nodes: ReadonlyMap<string, Node>; ink: (node: Node) => PlaqueRect[] };
type Shift = { x: number; y: number };

const EPSILON = 1e-6;
// The motion rules' threshold (scripts/replayMotionContinuity.mjs). A surviving
// fault may lengthen by less than half of it, below the comparator's tolerance.
const MOTION_THRESHOLD = 1;
const MOTION_TOLERANCE = MOTION_THRESHOLD / 2;
const cache = new WeakMap<Reservations, Reservations>();

/** A movement's lower occurrence takes its source's slot, beside the same
 * sisters. A reservation carried back from a later stage is sized for that lower
 * occurrence, so the complete source painted in the slot before its movement,
 * an intermediate landing included, can run into its sister. Size the slot by
 * every occupant it paints: from the source's arrival until the lower occurrence
 * leaves its parent, the occupant of each frame moves outward from the sister by
 * the largest clearance any of those frames needs. The movement moment keeps the
 * parent's motion, and the source's arrival owns the change. When the occupants
 * would then run into other syntax, they and the sister each take half of the
 * clearance, so their parent keeps its place.
 *
 * A slot is widened only when its painted branches stay valid, sister contours
 * were and stay ordered, no sister ink overlap is added or enlarged, the occupant
 * clears its sister in every frame, and neither a motion fault of the Replay
 * motion rules nor a continuity reflow is added or lengthened. Otherwise the
 * plan is kept. */
export function reserveMovementSlotClearance({ steps, sizes, coordinates, direction, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel }: {
  steps: readonly PlaybackStep[];
  sizes: ReadonlyMap<number, [number, number]>;
  coordinates: Reservations;
  direction: TreeDirection;
  measureCategoryText?: CategoryTextMeasure;
  measureTreeInk?: TreeInkTextMeasure;
  treeLabelRuns?: PreparedTreeLabelRuns;
  measureTreeLabel?: TreeLabelMeasure;
}): Reservations {
  const cached = cache.get(coordinates);
  if (cached) return cached;
  const order = (step: PlaybackStep) => step.replayStageStepIndex ?? (step.replayKind === 'macro' ? Infinity : 0);
  const frames: Frame[] = steps.flatMap(step => {
    const canvas = step.replayCanvasData, size = sizes.get(step.replayFrameIndex!);
    if (!canvas || !size || !coordinates.has(canvas)) return [];
    const root = d3.hierarchy(canvas); applyVizIds(root);
    return [{ step, canvas, size, visible: new Set<string>(step.replayVisibleNodeIds ?? root.descendants().map(getNodeId)) }];
  }).sort((a, b) => (a.step.replayFrameIndex! - b.step.replayFrameIndex!) || order(a.step) - order(b.step));
  let result: Reservations = coordinates;
  const paintings = new WeakMap<TreeCoordinateReservation, Painted>();
  const paint = (index: number, plan: Reservations = result) => paintPoints(index, plan.get(frames[index].canvas)!);
  const paintPoints = (index: number, points: TreeCoordinateReservation): Painted => {
    const { canvas, size, visible } = frames[index];
    let painted = paintings.get(points);
    if (!painted) {
      const root = d3.hierarchy(canvas); applyVizIds(root);
      const nodes = new Map<string, Node>(layoutSyntaxTree(root, size, direction, points, new Set(visible)).descendants()
        .filter(node => visible.has(getNodeId(node)) && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace')
        .map(node => [getNodeId(node), node] as const));
      paintings.set(points, painted = { nodes,
        ink: prepareTreeInkSubtrees(nodes, measureCategoryText, measureTreeInk, true, treeLabelRuns?.get(canvas), measureTreeLabel) });
    }
    return painted;
  };
  const crossing = (index: number) => frames[index - 1].step.replayFrameIndex !== frames[index].step.replayFrameIndex;
  const carry = (index: number, before: Painted, after: Painted): Shift =>
    crossing(index) ? carriedShift(before.nodes, after.nodes) : { x: 0, y: 0 };

  // The first frame, back from `start`, of the rigid run in which every member of
  // `rootId` painted at `start` stands where it stands one frame later.
  const arrival = (start: number, rootId: string) => {
    const root = paint(start).nodes.get(rootId)!;
    const members = new Set<string>(root.descendants().map(getNodeId).filter(id => paint(start).nodes.has(id)));
    let first = start;
    for (let index = start - 1; index >= 0; index--) {
      const earlier = paint(index), later = paint(index + 1), shift = carry(index + 1, earlier, later);
      const present = [...members].filter(id => earlier.nodes.has(id));
      if (!present.length || present.some(id => {
        const from = earlier.nodes.get(id)!, to = later.nodes.get(id);
        return !to || Math.hypot(to.x - from.x - shift.x, to.y - from.y - shift.y) > EPSILON;
      })) break;
      first = index;
    }
    return first;
  };
  // The last frame, on from `start`, in which `id` is painted under `parentId`.
  const departure = (start: number, id: string, parentId: string) => {
    let last = start;
    for (let index = start + 1; index < frames.length; index++) {
      const nodes = paint(index).nodes, node = nodes.get(id);
      if (!node || paintedParent(nodes, node) !== parentId) break;
      last = index;
    }
    return last;
  };
  type Move = { first: number; last: number; root: (index: number) => string; dx: number };
  // One translation per canvas: frames sharing a canvas must agree on its moves.
  const translated = (moves: readonly Move[]) => {
    const candidate = new Map(result), applied = new Map<SyntaxNode, string>();
    for (let index = 0; index < frames.length; index++) {
      const { canvas, visible } = frames[index], own = moves.filter(move => index >= move.first && index <= move.last);
      const key = JSON.stringify(own.map(move => [move.root(index), move.dx]));
      if (applied.has(canvas)) { if (applied.get(canvas) !== key) return undefined; continue; }
      applied.set(canvas, key);
      if (own.length) candidate.set(canvas, own.reduce((points, move) =>
        translateSubtree(canvas, points, visible, move.root(index), move.dx), result.get(canvas)!));
    }
    return candidate;
  };

  for (let moment = 1; moment < frames.length; moment++) {
    if (frames[moment].step.replayKind !== 'relation') continue;
    for (const movement of currentWorkspaceMovements(frames[moment].step, paint(moment - 1).nodes, paint(moment).nodes)) {
      const before = paint(moment - 1), after = paint(moment);
      const source = before.nodes.get(movement.priorSourceNodeId)!, lower = after.nodes.get(movement.witnessNodeId)!;
      const parentId = paintedParent(before.nodes, source);
      if (!parentId || paintedParent(after.nodes, lower) !== parentId) continue;
      const sisters = paintedChildren(before.nodes.get(parentId)!, before.nodes).map(getNodeId);
      const slot = sisters.indexOf(movement.priorSourceNodeId);
      const replaced = sisters.map(id => id === movement.priorSourceNodeId ? movement.witnessNodeId : id);
      if (sisters.length < 2 || JSON.stringify(replaced) !== JSON.stringify(paintedChildren(after.nodes.get(parentId)!, after.nodes).map(getNodeId))) continue;
      // An outer slot widens away from its one inner sister; a middle slot cannot.
      const inner = slot === 0 ? 1 : slot === sisters.length - 1 ? slot - 1 : -1;
      if (inner < 0) continue;
      const sisterId = sisters[inner], sister = before.nodes.get(sisterId)!;
      if (!collides(before.ink(source), before.ink(sister))) continue;
      const sign = sister.x > source.x ? -1 : 1;
      const occupantAt = (index: number) => index < moment ? movement.priorSourceNodeId : movement.witnessNodeId;
      // The source from its arrival, then its lower occurrence until it leaves the parent.
      const first = arrival(moment - 1, movement.priorSourceNodeId), last = departure(moment, movement.witnessNodeId, parentId);
      const occupied = (index: number, painted = paint(index)) => {
        const occupant = painted.nodes.get(occupantAt(index)), parent = painted.nodes.get(parentId);
        if (!occupant || !parent || paintedParent(painted.nodes, occupant) !== parentId) return undefined;
        const daughters = paintedChildren(parent, painted.nodes), at = daughters.indexOf(occupant);
        const neighbour = daughters[at === 0 ? 1 : at - 1];
        return neighbour && daughters.length > 1 && (at === 0 || at === daughters.length - 1)
          ? { occupant, neighbour } : undefined;
      };
      let distance = 0;
      for (let index = first; index <= last && Number.isFinite(distance); index++) {
        const pair = occupied(index);
        if (!pair) continue;
        const painted = paint(index);
        distance = Math.max(distance, clearance(painted.ink(pair.occupant), painted.ink(pair.neighbour), sign) ?? Infinity);
      }
      if (!(distance > EPSILON) || !Number.isFinite(distance)) continue;

      const accepts = (candidate: Reservations, from: number, to: number) => {
        for (let index = from; index <= to; index++) {
          const old = paint(index), next = paint(index, candidate);
          // Interleaved sister contours belong to the ordered-contour plan, not to this pass.
          if (!validBranches(next.nodes, direction) || !siblingContoursOrdered(old.nodes.values(), direction)
            || !siblingContoursOrdered(next.nodes.values(), direction)) return false;
          const overlaps = sisterOverlaps(old), proposed = sisterOverlaps(next);
          if ([...proposed].some(([pair, area]) => area > (overlaps.get(pair) ?? 0) + EPSILON)) return false;
          const pair = occupied(index, next);
          if (pair && collides(next.ink(pair.occupant), next.ink(pair.neighbour))) return false;
        }
        for (let index = Math.max(from, 1); index <= Math.min(to + 1, frames.length - 1); index++) {
          const faults = motionFaults(frames[index].step, paint(index - 1), paint(index), carry(index, paint(index - 1), paint(index)));
          const proposed = motionFaults(frames[index].step, paint(index - 1, candidate), paint(index, candidate),
            carry(index, paint(index - 1, candidate), paint(index, candidate)));
          if ([...proposed].some(([key, length]) => !faults.has(key) || length > faults.get(key)! + MOTION_TOLERANCE)) return false;
        }
        // Unchanged material keeps its internal contour, and only its owners move it.
        const scenes = frames.slice(Math.max(from - 1, 0), to + 2).map((frame, offset) =>
          ({ ...frame, index: Math.max(from - 1, 0) + offset, nodes: paint(Math.max(from - 1, 0) + offset).nodes }));
        const render = (scene: typeof scenes[number], points: TreeCoordinateReservation) => [...paintPoints(scene.index, points).nodes.values()];
        const reflows = new Set(workspaceContinuityReflows(scenes, result, render).map(reflow => JSON.stringify(reflow)));
        return workspaceContinuityReflows(scenes, candidate, render).every(reflow => reflows.has(JSON.stringify(reflow)));
      };
      // Reservations are stored before right-to-left reflection.
      const dx = sign * distance * (direction === 'rtl' ? -1 : 1);
      const occupant: Move = { first, last, root: occupantAt, dx };
      const sisterMove: Move = { first: arrival(moment - 1, sisterId), last: departure(moment - 1, sisterId, parentId), root: () => sisterId, dx: -dx / 2 };
      for (const moves of [[occupant], [{ ...occupant, dx: dx / 2 }, sisterMove]]) {
        const candidate = translated(moves);
        if (candidate && accepts(candidate, Math.min(...moves.map(move => move.first)), Math.max(...moves.map(move => move.last)))) {
          result = candidate;
          break;
        }
      }
    }
  }
  cache.set(coordinates, result);
  return result;
}

const paintedParent = (nodes: ReadonlyMap<string, Node>, node: Node) =>
  node.parent && nodes.has(getNodeId(node.parent)) ? getNodeId(node.parent) : undefined;
const paintedChildren = (node: Node, nodes: ReadonlyMap<string, Node>) =>
  (node.children ?? []).filter(child => nodes.has(getNodeId(child)));

/** Translate one occurrence's whole canvas subtree, painted or reserved, and
 * centre its painted ancestors over their painted daughters. */
function translateSubtree(canvas: SyntaxNode, points: TreeCoordinateReservation, visible: ReadonlySet<string>, rootId: string, dx: number) {
  const next = new Map(points), root = d3.hierarchy(canvas); applyVizIds(root);
  const occupant = root.descendants().find(node => getNodeId(node) === rootId);
  if (!occupant) return next;
  occupant.each(node => {
    const point = next.get(getNodeId(node));
    if (point) next.set(getNodeId(node), { x: point.x + dx, y: point.y });
  });
  const painted = (node: d3.HierarchyNode<SyntaxNode>) => visible.has(getNodeId(node)) && !node.data.replayLayoutOnly;
  for (let node = occupant.parent; node; node = node.parent) {
    const daughters = (node.children ?? []).filter(painted), point = next.get(getNodeId(node));
    if (!painted(node) || !daughters.length || !point) continue;
    const firstPoint = next.get(getNodeId(daughters[0])), lastPoint = next.get(getNodeId(daughters.at(-1)!));
    if (firstPoint && lastPoint) next.set(getNodeId(node), { ...point, x: (firstPoint.x + lastPoint.x) / 2 });
  }
  return next;
}

function validBranches(nodes: ReadonlyMap<string, Node>, direction: TreeDirection) {
  const occupied = new Set<string>();
  for (const node of nodes.values()) {
    const key = `${node.x.toFixed(6)},${node.y.toFixed(6)}`;
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || occupied.has(key)) return false;
    occupied.add(key);
    const daughters = paintedChildren(node, nodes);
    if (daughters.some((child, index) => child.y <= node.y || index > 0
      && (direction === 'rtl' ? child.x >= daughters[index - 1].x : child.x <= daughters[index - 1].x))) return false;
  }
  return true;
}

const shiftCurve = (curve: Cubic, dx: number): Cubic => ({
  source: { x: curve.source.x + dx, y: curve.source.y }, control1: { x: curve.control1.x + dx, y: curve.control1.y },
  control2: { x: curve.control2.x + dx, y: curve.control2.y }, target: { x: curve.target.x + dx, y: curve.target.y }
});
const shiftRect = (rect: PlaqueRect, dx: number): PlaqueRect => dx
  ? { ...rect, x: rect.x + dx, ...(rect.curve ? { curve: shiftCurve(rect.curve, dx) } : {}) } : rect;
const overlapArea = (a: PlaqueRect, b: PlaqueRect) => {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > EPSILON && height > EPSILON
    && (!a.curve || cubicIntersectsRect(a.curve, b, a.curvePadding!))
    && (!b.curve || cubicIntersectsRect(b.curve, a, b.curvePadding!)) ? width * height : 0;
};

function collides(own: readonly PlaqueRect[], other: readonly PlaqueRect[], dx = 0) {
  const query = verticalObstacleIndex(other);
  return own.some(rect => {
    const moved = shiftRect(rect, dx);
    return query(moved, obstacle => overlapArea(moved, obstacle) > 0);
  });
}

/** The painted distance `own` must move in direction `sign` to clear `other`,
 * found by separating the overlapping boxes until no contact remains. */
function clearance(own: readonly PlaqueRect[], other: readonly PlaqueRect[], sign: number) {
  const query = verticalObstacleIndex(other);
  let distance = 0;
  for (let round = 0; round < 32; round++) {
    let needed = 0;
    for (const rect of own) {
      const moved = shiftRect(rect, sign * distance);
      query(moved, obstacle => {
        if (overlapArea(moved, obstacle) > 0) needed = Math.max(needed, sign < 0
          ? moved.x + moved.width - obstacle.x : obstacle.x + obstacle.width - moved.x);
        return false;
      });
    }
    if (needed <= EPSILON) return distance;
    distance += needed + 1e-3;
  }
  return undefined;
}

/** Ink overlap between the painted subtrees of sisters and of separate roots,
 * each subtree with its labels, words and internal branches. */
function sisterOverlaps({ nodes, ink }: Painted) {
  const groups = [[...nodes.values()].filter(node => !paintedParent(nodes, node))];
  for (const node of nodes.values()) {
    const daughters = paintedChildren(node, nodes);
    if (daughters.length > 1) groups.push(daughters);
  }
  const areas = new Map<string, number>();
  for (const group of groups) for (let i = 0; i < group.length; i++) {
    const query = verticalObstacleIndex(ink(group[i]));
    for (let j = i + 1; j < group.length; j++) {
      let area = 0;
      for (const rect of ink(group[j])) query(rect, obstacle => { area += overlapArea(rect, obstacle); return false; });
      if (area) areas.set(`${getNodeId(group[i])} ${getNodeId(group[j])}`, area);
    }
  }
  return areas;
}

/** The three fault kinds of scripts/replayMotionContinuity.mjs for one step,
 * keyed by kind and node, with the same step ownership (motionOwnership.mjs). */
function motionFaults(step: PlaybackStep, before: Painted, after: Painted, carried: Shift) {
  const faults = new Map<string, number>();
  const motion = (id: string) => {
    const from = before.nodes.get(id), to = after.nodes.get(id);
    return from && to ? { x: to.x + carried.x - from.x, y: to.y + carried.y - from.y } : undefined;
  };
  const length = (shift: Shift) => Math.hypot(shift.x, shift.y);
  const parentIn = (nodes: ReadonlyMap<string, Node>, id: string) => {
    const node = nodes.get(id);
    return node ? paintedParent(nodes, node) : undefined;
  };
  const childIds = (nodes: ReadonlyMap<string, Node>, id: string) => paintedChildren(nodes.get(id)!, nodes).map(getNodeId).join(' ');
  const identity = step.replayRelationIdentity, key = identity && `${identity.stageIndex}:${identity.relationIndex}`;
  const links = step.replayKind === 'relation' && key ? (step.replayRelationLinks ?? [])
    .filter(link => link.renderFamily === 'trajectory' && link.authoredRelationKey === key)
    .flatMap(link => [link.priorSourceNodeId, link.witnessNodeId, link.targetNodeId]) : [];
  const seeds = [step.targetNodeId, ...links].filter((id): id is string => Boolean(id) && after.nodes.has(id!));
  for (const id of after.nodes.keys()) if (!before.nodes.has(id) || parentIn(before.nodes, id) !== parentIn(after.nodes, id)) seeds.push(id);
  const owned = new Set<string>();
  for (const seed of seeds) {
    after.nodes.get(seed)!.each(node => { if (after.nodes.has(getNodeId(node))) owned.add(getNodeId(node)); });
    for (let id = parentIn(after.nodes, seed); id; id = parentIn(after.nodes, id)) owned.add(id);
  }
  const moved = new Set([...after.nodes.keys()].filter(id => !owned.has(id) && before.nodes.has(id) && length(motion(id)!) > MOTION_THRESHOLD));
  for (const id of moved) {
    const parent = parentIn(after.nodes, id), shift = motion(id)!, carrier = parent && moved.has(parent) ? motion(parent)! : undefined;
    if (carrier && length({ x: shift.x - carrier.x, y: shift.y - carrier.y }) <= MOTION_THRESHOLD) continue;
    faults.set(`unowned ${id}`, length(shift));
  }
  for (const id of after.nodes.keys()) {
    const parent = parentIn(after.nodes, id);
    if (!before.nodes.has(id) || !parent || parentIn(before.nodes, id) !== parent || !before.nodes.has(parent)
      || childIds(after.nodes, parent) !== childIds(before.nodes, parent)) continue;
    const own = motion(id)!, carrier = motion(parent)!, relative = length({ x: own.x - carrier.x, y: own.y - carrier.y });
    if (length(own) > MOTION_THRESHOLD && relative > MOTION_THRESHOLD) faults.set(`shape ${id}`, relative);
  }
  const target = step.targetNodeId, created = target ? after.nodes.get(target) : undefined;
  if (step.replayKind === 'micro' && ['ExternalMerge', 'Project'].includes(step.operation) && created && !before.nodes.has(target!)) {
    const grand = paintedParent(after.nodes, created);
    const daughters = [...after.nodes.keys()].filter(id => parentIn(after.nodes, id) === target && before.nodes.has(id));
    const insertion = daughters.some(id => { const prior = parentIn(before.nodes, id); return prior !== undefined && prior === grand; });
    for (const id of daughters) {
      const shift = motion(id)!, old = before.nodes.get(id)!;
      const descends = insertion && Math.abs(created.y + carried.y - old.y) < EPSILON && after.nodes.get(id)!.y > created.y;
      const distance = descends ? Math.abs(shift.x) : length(shift);
      if (distance > MOTION_THRESHOLD) faults.set(`attachment ${id}`, distance);
    }
  }
  return faults;
}
