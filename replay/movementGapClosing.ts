import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { carriedShift, paintedShift, type PaintedNodes } from './cameraCarry.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { motionFrame, replayMotionFaults, stepOwnership } from './motionRule.ts';
import { closingAt, workspaceContinuityReflows } from './workspaceShapeReflows.ts';
import { keepsPlaqueRoom, type PlaqueRoom } from './plaqueRoom.ts';
import { plaqueTreeObstacles } from './relations/plaquePlacement.ts';
import { layoutSyntaxTree, type TreeCoordinateReservation } from './treeLayout.ts';
import { COMPACT_INK_CLEARANCE, HEAD_HOST_INK_GAP } from './currentRootCompaction.ts';
import { treeInkObstacles, type TreeInkTextMeasure } from './treeInkGeometry.ts';
import type { PreparedTreeLabelRuns, TreeLabelMeasure } from './treeLabelRuns.ts';
import type { PlaqueRect } from './relations/plaquePlacement.ts';
import { TREE_ROW_HEIGHT, TREE_SIBLING_GAP } from './treeSpacing.ts';
import type { PlaybackStep } from './types.ts';

type Node = d3.HierarchyPointNode<SyntaxNode>;
type Reservations = ReadonlyMap<SyntaxNode, TreeCoordinateReservation>;
type Box = { minX: number; maxX: number; minY: number; maxY: number };
/** `width`: the span its stage plan paints; `workspaces`: the span its stage plan paints each workspace
 * root with (workspaceSpans); `stage`: the scenes of its stage and the box they span together;
 * `closing`: a closing kept at this scene's movement moves syntax across the stage crossing into it. */
type Scene = { step: PlaybackStep; canvas: SyntaxNode; size: [number, number]; visible: Set<string>; width?: number;
  workspaces?: Map<string, number>; stage?: { members: number[]; box: Box }; closing?: boolean };
type Painted = Map<string, Node>;

/** Clearance kept between a closing side's label and word boxes and the syntax it closes toward. */
const BOX_CLEARANCE = 0;
/** How much wider than its plan painted it a completed stage may become. */
const WIDTH_GROWTH = 0.01;
/** How much wider or deeper the box a stage's frames span together (the stage
 * camera's fit) may become; a head seated clear of a movement's source may
 * reserve more, SEAT_GROWTH, for the landing that arrives beside it. */
const STAGE_GROWTH = 0.08, SEAT_GROWTH = 0.25;
/** How near a branch may pass text, in tree units (about a pixel at a Fit). */
const BRANCH_CLEARANCE = 8;
/** A closing narrower than this is not worth a step's motion. */
const MIN_CLOSING = TREE_SIBLING_GAP;
/** Motion below this many tree units is not worth holding a subtree for (the motion gate's noticeable motion). */
const NOTICED = 20;
/** tryShift's refusal when every check holds but its `accept` does not. */
const NO_GAIN = 'not accepted';

const painted = (node: Node) => !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace';
const stageOrder = (step: PlaybackStep) => step.replayStageStepIndex ?? (step.replayKind === 'macro' ? Infinity : 0);

/** The participants of a relation step's own trajectory links. */
function trajectoryParticipants(step: PlaybackStep) {
  const identity = step.replayRelationIdentity, key = identity && `${identity.stageIndex}:${identity.relationIndex}`;
  if (step.replayKind !== 'relation' || !key) return [];
  return [...new Set((step.replayRelationLinks ?? []).filter(link => link.renderFamily === 'trajectory' && link.authoredRelationKey === key)
    .flatMap(link => [link.priorSourceNodeId, link.witnessNodeId, link.targetNodeId]).filter((id): id is string => Boolean(id)))];
}

const shownParent = (nodes: Painted, node: Node) => {
  for (let parent = node.parent; parent; parent = parent.parent) if (nodes.has(getNodeId(parent))) return getNodeId(parent);
  return null;
};

/** What a step owns, as the motion rule assigns it: its target and trajectory
 * participants, syntax new in its frame or under a new painted parent,
 * everything below those and the ancestors above them. */
function ownedBy(step: PlaybackStep, before: Painted, after: Painted) {
  const seeds = [step.targetNodeId, ...trajectoryParticipants(step)].filter((id): id is string => Boolean(id) && after.has(id!));
  for (const [id, node] of after) {
    const old = before.get(id);
    if (!old || shownParent(before, old) !== shownParent(after, node)) seeds.push(id);
  }
  const owned = new Set<string>();
  for (const id of seeds) {
    const node = after.get(id)!;
    node.each(member => { if (after.has(getNodeId(member))) owned.add(getNodeId(member)); });
    for (let parent = node.parent; parent; parent = parent.parent) if (after.has(getNodeId(parent))) owned.add(getNodeId(parent));
  }
  return owned;
}

const points = (nodes: Painted): PaintedNodes => new Map([...nodes].map(([id, node]) => [id, { x: node.x, y: node.y, parentId: shownParent(nodes, node) }]));

/** The camera carry into scene `j` from `before` to `after`: none within a stage,
 * and across a crossing the screen's (paintedShift), with the tie rule only where
 * this plan's own closing moves syntax there (`closing`, by default the scene's). */
const carryAt = (scenes: readonly Scene[], j: number, before: Painted, after: Painted, closing = Boolean(scenes[j].closing)) =>
  scenes[j - 1].step.replayFrameIndex !== scenes[j].step.replayFrameIndex ? paintedShift(points(before), points(after), { closing }) : { x: 0, y: 0 };

/** Whether the step from `before` to `after` moves no shared node farther than
 * the step from `oldBefore` to `oldAfter` did, after the camera carry of a
 * crossing. A phrase the step's trajectory carries may travel differently, but
 * only together with its painted parent, so no phrase changes shape where it did
 * not before. */
function sameMotion(scenes: readonly Scene[], j: number, oldBefore: Painted, oldAfter: Painted, before: Painted, after: Painted) {
  const step = scenes[j].step, was = carryAt(scenes, j, oldBefore, oldAfter), now = carryAt(scenes, j, before, after);
  // The phrases the step's own trajectories carry.
  const movers = new Set<string>();
  for (const id of trajectoryParticipants(step)) after.get(id)?.each(member => { movers.add(getNodeId(member)); });
  const daughters = (nodes: Painted, id: string) => (nodes.get(id)?.children ?? []).filter(child => nodes.has(getNodeId(child))).map(getNodeId).join(' ');
  // Each node's motion over the step in both plans.
  const motion = (id: string) => {
    const node = after.get(id), prior = before.get(id), oldPrior = oldBefore.get(id), old = oldAfter.get(id);
    if (!node || !prior || !oldPrior || !old) return undefined;
    return { now: { x: node.x - now.x - prior.x, y: node.y - now.y - prior.y }, was: { x: old.x - was.x - oldPrior.x, y: old.y - was.y - oldPrior.y } };
  };
  const length = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);
  for (const [id, node] of after) {
    const own = motion(id);
    if (!own || length({ x: own.now.x - own.was.x, y: own.now.y - own.was.y }) <= 1e-6) continue;
    // Other syntax may only move less, whoever owns it.
    if (!movers.has(id)) {
      if (length(own.now) <= length(own.was) + 1e-6) continue;
      return false;
    }
    // A carried phrase may travel differently, but no farther relative to a
    // parent that keeps its daughters.
    const parent = shownParent(after, node), carrier = parent && motion(parent);
    if (!carrier || shownParent(before, before.get(id)!) !== parent || daughters(before, parent) !== daughters(after, parent)) continue;
    const relNow = length({ x: own.now.x - carrier.now.x, y: own.now.y - carrier.now.y }), relWas = length({ x: own.was.x - carrier.was.x, y: own.was.y - carrier.was.y });
    if (relNow <= Math.max(relWas, 1) + 1e-6) continue;
    return false;
  }
  return true;
}

const spanOf = (frame: Painted) => {
  let low = Infinity, high = -Infinity;
  for (const node of frame.values()) { low = Math.min(low, node.x); high = Math.max(high, node.x); }
  return high > low ? high - low : 0;
};
/** Each painted workspace root's span in a frame: the root and its painted
 * descendants, as the corpus gate measures a completed workspace's width. */
const workspaceSpans = (frame: Painted) => {
  const spans = new Map<string, number>();
  for (const [id, node] of frame) {
    if (shownParent(frame, node)) continue;
    let low = Infinity, high = -Infinity;
    node.each(member => { const shown = frame.get(getNodeId(member)); if (shown) { low = Math.min(low, shown.x); high = Math.max(high, shown.x); } });
    spans.set(id, high > low ? high - low : 0);
  }
  return spans;
};
const boxes = new WeakMap<Painted, Box>();
const boxOf = (frame: Painted): Box => {
  let box = boxes.get(frame);
  if (box) return box;
  box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const node of frame.values()) {
    box.minX = Math.min(box.minX, node.x); box.maxX = Math.max(box.maxX, node.x);
    box.minY = Math.min(box.minY, node.y); box.maxY = Math.max(box.maxY, node.y);
  }
  boxes.set(frame, box);
  return box;
};
const union = (a: Box, b: Box): Box => ({ minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY) });

/** The median travel, after `carry`, of the syntax a step leaves attached as it
 * was (painted in both frames under the same shared ancestors), as the camera
 * audit's first-paint continuity reads it on screen: syntax the step's own
 * closing moves (`granted`) may count as moved, where that lowers the median. */
function attachedTravel(before: Painted, after: Painted, carry: { x: number; y: number }, granted: ReadonlySet<string>) {
  const shared = new Set([...after.keys()].filter(id => before.has(id)));
  const lineage = (frame: Painted, id: string) => frame.get(id)!.ancestors().map(getNodeId).filter(other => other !== id && shared.has(other)).join(' ');
  const travel = (id: string) => Math.hypot(after.get(id)!.x - carry.x - before.get(id)!.x, after.get(id)!.y - carry.y - before.get(id)!.y);
  const median = (values: number[]) => { values.sort((a, b) => a - b); return values.length ? (values[(values.length - 1) >> 1] + values[values.length >> 1]) / 2 : 0; };
  const all = [...shared], attached = all.filter(id => lineage(before, id) === lineage(after, id));
  const rest = attached.filter(id => !(granted.has(id) && travel(id) > 1));
  return Math.min(median((attached.length ? attached : all).map(travel)), median((rest.length ? rest : all).map(travel)));
}

/** Whether frames `changed` (by scene index; the others as `frames` paints them)
 * keep the camera's view of their stages: the stage camera fits the box a
 * stage's frames span together, which may move but grow no more than
 * STAGE_GROWTH wider or deeper than planned, a completed stage grows no more
 * than WIDTH_GROWTH wider than its plan painted it, and none of its workspaces
 * is wider than there. A finished workspace that stands wider holds room early
 * for a later step (a head waiting at its landing, a daughter at a later
 * place); only the step that needs the room may open it. */
function keepsStageSize(scenes: readonly Scene[], frames: readonly Painted[], changed: ReadonlyMap<number, Painted>, growth = STAGE_GROWTH) {
  const stages = new Set([...changed.keys()].map(index => scenes[index].stage!));
  for (const stage of stages) {
    let box: Box | undefined;
    for (const index of stage.members) { const part = boxOf(changed.get(index) ?? frames[index]); box = box ? union(box, part) : part; }
    const planned = stage.box;
    if (box!.maxX - box!.minX > (planned.maxX - planned.minX) * (1 + growth) + 1
      || box!.maxY - box!.minY > (planned.maxY - planned.minY) * (1 + growth) + 1) return false;
  }
  for (const [index, frame] of changed) {
    if (scenes[index].step.replayKind !== 'macro') continue;
    if (spanOf(frame) > scenes[index].width! * (1 + WIDTH_GROWTH) + 1) return false;
    for (const [root, span] of workspaceSpans(frame)) if (span > (scenes[index].workspaces!.get(root) ?? Infinity) + 1e-6) return false;
  }
  return true;
}

/** Scenes `start` to `end` (exclusive) as `paint` paints them, or null when they
 * fail keepsStageSize. Each stage is judged once its frames in the range are
 * painted, so a refused change paints no further stage; the verdict is
 * keepsStageSize's over the whole range. */
function repaintWithinStageSize(scenes: readonly Scene[], frames: readonly Painted[], start: number, end: number,
  paint: (scene: Scene) => Painted, growth = STAGE_GROWTH): Painted[] | null {
  const repainted: Painted[] = [];
  let first = start;
  for (let j = start; j < end; j++) {
    repainted.push(paint(scenes[j]));
    if (j + 1 < end && scenes[j + 1].stage === scenes[j].stage) continue;
    const stage = new Map<number, Painted>();
    for (let index = first; index <= j; index++) stage.set(index, repainted[index - start]);
    if (!keepsStageSize(scenes, frames, stage, growth)) return null;
    first = j + 1;
  }
  return repainted;
}

/** The corpus gate's continuity faults (workspaceContinuityReflows, with the
 * closings it grants) at `step` after `previous`, over two painted frames. */
const pairCache = <T>() => {
  const cache = new WeakMap<Painted, WeakMap<Painted, T>>();
  return (before: Painted, after: Painted, compute: () => T) => {
    let inner = cache.get(before);
    if (!inner) { inner = new WeakMap(); cache.set(before, inner); }
    if (!inner.has(after)) inner.set(after, compute());
    return inner.get(after)!;
  };
};
// Painted frames are never changed in place, so a pair's faults are fixed.
// One cache per `closing`, which changes the carry at a crossing.
const continuityCaches = [pairCache<string[]>(), pairCache<string[]>()];
const faultCaches = [pairCache<ReturnType<typeof replayMotionFaults>>(), pairCache<ReturnType<typeof replayMotionFaults>>()];

function continuityFaults(previous: Scene, step: Scene, before: Painted, after: Painted, closing = Boolean(step.closing)) {
  return continuityCaches[Number(closing)](before, after, () => {
    const window = [{ step: previous.step, canvas: previous.canvas, nodes: before }, { step: step.step, canvas: step.canvas, nodes: after, closing }];
    return workspaceContinuityReflows(window, new Map(), scene => [...scene.nodes.values()], { ownClosings: true })
      .map(fault => `${fault.kind} ${fault.rootId}`);
  });
}

/** The continuity faults the new frames add at one step over the old ones;
 * `closing` is the new frames' (a candidate closing at the step's crossing). */
function newContinuityFaults(previous: Scene, step: Scene, oldBefore: Painted, oldAfter: Painted, before: Painted, after: Painted,
  closing = Boolean(step.closing)) {
  const old = new Set(continuityFaults(previous, step, oldBefore, oldAfter));
  return continuityFaults(previous, step, before, after, closing).filter(fault => !old.has(fault));
}

/** Closes, at a movement, the room its phrase leaves behind.
 *
 * Stage plans keep syntax where earlier frames placed it, so when a phrase moves
 * away its old room often stays open for the rest of Replay and in the Canopy.
 * The movement step owns the closing of that gap (Francis, 25 October 2026:
 * "yes, the closing the gap is alright."): one side of the departing phrase's
 * former extent slides toward it as one, no farther than that extent and one
 * node unit, while the lower occurrence and the other syntax the step creates
 * inside the extent may shift within the room. From that step on, every frame
 * keeps the closing: the same side stands nearer by the same amount, so no later
 * step moves anything that it did not already move.
 *
 * Each frame from the movement on is split by two lines that follow the departing
 * extent's ends (carried across stage crossings by the shared syntax): the closing
 * side beyond one end, the room between them, and the side that stays. The amount
 * is the most every later frame allows while each row keeps a node unit between
 * centres and the label and word boxes stay clear. A closing is not made when a
 * later step would carry syntax it does not own from one part to another, nor
 * when it takes the room a proximity plaque stands in beside its anchor
 * (keepsPlaqueRoom; `plaques` names them, from the relation plan).
 *
 * Returns each stage's reservations and `closings`, the stages whose crossing a
 * kept closing moves syntax across (its movement is the stage's first step). Only
 * there does the camera carry break a tie toward the block that holds still
 * (carriedMedian); stageCoordinates records them on the stage's reservations. */
export function closeMovementGaps({ steps, sizes, planned, measureCategoryText, plaques = { anchors: new Map() }, ink = {} }: {
  steps: readonly PlaybackStep[];
  sizes: ReadonlyMap<number, [number, number]>;
  planned: ReadonlyMap<number, Reservations>;
  measureCategoryText?: CategoryTextMeasure;
  /** The measures of painted text, for the ink a seated landing clears (seatLandings). */
  ink?: InkMeasures;
  /** The proximity plaques whose room beside their anchors a closing keeps. */
  plaques?: PlaqueRoom;
}): { stages: Map<number, Map<SyntaxNode, TreeCoordinateReservation>>; closings: Set<number> } {
  const ordered = steps.filter(step => step.replayCanvasData && step.replayFrameIndex !== undefined && sizes.has(step.replayFrameIndex))
    .sort((a, b) => a.replayFrameIndex! - b.replayFrameIndex! || stageOrder(a) - stageOrder(b));
  const scenes: Scene[] = ordered.map(step => {
    const canvas = step.replayCanvasData!;
    const root = d3.hierarchy(canvas); applyVizIds(root);
    return { step, canvas, size: sizes.get(step.replayFrameIndex!)!, visible: new Set(step.replayVisibleNodeIds ?? root.descendants().map(getNodeId)) };
  });
  // Working reservations per canvas; a canvas belongs to its first scene.
  const coordinates = new Map<SyntaxNode, Map<string, { x: number; y: number }>>();
  const firstScene = new Map<SyntaxNode, number>(), lastScene = new Map<SyntaxNode, number>();
  scenes.forEach((scene, index) => {
    if (!coordinates.has(scene.canvas)) {
      const plan = planned.get(scene.step.replayFrameIndex!)?.get(scene.canvas);
      coordinates.set(scene.canvas, new Map([...(plan ?? [])].map(([id, point]) => [id, { ...point }])));
      firstScene.set(scene.canvas, index);
    }
    lastScene.set(scene.canvas, index);
  });
  const paint = (scene: Scene): Painted => {
    const root = d3.hierarchy(scene.canvas); applyVizIds(root);
    return new Map(layoutSyntaxTree(root, scene.size, 'ltr', coordinates.get(scene.canvas)!, scene.visible).descendants()
      .filter(node => scene.visible.has(getNodeId(node)) && painted(node)).map(node => [getNodeId(node), node] as const));
  };
  // Every scene as the current coordinates paint it.
  const all = scenes.map(paint);
  const stages = new Map<number, { members: number[]; box: Box }>();
  scenes.forEach((scene, index) => {
    scene.width = spanOf(all[index]);
    scene.workspaces = workspaceSpans(all[index]);
    const stage = stages.get(scene.step.replayFrameIndex!);
    if (stage) { stage.members.push(index); stage.box = union(stage.box, boxOf(all[index])); }
    else stages.set(scene.step.replayFrameIndex!, { members: [index], box: boxOf(all[index]) });
    scene.stage = stages.get(scene.step.replayFrameIndex!);
  });
  const again = new Map<number, number>();
  const sceneSteps = scenes.map(scene => scene.step);
  for (let m = 1; m < scenes.length; m++) {
    const participants = trajectoryParticipants(scenes[m].step);
    if (!participants.length || firstScene.get(scenes[m].canvas) !== m || lastScene.get(scenes[m - 1].canvas)! >= m) continue;
    const frames = all.slice(m - 1);
    const prior = frames[0], current = frames[1];
    // The departing material: what leaves the step's own trajectory participants
    // (relocated under another painted parent, or no longer painted).
    const departing = new Set<string>();
    for (const participant of participants) {
      const start = prior.get(participant);
      if (!start) continue;
      for (const pending = [start]; pending.length;) {
        const node = pending.pop()!, id = getNodeId(node), now = current.get(id);
        if (!now || shownParent(prior, node) !== shownParent(current, now)) {
          node.each(member => { if (prior.has(getNodeId(member))) departing.add(getNodeId(member)); });
          continue;
        }
        pending.push(...(node.children ?? []).filter(child => prior.has(getNodeId(child))));
      }
    }
    if (!departing.size) continue;
    const xs = [...departing].map(id => prior.get(id)!.x);
    // The room the phrase leaves: its former extent and one node unit, less the
    // node unit a lower occurrence painted in that extent keeps.
    // At a crossing the movement's frame stands in its own stage's coordinates,
    // `entry` from the frame before.
    const entry = scenes[m - 1].step.replayFrameIndex !== scenes[m].step.replayFrameIndex
      ? carriedShift(prior, current, { closing: Boolean(scenes[m].closing) }).x : 0;
    const lo = Math.min(...xs), hi = Math.max(...xs);
    const kept = [...current].some(([id, node]) => !prior.has(id) && node.x - entry >= lo - 1 && node.x - entry <= hi + 1);
    const bound = hi - lo + (kept ? 0 : TREE_SIBLING_GAP);
    // At the movement the lines stand in the room the phrase leaves: past the
    // syntax wholly before and after its former extent, and through no phrase
    // that keeps its daughters except the parents the departure changes.
    const extent = new Map<string, [number, number]>();
    const span = (node: Node): [number, number] => {
      const id = getNodeId(node), known = extent.get(id);
      if (known) return known;
      let result: [number, number] = [node.x, node.x];
      for (const child of node.children ?? []) if (current.has(getNodeId(child))) {
        const part = span(child); result = [Math.min(result[0], part[0]), Math.max(result[1], part[1])];
      }
      extent.set(id, result);
      return result;
    };
    const priorExtent = (node: Node): [number, number] => {
      let result: [number, number] = [node.x, node.x];
      node.each(member => { if (prior.has(getNodeId(member))) result = [Math.min(result[0], member.x), Math.max(result[1], member.x)]; });
      return result;
    };
    const changed = new Set<string>();
    for (const id of departing) for (let parent = prior.get(id)!.parent; parent; parent = parent.parent)
      if (!departing.has(getNodeId(parent))) changed.add(getNodeId(parent));
    let before = -Infinity, after = Infinity;
    const blocked: [number, number][] = [];
    for (const [id, node] of current) {
      const old = prior.get(id);
      if (old && !departing.has(id)) {
        const [a, b] = priorExtent(old);
        if (b < lo) before = Math.max(before, span(node)[1]);
        else if (a > hi) after = Math.min(after, span(node)[0]);
      }
      if (old && !changed.has(id) && node.children?.some(child => current.has(getNodeId(child)))) blocked.push(span(node));
    }
    // A gap lies between syntax that stood on both sides of the phrase in its
    // workspace, in word order: one that left the edge leaves none, and new syntax
    // beside it (the landing) is not a side that closes.
    const between = (() => {
      const start = participants.map(id => prior.get(id)).find(node => node && departing.has(getNodeId(node)));
      if (!start) return false;
      let top = start;
      for (let id = shownParent(prior, top); id; id = shownParent(prior, top)) top = prior.get(id)!;
      const leaves: boolean[] = [];
      top.eachBefore(node => {
        const id = getNodeId(node);
        if (prior.has(id) && !(node.children ?? []).some(child => prior.has(getNodeId(child)))) leaves.push(departing.has(id));
      });
      const firstOut = leaves.indexOf(true), lastOut = leaves.lastIndexOf(true);
      return leaves.slice(0, firstOut).includes(false) && leaves.slice(lastOut + 1).includes(false);
    })();
    if (!Number.isFinite(before)) before = lo + entry - 1;
    if (!Number.isFinite(after)) after = hi + entry + 1;
    const clear = (x: number, direction: 1 | -1) => {
      for (let moved = true; moved;) {
        moved = false;
        for (const [a, b] of blocked) if (x > a - 0.5 && x < b + 0.5) { x = direction > 0 ? b + 0.5 : a - 0.5; moved = true; }
      }
      return x;
    };
    const first = clear(before + 0.5, 1), last = clear(after - 0.5, -1);
    if (!between) continue;
    if (first > last) continue;
    // The two lines through every later frame, carried across stage crossings.
    const lines: [number, number][] = [[first, last]];
    for (let k = 2; k < frames.length; k++) {
      const crossing = scenes[m + k - 2].step.replayFrameIndex !== scenes[m + k - 1].step.replayFrameIndex;
      const shift = crossing ? carriedShift(frames[k - 1], frames[k], { closing: Boolean(scenes[m + k - 1].closing) }).x : 0;
      lines.push([lines[k - 2][0] + shift, lines[k - 2][1] + shift]);
    }
    // Each node keeps the part it first stands in from the movement on: syntax
    // painted at the movement by its place there, later syntax by its place
    // where it first appears, hidden scaffolding by its reserved place. A phrase
    // carried elsewhere later keeps the shape the closing gave it.
    const line = (k: number, x: number) => x < lines[k - 1][0] ? 0 : x <= lines[k - 1][1] ? 1 : 2;
    // The workspace the movement's own syntax stands in, at the movement.
    const topOf = (frame: Painted, node: Node) => { let top = node; for (let id = shownParent(frame, top); id; id = shownParent(frame, top)) top = frame.get(id)!; return getNodeId(top); };
    const homeNode = participants.map(id => current.get(id)).find(Boolean);
    const home = homeNode ? topOf(current, homeNode) : undefined;
    // partsAt[k]: each node's part in frame k.
    const partsAt: Map<string, number>[] = [];
    for (let k = 1; k < frames.length; k++) {
      // Hidden scaffolding takes its part frame by frame; painted syntax keeps it.
      const partOf = new Map([...(partsAt[k - 2] ?? [])].filter(([id]) => frames[k - 1].has(id)));
      // A phrase a later step relocates whole, from one part, takes the part
      // of the place it lands at.
      if (k > 1) for (const [id, node] of frames[k]) {
        const old = frames[k - 1].get(id);
        if (!old || shownParent(frames[k - 1], old) === shownParent(frames[k], node)) continue;
        const members: string[] = [];
        node.each(member => { members.push(getNodeId(member)); });
        const parts = new Set(members.map(member => partOf.get(member)).filter(part => part !== undefined));
        if (parts.size === 1) for (const member of members) partOf.set(member, line(k, node.x));
      }
      // Syntax first painted here takes, whole, the part of its highest new ancestor.
      for (const [id, node] of frames[k]) if (!partOf.has(id)) {
        let top = node;
        if (k > 1) for (let parent = node.parent; parent; parent = parent.parent) {
          if (!frames[k].has(getNodeId(parent))) continue;
          if (frames[k - 1].has(getNodeId(parent))) break;
          top = parent;
        }
        // Other workspaces wait where they will attach: they keep their place
        // (part 3, which no closing moves).
        if (k === 1) { partOf.set(id, topOf(frames[1], node) === home ? line(k, node.x) : 3); continue; }
        // New syntax takes the part of its place.
        const at = line(k, top.x);
        // Only the new syntax under it: older syntax below keeps its own part.
        for (const pending = [top]; pending.length;) {
          const member = pending.pop()!, memberId = getNodeId(member);
          if (frames[k - 1].has(memberId) && member !== top) continue;
          if (frames[k].has(memberId) && !partOf.has(memberId)) partOf.set(memberId, at);
          pending.push(...(member.children ?? []));
        }
      }
      for (const [id, point] of coordinates.get(scenes[m + k - 1].canvas)!) if (!partOf.has(id)) partOf.set(id, line(k, point.x));
      partsAt.push(partOf);
    }
    const ownedHere = ownedBy(scenes[m].step, prior, current);
    // Room syntax the step does not own keeps its place.
    const roomFree = [...current].every(([id]) => partsAt[0].get(id) !== 1 || ownedHere.has(id) || !prior.has(id));
    // Pairs of neighbours in different parts, in every frame from the movement
    // on: how much nearer each may come (`room`), left one's part first.
    type Pair = { left: readonly number[]; right: readonly number[]; room: number };
    const pairs: Pair[] = [];
    for (let k = 1; k < frames.length; k++) {
      const nodes = [...frames[k].values()], partOf = partsAt[k - 1];
      // How much of each part's shift a painted node takes: a parent recentres
      // over its first and last painted daughters.
      const weights = new Map<string, number[]>();
      const weightOf = (node: Node): number[] => {
        const id = getNodeId(node), known = weights.get(id);
        if (known) return known;
        const daughters = (node.children ?? []).filter(child => frames[k].has(getNodeId(child)));
        let result: number[];
        if (daughters.length) {
          const first = weightOf(daughters[0]), last = weightOf(daughters.at(-1)!);
          result = first.map((value, index) => (value + last[index]) / 2);
        } else result = [0, 1, 2].map(part => part === partOf.get(id) ? 1 : 0);
        weights.set(id, result);
        return result;
      };
      const rows = new Map<number, Node[]>();
      for (const node of nodes) {
        const row = Math.round(node.y / TREE_ROW_HEIGHT);
        rows.set(row, [...(rows.get(row) ?? []), node]);
      }
      for (const members of rows.values()) {
        members.sort((u, v) => u.x - v.x);
        for (let i = 1; i < members.length; i++) {
          const u = weightOf(members[i - 1]), v = weightOf(members[i]);
          if (u.some((value, index) => Math.abs(value - v[index]) > 1e-9)) pairs.push({ left: u, right: v, room: Math.max(0, members[i].x - members[i - 1].x - TREE_SIBLING_GAP) });
        }
      }
      const bands = new Map<number, { left: number; right: number; top: number; bottom: number; part: number[] }[]>();
      for (const { id, box } of labelBoxes(frames[k], measureCategoryText)) {
        const node = frames[k].get(id)!;
        for (let band = Math.floor(box.y / 55); band <= Math.floor((box.y + box.height) / 55); band++)
          bands.set(band, [...(bands.get(band) ?? []), { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height, part: weightOf(node) }]);
      }
      for (const boxes of bands.values()) {
        boxes.sort((u, v) => u.left - v.left);
        // Each box against the next boxes to its right that shift differently.
        for (let i = 0; i < boxes.length; i++) {
          const seen: number[][] = [boxes[i].part];
          for (let j = i + 1; j < boxes.length && seen.length < 4; j++) {
            if (Math.min(boxes[i].bottom, boxes[j].bottom) <= Math.max(boxes[i].top, boxes[j].top)) continue;
            if (seen.some(part => part.every((value, index) => Math.abs(value - boxes[j].part[index]) <= 1e-9))) continue;
            seen.push(boxes[j].part);
            pairs.push({ left: boxes[i].part, right: boxes[j].part, room: Math.max(0, boxes[j].left - boxes[i].right - BOX_CLEARANCE) });
          }
        }
      }
    }
    for (const side of [-1, 1] as const) {
      // side -1: the syntax before the extent closes rightwards (part 0 by w1,
      // the room by w2); 1: the syntax after it, leftwards (part 2 by w1).
      const closing = side < 0 ? 0 : 2;
      const shiftOf = (at: number, w1: number, w2: number) => at === closing ? w1 : at === 1 ? w2 : 0;
      // A pair comes nearer by its left part's rightward shift less its right part's.
      // Each pair is linear in the two shifts: it allows w1 up to a bound for each w2.
      const linear = pairs.map(pair => ({ a: -side * (pair.left[closing] - pair.right[closing]), b: -side * (pair.left[1] - pair.right[1]), room: pair.room + 1e-6 }));
      // The largest w1 <= bound that fits with w2, or -1 when even none does.
      const most = (w2: number) => {
        let high = bound;
        for (const { a, b, room } of linear) {
          const slack = room - b * w2;
          if (slack < 0) return -1;
          if (a > 0) high = Math.min(high, slack / a);
        }
        return high;
      };
      let w2 = 0, w1 = most(0);
      if (roomFree && partsAt.some(parts => [...parts.values()].includes(1))) for (let step = 1; step <= 32; step++) {
        const candidate = bound * step / 32;
        const reach = most(candidate);
        if (reach > w1 + 1e-6) { w1 = reach; w2 = candidate; }
      }
      if (!(w1 >= MIN_CLOSING)) continue;
      // Shift every canvas from the movement on, each once.
      const moved = new Map<SyntaxNode, Map<string, { x: number; y: number }>>();
      for (let k = 1; k < frames.length; k++) {
        const scene = scenes[m + k - 1];
        if (moved.has(scene.canvas)) continue;
        const points = coordinates.get(scene.canvas)!;
        moved.set(scene.canvas, new Map(points));
        for (const [id, point] of points) {
          const dx = shiftOf(partsAt[k - 1].get(id)!, w1, w2);
          if (dx) points.set(id, { x: point.x - side * dx, y: point.y });
        }
      }
      // The movement's own motion is what the rule accepts, with no new or
      // farther fault, and every later step keeps the motion it had.
      const closed = scenes.slice(m).map(paint);
      // At a crossing, a closing kept here is recorded (`closing`), so the closed
      // frame is judged under the carry the screen will then apply.
      const joinCarry = scenes[m - 1].step.replayFrameIndex !== scenes[m].step.replayFrameIndex;
      const closingWas = Boolean(scenes[m].closing), closingNow = joinCarry || closingWas;
      const faults = (after: Painted, closing: boolean) => replayMotionFaults({ frames: [motionFrame(scenes[m - 1].step, prior, getNodeId),
        motionFrame(scenes[m].step, after, getNodeId, closing)] });
      const base = new Map(faults(current, closingWas).map(fault => [`${fault.kind} ${fault.node}`, fault]));
      const added = faults(closed[0], closingNow).filter(fault => fault.distance > (base.get(`${fault.kind} ${fault.node}`)?.distance ?? 0) + 1);
      // A waiting piece joining here, other than a carried phrase, moves no farther.
      const movers = new Set<string>();
      for (const id of participants) closed[0].get(id)?.each(member => { movers.add(getNodeId(member)); });
      const shiftNow = carryAt(scenes, m, prior, closed[0], closingNow), shiftWas = carryAt(scenes, m, prior, current, closingWas);
      for (const [id, node] of closed[0]) {
        const old = prior.get(id), was = current.get(id);
        if (!old || !was || movers.has(id) || shownParent(prior, old) !== null || shownParent(closed[0], node) === null) continue;
        // A host the landing attaches above is not a waiting piece.
        let size = 0;
        old.each(member => { if (prior.has(getNodeId(member))) size++; });
        if (2 * size > prior.size) continue;
        const now = Math.hypot(node.x - shiftNow.x - old.x, node.y - shiftNow.y - old.y), before = Math.hypot(was.x - shiftWas.x - old.x, was.y - shiftWas.y - old.y);
        if (now > before + 1) added.push({ kind: 'joining-motion', node: id, distance: now });
      }
      // Beyond the closing the rule grants, no node the step does not carry moves farther.
      const granted = closingAt(scenes[m - 1].step, scenes[m].step, prior, closed[0], prior, closed[0], { closing: closingNow });
      // Syntax the step owns may also close from both sides at once, as the
      // camera carry of a crossing can show a closing: each side only
      // horizontally, toward the room, and no farther than it.
      const owns = stepOwnership({ target: scenes[m].step.targetNodeId, links: participants,
        points: [...closed[0]].map(([id, node]) => ({ id, parent: shownParent(closed[0], node) })),
        prior: new Map([...prior].map(([id, node]) => [id, { id, parent: shownParent(prior, node) }])) });
      const closesToward = (id: string, dx: number, dy: number) => {
        const part = partsAt[0].get(id);
        return Math.abs(dy) <= 1 && Math.abs(dx) <= bound + 1 && (part === 0 ? dx >= -1 : part === 2 ? dx <= 1 : true);
      };
      for (const [id, node] of closed[0]) {
        const old = prior.get(id), was = current.get(id);
        if (!old || !was || movers.has(id) || granted.has(id)) continue;
        if (owns.has(id) && closesToward(id, node.x - shiftNow.x - old.x, node.y - shiftNow.y - old.y)) continue;
        const now = Math.hypot(node.x - shiftNow.x - old.x, node.y - shiftNow.y - old.y), before = Math.hypot(was.x - shiftWas.x - old.x, was.y - shiftWas.y - old.y);
        if (now > before + 1) { added.push({ kind: 'ungranted-motion', node: id, distance: now }); break; }
      }
      // What the step leaves attached, beyond what its closing moves, keeps its
      // place on screen.
      const seen = (after: Painted, closing: boolean) => closingAt(scenes[m - 1].step, scenes[m].step, prior, after, prior, after, { closing });
      const bulk = attachedTravel(prior, closed[0], shiftNow, seen(closed[0], closingNow));
      if (bulk > Math.max(attachedTravel(prior, current, shiftWas, seen(current, closingWas)), 1) + 1e-6)
        added.push({ kind: 'attached-motion', node: '', distance: bulk });
      // Nor any continuity fault the corpus gate would newly find.
      const continuous = !added.length && keepsStageSize(scenes, all, new Map(closed.map((frame, index) => [m + index, frame]))) && closed.every((frame, index) => !newContinuityFaults(scenes[m + index - 1], scenes[m + index],
        frames[index], frames[index + 1], index ? closed[index - 1] : frames[0], frame, index ? Boolean(scenes[m + index].closing) : closingNow).length);
      if (continuous && closed.slice(1).every((frame, index) =>
        sameMotion(scenes, m + index + 1, frames[index + 1], frames[index + 2], closed[index], frame))
        && keepsPlaqueRoom(sceneSteps, all, [...all.slice(0, m), ...closed], m, plaques, measureCategoryText)) {
        closed.forEach((frame, index) => { all[m + index] = frame; });
        // Recorded only where it moves painted syntax across the crossing.
        if (joinCarry && [...closed[0]].some(([id, node]) => { const was = current.get(id); return was && Math.hypot(node.x - was.x, node.y - was.y) > 1e-6; }))
          scenes[m].closing = true;
        // The other side may then close what room is left.
        if ((again.get(m) ?? 0) < 3) { again.set(m, (again.get(m) ?? 0) + 1); m--; }
        break;
      }
      for (const [canvas, points] of moved) coordinates.set(canvas, points);
    }
  }
  const inkOf = (scene: Scene, nodes: readonly Node[]) => treeInkObstacles([...nodes], measureCategoryText, ink.measureTreeInk, false,
    ink.treeLabelRuns?.get(scene.canvas), ink.measureTreeLabel);
  const context = { scenes, frames: all, coordinates, firstScene, lastScene, paint, measureCategoryText, inkOf, plaques, steps: sceneSteps };
  holdLoweredSubtrees(context);
  holdBack(scenes, all, coordinates, firstScene, lastScene, paint, measureCategoryText);
  openSourceRoom(scenes, all, coordinates, firstScene, lastScene, paint, measureCategoryText);
  seatReceivingHeads(context);
  holdAcrossCrossings(context);
  seatLandings(context);
  const byStage = new Map<number, Map<SyntaxNode, TreeCoordinateReservation>>();
  for (const scene of scenes) {
    const stage = scene.step.replayFrameIndex!;
    if (!byStage.has(stage)) byStage.set(stage, new Map());
    byStage.get(stage)!.set(scene.canvas, coordinates.get(scene.canvas)!);
  }
  // Canvases outside the ordered scenes keep their plans.
  for (const [stage, frames] of planned) for (const [canvas, plan] of frames) {
    if (!byStage.has(stage)) byStage.set(stage, new Map());
    if (!byStage.get(stage)!.has(canvas)) byStage.get(stage)!.set(canvas, plan);
  }
  return { stages: byStage, closings: new Set(scenes.flatMap(scene => scene.closing ? [scene.step.replayFrameIndex!] : [])) };
}

type LabelBox = { id: string; box: { x: number; y: number; width: number; height: number } };
const labelBoxCache = new WeakMap<Painted, LabelBox[]>();
/** Each painted node's label and word boxes in a frame (frames are never changed in place). */
function labelBoxes(frame: Painted, measureCategoryText?: CategoryTextMeasure) {
  let result = labelBoxCache.get(frame);
  if (!result) {
    result = [...frame.values()].flatMap(node => plaqueTreeObstacles([node], measureCategoryText)
      .filter(box => box.terminalStemNodeId === undefined).map(box => ({ id: getNodeId(node), box })));
    labelBoxCache.set(frame, result);
  }
  return result;
}

/** Whether syntax `moved` keeps its distance from the rest of a frame: on each
 * row a node unit between centres, unless already nearer, and no label or word
 * box newly meeting another. `before` is the frame before the change. */
function keepsClear(moved: ReadonlySet<string>, before: Painted, after: Painted, measureCategoryText?: CategoryTextMeasure, target?: Painted) {
  const rows = new Map<number, Node[]>();
  for (const node of after.values()) {
    const row = Math.round(node.y / TREE_ROW_HEIGHT);
    rows.set(row, [...(rows.get(row) ?? []), node]);
  }
  for (const members of rows.values()) for (const a of members) {
    if (!moved.has(getNodeId(a))) continue;
    for (const b of members) {
      if (moved.has(getNodeId(b))) continue;
      // As near as the frame they wait for stands them is near enough.
      const ta = target?.get(getNodeId(a)), tb = target?.get(getNodeId(b));
      const there = ta && tb && Math.abs(ta.y - tb.y) < 1 ? Math.abs(ta.x - tb.x) : Infinity;
      const now = Math.abs(a.x - b.x), was = Math.abs(before.get(getNodeId(a))!.x - before.get(getNodeId(b))!.x);
      if (now < Math.min(TREE_SIBLING_GAP, was, there) - 1e-6) return false;
    }
  }
  const boxes = (frame: Painted, inside: boolean) => labelBoxes(frame, measureCategoryText).filter(entry => moved.has(entry.id) === inside);
  const meets = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
  const others = boxes(after, false), earlier = new Map(boxes(before, true).map(entry => [entry.id, entry.box]));
  const otherBefore = new Map(boxes(before, false).map(entry => [entry.id, entry.box]));
  for (const { id, box } of boxes(after, true)) for (const other of others) {
    if (!meets(box, other.box)) continue;
    const old = earlier.get(id), oldOther = otherBefore.get(other.id);
    if (!old || !oldOther || !meets(old, oldOther)) return false;
  }
  // Nor does a branch newly run through a label or word box.
  const crossed = branchCrossings(before, moved, measureCategoryText);
  for (const crossing of branchCrossings(after, moved, measureCategoryText)) if (!crossed.has(crossing)) return false;
  return true;
}

/** Whether the segment from (x1, y1) to (x2, y2) enters the box. */
function crossesBox(x1: number, y1: number, x2: number, y2: number, box: { x: number; y: number; width: number; height: number }) {
  let low = 0, high = 1;
  const dx = x2 - x1, dy = y2 - y1;
  for (const [p, q] of [[-dx, x1 - box.x], [dx, box.x + box.width - x1], [-dy, y1 - box.y], [dy, box.y + box.height - y1]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) low = Math.max(low, t); else high = Math.min(high, t);
    if (low > high) return false;
  }
  return high - low > 1e-6;
}

/** The branches (from a parent's label to its daughter's, words excepted) that
 * run through another node's text, line by line, among those touching syntax
 * `moved`. */
function branchCrossings(frame: Painted, moved: ReadonlySet<string>, measureCategoryText?: CategoryTextMeasure) {
  const result = new Set<string>(), byNode = new Map<string, LabelBox['box'][]>();
  for (const { id, box } of labelBoxes(frame, measureCategoryText)) byNode.set(id, [...(byNode.get(id) ?? []), box]);
  // A wrapped label's block box encloses its lines; the lines are the text.
  const inside = (outer: LabelBox['box'], inner: LabelBox['box']) => inner !== outer && inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
  const text = [...byNode].flatMap(([id, boxes]) => boxes.filter(box => !boxes.some(other => inside(box, other))).map(box => ({ id, box })));
  for (const parent of frame.values()) for (const child of parent.children ?? []) {
    const parentId = getNodeId(parent), childId = getNodeId(child);
    if (!frame.has(childId) || childId.endsWith('::__leaf')) continue;
    const touched = moved.has(parentId) || moved.has(childId);
    const from = Math.max(parent.y, ...(byNode.get(parentId) ?? []).map(box => box.y + box.height));
    const to = Math.min(child.y, ...(byNode.get(childId) ?? []).map(box => box.y));
    for (const { id, box } of text) {
      if (id === parentId || id === childId || id.replace(/::__leaf$/, '') === childId || !(touched || moved.has(id))) continue;
      if (crossesBox(parent.x, from, child.x, to, { x: box.x - BRANCH_CLEARANCE, y: box.y - BRANCH_CLEARANCE,
        width: box.width + 2 * BRANCH_CLEARANCE, height: box.height + 2 * BRANCH_CLEARANCE })) result.add(`${parentId}>${childId}|${id}`);
    }
  }
  return result;
}

/** The rule's faults at one step (`step` after `previous`) that the new frames
 * add, or make farther, over the old ones. */
function newFaults(previous: Scene, step: Scene, oldBefore: Painted, oldAfter: Painted, before: Painted, after: Painted) {
  const closing = Boolean(step.closing);
  const faults = (a: Painted, b: Painted) => faultCaches[Number(closing)](a, b, () => replayMotionFaults({ frames: [
    motionFrame(previous.step, a, getNodeId), motionFrame(step.step, b, getNodeId, closing)] }));
  const base = new Map(faults(oldBefore, oldAfter).map(fault => [`${fault.kind} ${fault.node}`, fault.distance]));
  return faults(before, after).filter(fault => fault.distance > (base.get(`${fault.kind} ${fault.node}`) ?? 0) + 1);
}

/** Branches that do not span one row below their parent, or daughters of one
 * parent on different rows (the visual audit's branch-geometry); words hang by
 * stems and are not branches. */
function branchFaults(frame: Painted) {
  const faults = new Set<string>();
  for (const [id, node] of frame) {
    const daughters = (node.children ?? []).filter(child => frame.has(getNodeId(child)) && !getNodeId(child).endsWith('::__leaf'));
    for (const daughter of daughters) if (Math.abs(daughter.y - node.y - TREE_ROW_HEIGHT) > 1) faults.add(`${id}>${getNodeId(daughter)}`);
    if (daughters.length && Math.max(...daughters.map(daughter => daughter.y)) - Math.min(...daughters.map(daughter => daughter.y)) > 1) faults.add(`${id} daughters`);
  }
  return faults;
}

/** Whether every painted parent of a frame keeps its daughters in order and above
 * them, and no branch leaves its row where it kept it in `old`, the frame before
 * the change. */
function ordered(frame: Painted, old: Painted) {
  for (const node of frame.values()) {
    const daughters = (node.children ?? []).filter(child => frame.has(getNodeId(child)));
    for (let index = 0; index < daughters.length; index++) {
      if (daughters[index].y <= node.y + 1e-6) return false;
      if (index && daughters[index].x <= daughters[index - 1].x + 1e-6) return false;
    }
  }
  const before = branchFaults(old);
  for (const fault of branchFaults(frame)) if (!before.has(fault)) return false;
  return true;
}

/** Holds syntax at the place a later step would move it to.
 *
 * Working back from the last step, a word or other painted leaf that a step moves
 * without carrying it (a stage relayout, a waiting piece travelling to its host, a
 * phrase reflowing) is instead given that step's place for its whole life before
 * it, from the frame it first appears in. A constant offset over that life moves
 * nothing at any earlier step, so only the frames' geometry and the step itself
 * change: leaves moving by one amount are tried together, and kept only when every
 * frame they change stays clear and ordered and no step moves anything farther. */
function holdBack(scenes: readonly Scene[], frames: Painted[], coordinates: Map<SyntaxNode, Map<string, { x: number; y: number }>>,
  firstScene: ReadonlyMap<SyntaxNode, number>, lastScene: ReadonlyMap<SyntaxNode, number>, paint: (scene: Scene) => Painted,
  measureCategoryText?: CategoryTextMeasure) {
  for (let k = scenes.length - 1; k >= 1; k--) {
    const step = scenes[k].step, before = frames[k - 1], after = frames[k];
    const carry = carryAt(scenes, k, before, after);
    const movers = new Set<string>();
    for (const id of trajectoryParticipants(step)) before.get(id)?.each(member => { movers.add(getNodeId(member)); });
    const granted = closingAt(scenes[k - 1].step, step, before, after, before, after, { closing: Boolean(scenes[k].closing) });
    // Phrases the step moves rigidly without carrying them: the highest painted
    // nodes all of whose painted members move by one shift.
    const shiftOf = (id: string) => { const node = after.get(id), old = before.get(id); return node && old ? { x: node.x - carry.x - old.x, y: node.y - carry.y - old.y } : undefined; };
    const rigid = new Map<string, boolean>();
    const isRigid = (node: Node, delta: { x: number; y: number }): boolean => {
      const own = shiftOf(getNodeId(node));
      if (!own || movers.has(getNodeId(node)) || granted.has(getNodeId(node)) || Math.hypot(own.x - delta.x, own.y - delta.y) > 1) return false;
      return (node.children ?? []).filter(child => before.has(getNodeId(child))).every(child => isRigid(child, delta));
    };
    const groups: { delta: { x: number; y: number }; members: Set<string>; first: string }[] = [];
    for (const [id, old] of before) {
      const delta = shiftOf(id);
      if (!delta || Math.hypot(delta.x, delta.y) < 20 || !isRigid(old, delta)) continue;
      rigid.set(id, true);
      const parent = shownParent(before, old);
      if (parent && shiftOf(parent) && isRigid(before.get(parent)!, delta)) continue;
      const members = new Set<string>();
      old.each(member => { if (before.has(getNodeId(member))) members.add(getNodeId(member)); });
      const group = groups.find(entry => Math.hypot(entry.delta.x - delta.x, entry.delta.y - delta.y) <= 1);
      if (group) for (const member of members) group.members.add(member); else groups.push({ delta, members, first: id });
    }
    // A waiting workspace whose words all shift by one amount waits there, at
    // the row its root takes (a parent inserted inside it lowers only its host).
    for (const [id, root] of before) {
      if (shownParent(before, root) || movers.has(id) || !after.has(id)) continue;
      const members: string[] = [];
      root.each(member => { if (before.has(getNodeId(member))) members.push(getNodeId(member)); });
      const words = members.filter(member => !before.get(member)!.children?.some(child => before.has(getNodeId(child))));
      const shifts = words.map(shiftOf);
      if (shifts.some(shift => !shift) || members.some(member => movers.has(member))) continue;
      const dx = shifts[0]!.x, dy = shiftOf(id)!.y;
      if (Math.abs(dx) < 20 || shifts.some(shift => Math.abs(shift!.x - dx) > 1)) continue;
      if (groups.some(group => group.first === id)) continue;
      groups.push({ delta: { x: dx, y: dy }, members: new Set(members), first: id });
      // Or at the row its words take, the root rising over the inserted parent.
      const wordRow = shifts[0]!.y;
      if (Math.abs(wordRow - dy) > 1 && shifts.every(shift => Math.abs(shift!.y - wordRow) <= 1))
        groups.push({ delta: { x: dx, y: wordRow }, members: new Set(members), first: `${id}@words` });
    }
    groups.sort((a, b) => b.members.size - a.members.size);
    // A host lowered under a parent the step inserts keeps its row before the
    // step: only its sideways shift is held.
    for (const group of groups) if (Math.abs(group.delta.y) > 1e-6 && before.has(group.first) && shownParent(before, before.get(group.first)!)) group.delta = { x: group.delta.x, y: 0 };
    // Each phrase alone, then all of them together, since a phrase can stand
    // clear of another only where that one also waits at its place.
    const attempts = groups.slice(0, 6).filter(group => Math.hypot(group.delta.x, group.delta.y) >= 20)
      .map(group => ({ first: group.first, shifts: new Map([...group.members].map(id => [id, group.delta] as const)) }));
    if (attempts.length > 1) attempts.push({ first: `${attempts.length} phrases`, shifts: new Map(attempts.flatMap(attempt => [...attempt.shifts])) });
    // Where its destination is taken while it waits, a phrase that travels far
    // may wait at the nearest clear place beside or below it, so that the step
    // moves it only that little way.
    const nearby: { first: string; shifts: Map<string, { x: number; y: number }>; residual: number }[] = [];
    for (const group of groups.slice(0, 6)) {
      const length = Math.hypot(group.delta.x, group.delta.y);
      if (length < 2 * TREE_SIBLING_GAP) continue;
      const near: { x: number; y: number }[] = [];
      for (const oy of [0, TREE_ROW_HEIGHT, 2 * TREE_ROW_HEIGHT, -TREE_ROW_HEIGHT])
        for (const ox of [0, TREE_SIBLING_GAP, -TREE_SIBLING_GAP, 2 * TREE_SIBLING_GAP, -2 * TREE_SIBLING_GAP])
          if ((ox || oy) && Math.hypot(ox, oy) < length / 2) near.push({ x: ox, y: oy });
      near.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
      for (const offset of near.slice(0, 12)) {
        const delta = { x: group.delta.x + offset.x, y: group.delta.y + offset.y };
        nearby.push({ first: `${group.first}~${offset.x},${offset.y}`, shifts: new Map([...group.members].map(id => [id, delta] as const)), residual: Math.hypot(offset.x, offset.y) });
      }
    }
    attempts.push(...nearby.sort((a, b) => a.residual - b.residual));
    const held = new Set<string>();
    for (const { shifts } of attempts) {
      if ([...shifts.keys()].some(id => held.has(id))) continue;
      const leaves = [...shifts.keys()];
      // Each member's life before this step.
      const births = leaves.map(id => { let start = k; while (start > 0 && frames[start - 1].has(id)) start--; return start; });
      const start = Math.min(...births);
      if (start === k) continue;
      const canvases = new Set(scenes.slice(start, k).map(scene => scene.canvas));
      if ([...canvases].some(canvas => lastScene.get(canvas)! >= k)) continue;
      const saved = new Map([...canvases].map(canvas => [canvas, new Map(coordinates.get(canvas)!)] as const));
      // A leaf's hidden material moves with it.
      for (let j = start; j < k; j++) {
        const points = coordinates.get(scenes[j].canvas)!;
        if (firstScene.get(scenes[j].canvas)! !== j) continue;
        // Each member painted here, with its hidden material.
        const moving = new Set(leaves.filter((_, index) => j >= births[index]));
        const done = new Set<string>();
        for (const id of moving) frames[j].get(id)?.each(member => {
          const memberId = getNodeId(member);
          if (done.has(memberId) || (memberId !== id && frames[j].has(memberId) && !moving.has(memberId))) return;
          done.add(memberId);
          const point = points.get(memberId);
          const shift = shifts.get(id)!;
          if (point) points.set(memberId, { x: point.x + shift.x, y: point.y + shift.y });
        });
      }
      // The stage size first: it is cheap, and most holds that fail fail it.
      const within = repaintWithinStageSize(scenes, frames, start, k, paint), repainted = within ?? [];
      const view = (index: number) => index >= start && index < k ? repainted[index - start] : frames[index];
      let ok = within !== null;
      for (let j = start; ok && j < k; j++) {
        const frame = repainted[j - start];
        const changed = new Set([...frame].filter(([id, node]) => { const old = frames[j].get(id); return !old || Math.hypot(old.x - node.x, old.y - node.y) > 1e-6; }).map(([id]) => id));
        if (!ordered(frame, frames[j])) ok = false;
        else if (changed.size && !keepsClear(changed, frames[j], frame, measureCategoryText, frames[k])) ok = false;
      }
      for (let j = Math.max(1, start); ok && j <= k; j++) {
        if (newFaults(scenes[j - 1], scenes[j], frames[j - 1], frames[j], view(j - 1), view(j)).length
          || !sameMotion(scenes, j, frames[j - 1], frames[j], view(j - 1), view(j))) ok = false;
        else if (newContinuityFaults(scenes[j - 1], scenes[j], frames[j - 1], frames[j], view(j - 1), view(j)).length) ok = false;
      }
      if (!ok) { for (const [canvas, points] of saved) coordinates.set(canvas, points); continue; }
      repainted.forEach((frame, index) => { frames[start + index] = frame; });
      for (const id of leaves) held.add(id);
    }
  }
}

/** Gives a movement's source the room its sisters need before it leaves.
 *
 * Before a movement the source keeps its earlier, wider form, while its parent's
 * sister may already stand where it will stand once the source has left: the two
 * then crowd on their row (a specifier tucked against v′ until the verb moves
 * out). Such a sister stands farther out over its whole life before the
 * movement, and the movement, which owns the closing, brings it back. Kept only
 * when the rule grants that closing, every changed frame stays clear and ordered,
 * and no other step moves anything farther. */
function openSourceRoom(scenes: readonly Scene[], frames: Painted[], coordinates: Map<SyntaxNode, Map<string, { x: number; y: number }>>,
  firstScene: ReadonlyMap<SyntaxNode, number>, lastScene: ReadonlyMap<SyntaxNode, number>, paint: (scene: Scene) => Painted,
  measureCategoryText?: CategoryTextMeasure) {
  for (let k = scenes.length - 1; k >= 1; k--) {
    const step = scenes[k].step, participants = trajectoryParticipants(step);
    if (!participants.length) continue;
    const before = frames[k - 1], after = frames[k];
    const departing = new Set<string>();
    for (const id of participants) before.get(id)?.each(member => { if (before.has(getNodeId(member)) && !after.has(getNodeId(member))) departing.add(getNodeId(member)); });
    for (const id of participants) { const node = before.get(id), now = after.get(id); if (node && now && shownParent(before, node) !== shownParent(after, now)) node.each(member => { departing.add(getNodeId(member)); }); }
    if (!departing.size) continue;
    for (const [parentId, parent] of before) {
      const daughters = (parent.children ?? []).filter(child => before.has(getNodeId(child)));
      for (let index = 1; index < daughters.length; index++) {
        const pair = [daughters[index - 1], daughters[index]];
        const holds = pair.map(node => { let any = false; node.each(member => { if (departing.has(getNodeId(member))) any = true; }); return any; });
        if (holds[0] === holds[1]) continue;
        const crowded = Math.abs(pair[1].x - pair[0].x), later = pair.map(node => after.get(getNodeId(node)));
        const there = later[0] && later[1] ? Math.abs(later[1].x - later[0].x) : TREE_SIBLING_GAP;
        if (crowded >= Math.min(TREE_SIBLING_GAP, there) - 1) continue;
        // The sister without the source stands out by what its row lacks.
        const side = holds[0] ? 1 : 0, sister = pair[side], sign = side ? 1 : -1, need = Math.min(TREE_SIBLING_GAP, there) - crowded;
        const own: string[] = [];
        sister.each(member => { if (before.has(getNodeId(member))) own.push(getNodeId(member)); });
        // With everything beyond it on its side when that is in the way too.
        const ancestors = new Set<string>(); for (let id: string | null = parentId; id; id = shownParent(before, before.get(id)!)) ancestors.add(id);
        const other = new Set<string>(); pair[1 - side].each(member => { other.add(getNodeId(member)); });
        const edge = sign < 0 ? Math.min(...own.map(id => before.get(id)!.x)) : Math.max(...own.map(id => before.get(id)!.x));
        const beyond = [...before.keys()].filter(id => !own.includes(id) && !departing.has(id) && !other.has(id) && !ancestors.has(id)
          && (sign < 0 ? before.get(id)!.x < edge : before.get(id)!.x > edge));
        // Or, first, the source's sister contents beyond it widen the source's
        // side instead, its parent recentring away by half their shift.
        const holder = pair[1 - side], far = holder.descendants().filter(member => before.has(getNodeId(member)) && !departing.has(getNodeId(member))
          && member !== holder && !departing.has(getNodeId(member)) && (sign < 0 ? member.x > Math.max(...[...departing].map(id => before.get(id)?.x ?? -Infinity)) : member.x < Math.min(...[...departing].map(id => before.get(id)?.x ?? Infinity))));
        const farIds = far.map(getNodeId).filter(id => { let up = before.get(id)!; for (let p = shownParent(before, up); p && p !== getNodeId(holder); p = shownParent(before, before.get(p)!)) if (departing.has(p)) return false; return true; });
        const outside = [...before.keys()].filter(id => !farIds.includes(id) && !departing.has(id) && !ancestors.has(id) && !other.has(id) && !own.includes(id)
          && (sign < 0 ? before.get(id)!.x > Math.max(...farIds.map(f => before.get(f)!.x)) : before.get(id)!.x < Math.min(...farIds.map(f => before.get(f)!.x))));
        const choices: { members: string[]; shift: number; later?: boolean }[] = [];
        if (farIds.length) choices.push({ members: [...farIds, ...outside], shift: -sign * 2 * need });
        choices.push({ members: own, shift: sign * need });
        if (beyond.length) choices.push({ members: [...own, ...beyond], shift: sign * need });
        // Or everything from the movement on stands over so far that the sister
        // and what lies beyond it hold still at the movement, each waiting
        // before it at its place there.
        const within = scenes[k - 1].step.replayFrameIndex === step.replayFrameIndex;
        if (within) choices.push({ members: [...own, ...beyond], shift: before.get(getNodeId(sister))!.x + sign * need - after.get(getNodeId(sister))!.x, later: true });
        for (const { members, shift, later } of choices) {
        if (later && (Math.abs(shift) < 1 || members.some(id => !after.has(id)))) continue;
        const amount = (id: string) => later ? after.get(id)!.x + shift - before.get(id)!.x : shift;
        const births = members.map(id => { let start = k; while (start > 0 && frames[start - 1].has(id)) start--; return start; });
        const start = Math.min(...births), end = later ? scenes.length : k;
        const canvases = new Set(scenes.slice(start, end).map(scene => scene.canvas));
        if ([...canvases].some(canvas => lastScene.get(canvas)! >= k && firstScene.get(canvas)! < k)) break;
        const saved = new Map([...canvases].map(canvas => [canvas, new Map(coordinates.get(canvas)!)] as const));
        for (let j = start; j < k; j++) {
          if (firstScene.get(scenes[j].canvas)! !== j) continue;
          const points = coordinates.get(scenes[j].canvas)!, done = new Set<string>();
          members.forEach((id, at) => {
            if (j < births[at]) return;
            const by = amount(id);
            frames[j].get(id)?.each(member => {
              const memberId = getNodeId(member);
              if (done.has(memberId) || (memberId !== id && frames[j].has(memberId) && !members.includes(memberId))) return;
              done.add(memberId);
              const point = points.get(memberId);
              if (point) points.set(memberId, { x: point.x + by, y: point.y });
            });
          });
        }
        if (later) for (const canvas of canvases) if (firstScene.get(canvas)! >= k)
          for (const [id, point] of coordinates.get(canvas)!) coordinates.get(canvas)!.set(id, { x: point.x + shift, y: point.y });
        const fits = repaintWithinStageSize(scenes, frames, start, end, paint, later ? SEAT_GROWTH : STAGE_GROWTH), repainted = fits ?? [];
        const view = (index: number) => index >= start && index < end ? repainted[index - start] : frames[index];
        let ok = fits !== null;
        for (let j = start; ok && j < k; j++) {
          const frame = repainted[j - start];
          const changed = new Set([...frame].filter(([id, node]) => { const old = frames[j].get(id); return !old || Math.hypot(old.x - node.x, old.y - node.y) > 1e-6; }).map(([id]) => id));
          if (!ordered(frame, frames[j])) ok = false;
          else if (changed.size && !keepsClear(changed, frames[j], frame, measureCategoryText, view(k))) ok = false;
        }
        for (let j = Math.max(1, start); ok && j <= k; j++) {
          if (newFaults(scenes[j - 1], scenes[j], frames[j - 1], frames[j], view(j - 1), view(j)).length) ok = false;
          else if (newContinuityFaults(scenes[j - 1], scenes[j], frames[j - 1], frames[j], view(j - 1), view(j)).length) ok = false;
          else if (j === k) {
            // At the movement only its closing and carried phrases move farther.
            const now = view(k), granted = closingAt(scenes[k - 1].step, step, view(k - 1), now, view(k - 1), now, { closing: Boolean(scenes[k].closing) });
            const movers = new Set<string>(); for (const id of participants) now.get(id)?.each(member => { movers.add(getNodeId(member)); });
            // Across a crossing, motion is measured after the camera carry.
            const carryNow = carryAt(scenes, k, view(k - 1), now), carryWas = carryAt(scenes, k, frames[k - 1], after);
            for (const [id, node] of now) {
              const was = frames[k - 1].get(id), prior = view(k - 1).get(id), old = after.get(id);
              if (!was || !prior || !old || granted.has(id) || movers.has(id)) continue;
              if (Math.hypot(node.x - carryNow.x - prior.x, node.y - carryNow.y - prior.y)
                > Math.hypot(old.x - carryWas.x - was.x, old.y - carryWas.y - was.y) + 1) { ok = false; break; }
            }
          }
          else if (j < k && !sameMotion(scenes, j, frames[j - 1], frames[j], view(j - 1), view(j))) ok = false;
        }
        if (!ok) { for (const [canvas, points] of saved) coordinates.set(canvas, points); continue; }
        repainted.forEach((frame, index) => { frames[start + index] = frame; });
        break;
        }
      }
    }
  }
}

type Context = { scenes: readonly Scene[]; frames: Painted[]; coordinates: Map<SyntaxNode, Map<string, { x: number; y: number }>>;
  firstScene: ReadonlyMap<SyntaxNode, number>; lastScene: ReadonlyMap<SyntaxNode, number>; paint: (scene: Scene) => Painted;
  measureCategoryText?: CategoryTextMeasure; inkOf: (scene: Scene, nodes: readonly Node[]) => PlaqueRect[];
  plaques: PlaqueRoom; steps: readonly PlaybackStep[] };
type InkMeasures = { measureTreeInk?: TreeInkTextMeasure; treeLabelRuns?: PreparedTreeLabelRuns; measureTreeLabel?: TreeLabelMeasure };

/** Moves `members` by `amount(id)` over their lives before step `k` (with their
 * hidden material) and every frame from `k` on by `later`, and keeps the change
 * only when every changed frame stays ordered and clear and the stages keep their
 * size, no step before `k` moves anything farther or newly breaks continuity, and
 * at `k` only the step's closing, carried phrases and owned syntax move farther.
 * Returns a reason when the change is refused. */
function tryShift(context: Context, k: number, members: readonly string[], amount: (id: string) => number, later: number, growth = STAGE_GROWTH,
  lowered: ReadonlySet<string> = new Set(), accept?: (prior: Painted, now: Painted) => boolean) {
  const { scenes, frames, coordinates, firstScene, lastScene, paint, measureCategoryText } = context;
  const step = scenes[k].step, participants = trajectoryParticipants(step), after = frames[k];
  const births = members.map(id => { let start = k; while (start > 0 && frames[start - 1].has(id)) start--; return start; });
  const start = Math.min(...births), end = later ? scenes.length : k;
  const canvases = new Set(scenes.slice(start, end).map(scene => scene.canvas));
  if ([...canvases].some(canvas => lastScene.get(canvas)! >= k && firstScene.get(canvas)! < k)) return 'shared canvas';
  const saved = new Map([...canvases].map(canvas => [canvas, new Map(coordinates.get(canvas)!)] as const));
  for (let j = start; j < k; j++) {
    if (firstScene.get(scenes[j].canvas)! !== j) continue;
    const points = coordinates.get(scenes[j].canvas)!, done = new Set<string>();
    members.forEach((id, at) => {
      if (j < births[at]) return;
      const by = amount(id);
      frames[j].get(id)?.each(member => {
        const memberId = getNodeId(member);
        if (done.has(memberId) || (memberId !== id && frames[j].has(memberId) && !members.includes(memberId))) return;
        done.add(memberId);
        const point = points.get(memberId);
        if (point) points.set(memberId, { x: point.x + by, y: point.y });
      });
    });
  }
  if (later) for (const canvas of canvases) if (firstScene.get(canvas)! >= k)
    for (const [id, point] of coordinates.get(canvas)!) coordinates.get(canvas)!.set(id, { x: point.x + later, y: point.y });
  const within = repaintWithinStageSize(scenes, frames, start, end, paint, growth), repainted = within ?? [];
  const view = (index: number) => index >= start && index < end ? repainted[index - start] : frames[index];
  let reason = within ? '' : 'stage size';
  // The checks are independent; the cheaper motion rule runs before clearance.
  for (let j = Math.max(1, start); !reason && j <= k; j++)
    if (newFaults(scenes[j - 1], scenes[j], frames[j - 1], frames[j], view(j - 1), view(j)).length) reason = `faults at ${j + 1}`;
  for (let j = start; !reason && j < k; j++) {
    const frame = repainted[j - start];
    const changed = new Set([...frame].filter(([id, node]) => { const old = frames[j].get(id); return !old || Math.hypot(old.x - node.x, old.y - node.y) > 1e-6; }).map(([id]) => id));
    if (!ordered(frame, frames[j])) reason = `order at ${j + 1}`;
    else if (changed.size && !keepsClear(changed, frames[j], frame, measureCategoryText, view(k))) reason = `clearance at ${j + 1}`;
  }
  for (let j = Math.max(1, start); !reason && j <= k; j++) {
    if (newContinuityFaults(scenes[j - 1], scenes[j], frames[j - 1], frames[j], view(j - 1), view(j)).length) reason = `continuity at ${j + 1}`;
    else if (j === k) {
      const now = view(k), prior = view(k - 1), granted = closingAt(scenes[k - 1].step, step, prior, now, prior, now, { closing: Boolean(scenes[k].closing) });
      const movers = new Set<string>(); for (const id of participants) now.get(id)?.each(member => { movers.add(getNodeId(member)); });
      const carryNow = carryAt(scenes, k, prior, now), carryWas = carryAt(scenes, k, frames[k - 1], after);
      for (const [id, node] of now) {
        const was = frames[k - 1].get(id), before = prior.get(id), old = after.get(id);
        if (!was || !before || !old || granted.has(id) || movers.has(id)) continue;
        // Lowered syntax drops the row its inserted parent takes; only its horizontal motion counts.
        const dy = (a: number, b: number) => lowered.has(id) ? 0 : a - b;
        if (Math.hypot(node.x - carryNow.x - before.x, dy(node.y - carryNow.y, before.y)) > Math.hypot(old.x - carryWas.x - was.x, dy(old.y - carryWas.y, was.y)) + 1) { reason = `ungranted ${id}`; break; }
      }
    }
    else if (j < k && !sameMotion(scenes, j, frames[j - 1], frames[j], view(j - 1), view(j))) reason = `motion at ${j + 1}`;
  }
  if (!reason && accept && !accept(view(k - 1), view(k))) reason = NO_GAIN;
  if (reason) { for (const [canvas, points] of saved) coordinates.set(canvas, points); return reason; }
  repainted.forEach((frame, index) => { frames[start + index] = frame; });
  return '';
}

/** Seats a head that joins a movement's landing where it can wait clear.
 *
 * A head selected apart (a C waiting for the verb to move into it) is often
 * planned beside the movement's source, tight against syntax that is about to
 * leave, and then repositions when the landing arrives beside it. Where such a
 * head moves at the movement as one rigid piece, every frame from the movement
 * on stands over so far that the head's place there is a place where it waits
 * clear of its row before, and it waits there from its selection: it then
 * appears where it stays and the rest of the movement's side closes instead,
 * which the movement owns. The nearest such place is kept that every check
 * accepts; failing that, the head keeps its place and only the later frames
 * stand over. */
function seatReceivingHeads(context: Context) {
  const { scenes, frames } = context;
  for (let k = scenes.length - 1; k >= 1; k--) {
    const step = scenes[k].step, participants = trajectoryParticipants(step);
    if (!participants.length || scenes[k - 1].step.replayFrameIndex !== step.replayFrameIndex) continue;
    const before = frames[k - 1], after = frames[k];
    const movers = new Set<string>(); for (const id of participants) after.get(id)?.each(member => { movers.add(getNodeId(member)); });
    for (const [rootId, root] of before) {
      const now = after.get(rootId);
      if (shownParent(before, root) || !now || movers.has(rootId)) continue;
      const parent = shownParent(after, now);
      if (!parent || before.has(parent)) continue;
      const members: string[] = [];
      root.each(member => { if (before.has(getNodeId(member))) members.push(getNodeId(member)); });
      if (members.some(id => movers.has(id) || !after.has(id))) continue;
      const delta = after.get(rootId)!.x - root.x;
      if (Math.abs(delta) < 20 || members.some(id => Math.abs(after.get(id)!.x - before.get(id)!.x - delta) > 1 || Math.abs(after.get(id)!.y - before.get(id)!.y) > 1)) continue;
      // How far the head's place at the movement stands from the nearest syntax
      // on its rows over its wait, for a shift `later` of the frames from k on.
      const births = members.map(id => { let start = k; while (start > 0 && frames[start - 1].has(id)) start--; return start; });
      const start = Math.min(...births);
      const clearance = (later: number) => {
        let least = Infinity;
        for (let j = start; j < k; j++) for (const id of members) {
          const node = frames[j].get(id);
          if (!node) continue;
          const x = after.get(id)!.x + later;
          for (const other of frames[j].values()) if (!members.includes(getNodeId(other)) && Math.abs(other.y - node.y) < 1) least = Math.min(least, Math.abs(other.x - x));
        }
        return least;
      };
      const candidates: number[] = [];
      for (let step = 1; step <= 8; step++) for (const sign of [-1, 1]) {
        const later = -delta + sign * step * TREE_SIBLING_GAP / 4;
        if (clearance(later) >= TREE_SIBLING_GAP - 1) candidates.push(later);
      }
      candidates.sort((a, b) => Math.abs(a + delta) - Math.abs(b + delta));
      // The nearest four clear shifts, then the head's own place as the fallback.
      for (const later of [...candidates.slice(0, 4), -delta]) {
        const reason = tryShift(context, k, members, id => after.get(id)!.x + later - before.get(id)!.x, later, SEAT_GROWTH);
        if (!reason) break;
      }
    }
  }
}

/** Moves each node of `shifts` with everything below it by its amount in every
 * frame from step `k` on where it is painted, and keeps the change only when
 * every changed frame stays ordered and clear and the stages keep their size, no
 * step from `k` on moves anything farther or newly breaks continuity, and no
 * step after `k` changes its motion. Returns a reason when refused. */
function tryShiftForward(context: Context, k: number, shifts: ReadonlyMap<string, number>) {
  const { scenes, frames, coordinates, firstScene, lastScene, paint, measureCategoryText } = context;
  if (lastScene.get(scenes[k - 1].canvas)! >= k) return 'shared canvas';
  let end = k;
  while (end < scenes.length && [...shifts.keys()].some(id => frames[end].has(id))) end++;
  const canvases = new Set(scenes.slice(k, end).map(scene => scene.canvas));
  if ([...canvases].some(canvas => lastScene.get(canvas)! >= end)) return 'shared canvas';
  const saved = new Map([...canvases].map(canvas => [canvas, new Map(coordinates.get(canvas)!)] as const));
  for (let j = k; j < end; j++) {
    if (firstScene.get(scenes[j].canvas)! !== j) continue;
    const points = coordinates.get(scenes[j].canvas)!, root = d3.hierarchy(scenes[j].canvas); applyVizIds(root);
    const done = new Set<string>();
    root.each(node => {
      const by = shifts.get(getNodeId(node));
      if (by === undefined || !frames[j].has(getNodeId(node))) return;
      node.each(member => {
        const id = getNodeId(member), point = points.get(id);
        if (done.has(id) || !point) return;
        done.add(id);
        points.set(id, { x: point.x + by, y: point.y });
      });
    });
  }
  const within = repaintWithinStageSize(scenes, frames, k, end, paint), repainted = within ?? [];
  const view = (index: number) => index >= k && index < end ? repainted[index - k] : frames[index];
  let reason = within ? '' : 'stage size';
  for (let j = k; !reason && j < end; j++) {
    const frame = repainted[j - k];
    const changed = new Set([...frame].filter(([id, node]) => { const old = frames[j].get(id); return !old || Math.hypot(old.x - node.x, old.y - node.y) > 1e-6; }).map(([id]) => id));
    if (!ordered(frame, frames[j])) reason = `order at ${j + 1}`;
    else if (changed.size && !keepsClear(changed, frames[j], frame, measureCategoryText)) reason = `clearance at ${j + 1}`;
  }
  for (let j = k; !reason && j <= Math.min(end, scenes.length - 1); j++) {
    if (newFaults(scenes[j - 1], scenes[j], frames[j - 1], frames[j], view(j - 1), view(j)).length) reason = `faults at ${j + 1}`;
    else if (newContinuityFaults(scenes[j - 1], scenes[j], frames[j - 1], frames[j], view(j - 1), view(j)).length) reason = `continuity at ${j + 1}`;
    else if (j > k && !sameMotion(scenes, j, frames[j - 1], frames[j], view(j - 1), view(j))) reason = `motion at ${j + 1}`;
  }
  if (reason) { for (const [canvas, points] of saved) coordinates.set(canvas, points); return reason; }
  repainted.forEach((frame, index) => { frames[k + index] = frame; });
  return '';
}

/** Holds unmoved syntax across a stage crossing.
 *
 * Each stage is planned on its own, so a crossing can re-spread syntax that no
 * step moves: phrases shift by different amounts and, after the camera carry,
 * appear to jump. Where a phrase that the crossing's step does not carry shifts
 * rigidly, it keeps, from the crossing on, the place it had before relative to
 * the carry: its own later frames all stand over by the amount it would have
 * jumped. Each such phrase is tried alone and then all of them together. */
function holdAcrossCrossings(context: Context) {
  const { scenes, frames } = context;
  for (let k = 1; k < scenes.length; k++) {
    const step = scenes[k].step;
    if (scenes[k - 1].step.replayFrameIndex === step.replayFrameIndex) continue;
    const before = frames[k - 1], after = frames[k];
    const carry = carryAt(scenes, k, before, after);
    const movers = new Set<string>();
    for (const id of trajectoryParticipants(step)) before.get(id)?.each(member => { movers.add(getNodeId(member)); });
    const granted = closingAt(scenes[k - 1].step, step, before, after, before, after, { closing: Boolean(scenes[k].closing) });
    const shiftOf = (id: string) => { const node = after.get(id), old = before.get(id); return node && old ? { x: node.x - carry.x - old.x, y: node.y - carry.y - old.y } : undefined; };
    const isRigid = (node: Node, dx: number): boolean => {
      const own = shiftOf(getNodeId(node));
      if (!own || movers.has(getNodeId(node)) || granted.has(getNodeId(node)) || Math.abs(own.y) > 1 || Math.abs(own.x - dx) > 1) return false;
      if (shownParent(before, node) !== shownParent(after, after.get(getNodeId(node))!)) return false;
      return (node.children ?? []).filter(child => before.has(getNodeId(child))).every(child => isRigid(child, dx));
    };
    const groups: { dx: number; members: string[]; first: string }[] = [];
    for (const [id, old] of before) {
      const own = shiftOf(id);
      if (!own || Math.abs(own.x) < 20 || !isRigid(old, own.x)) continue;
      const parent = shownParent(before, old);
      if (parent && shiftOf(parent) && isRigid(before.get(parent)!, own.x)) continue;
      const members: string[] = [];
      old.each(member => { if (before.has(getNodeId(member))) members.push(getNodeId(member)); });
      groups.push({ dx: own.x, members, first: id });
    }
    // Or every painted leaf the step does not carry, each at its own place.
    const leaves = new Map<string, number>();
    for (const [id, old] of before) {
      const own = shiftOf(id);
      if (!own || movers.has(id) || granted.has(id) || old.children?.some(child => before.has(getNodeId(child))) || Math.abs(own.y) > 1 || Math.abs(own.x) <= 1) continue;
      if (shownParent(before, old) !== shownParent(after, after.get(id)!)) continue;
      leaves.set(id, -own.x);
    }
    if (!groups.length && !leaves.size) continue;
    groups.sort((a, b) => b.members.length - a.members.length);
    const attempts = groups.slice(0, 6).map(group => ({ first: group.first, shifts: new Map([[group.first, -group.dx]]) }));
    if (attempts.length > 1) attempts.unshift({ first: `${attempts.length} phrases`, shifts: new Map(attempts.flatMap(attempt => [...attempt.shifts])) });
    if (leaves.size) attempts.unshift({ first: `${leaves.size} leaves`, shifts: leaves });
    const held = new Set<string>();
    for (const { shifts } of attempts) {
      if ([...shifts.keys()].some(id => held.has(id))) continue;
      const reason = tryShiftForward(context, k, shifts);
      if (!reason) for (const id of shifts.keys()) held.add(id);
    }
  }
}

/** Holds a subtree that a stage crossing lowers under an inserted parent at the
 * place it stands in after the crossing.
 *
 * Each stage lays out its own tree, so the stage after a crossing that inserts
 * a parent above an existing subtree (an extraposition's new IP, a landing's
 * new projection) lays the lowered subtree out again: its words often stand
 * sideways of where they stood, beside syntax the crossing leaves in place,
 * and it slides there on screen, or the camera follows it and the held syntax
 * jumps. Where the lowered words all shift by one amount against the held
 * syntax (the nodes carryReference holds), the subtree, with what it carries,
 * stands over by that amount over its whole life before the crossing, so at
 * the crossing it only drops the row the new parent takes, and the camera carry
 * holds the syntax beside it (carryReference). Where the earlier frames have
 * no room for the whole amount, the largest of three quarters, a half or a
 * quarter of it is held, so the slide shrinks. Kept only when the crossing's
 * motion faults shrink and tryShift's checks hold, which keep every stage's
 * size: a hold that needs a wider earlier stage is refused. */
function holdLoweredSubtrees(context: Context) {
  const { scenes, frames } = context;
  const points = (frame: Painted): PaintedNodes => new Map([...frame].map(([id, node]) => [id, { x: node.x, y: node.y, parentId: shownParent(frame, node) }]));
  const lineage = (nodes: PaintedNodes, id: string) => {
    const ids: string[] = [];
    for (let parent = nodes.get(id)!.parentId; parent && nodes.has(parent); parent = nodes.get(parent)!.parentId) ids.push(parent);
    return ids;
  };
  const median = (values: number[]) => { values.sort((a, b) => a - b); return (values[(values.length - 1) >> 1] + values[values.length >> 1]) / 2; };
  const faultSum = (k: number, prior: Painted, now: Painted) => replayMotionFaults({ frames: [motionFrame(scenes[k - 1].step, prior, getNodeId),
    motionFrame(scenes[k].step, now, getNodeId, Boolean(scenes[k].closing))] }).reduce((sum, fault) => sum + fault.distance, 0);
  for (let k = 1; k < scenes.length; k++) {
    const step = scenes[k].step;
    if (scenes[k - 1].step.replayFrameIndex === step.replayFrameIndex) continue;
    const before = points(frames[k - 1]), after = points(frames[k]);
    // carryReference's partition of the shared syntax.
    const shared = [...after.keys()].filter(id => before.has(id));
    const unmoved = shared.filter(id => {
      const prior = lineage(before, id).filter(ancestor => after.has(ancestor)), current = lineage(after, id).filter(ancestor => before.has(ancestor));
      return prior.length === current.length && prior.every((ancestor, index) => ancestor === current[index]);
    });
    const lowered = new Set(unmoved.filter(id => lineage(before, id).some((ancestor, index) => ancestor !== lineage(after, id)[index])));
    if (!lowered.size) continue;
    const over = new Set([...lowered].flatMap(id => lineage(after, id)));
    const held = unmoved.filter(id => !lowered.has(id) && !over.has(id));
    if (!held.length) continue;
    const reference = median(held.map(id => after.get(id)!.x - before.get(id)!.x));
    const movers = new Set<string>();
    for (const id of trajectoryParticipants(step)) frames[k - 1].get(id)?.each(member => { movers.add(getNodeId(member)); });
    for (const root of [...lowered].filter(id => !lowered.has(after.get(id)!.parentId ?? ''))) {
      const node = frames[k - 1].get(root);
      if (!node) continue;
      const members: string[] = [];
      node.each(member => { if (frames[k - 1].has(getNodeId(member))) members.push(getNodeId(member)); });
      const words = members.filter(id => lowered.has(id) && !movers.has(id) && !frames[k - 1].get(id)!.children?.some(child => frames[k - 1].has(getNodeId(child))));
      if (!words.length) continue;
      const shifts = words.map(id => after.get(id)!.x - before.get(id)!.x - reference);
      const shift = median(shifts);
      if (Math.abs(shift) < NOTICED || shifts.some(value => Math.abs(value - shift) > 1)) continue;
      const was = faultSum(k, frames[k - 1], frames[k]);
      // The whole shift, or failing that the largest part of it every check allows.
      for (const part of [1, 0.75, 0.5, 0.25]) {
        if (Math.abs(part * shift) < NOTICED) break;
        const refused = tryShift(context, k, members, () => part * shift, 0, STAGE_GROWTH, lowered,
          (prior, now) => faultSum(k, prior, now) < was - 1);
        // A hold every check allows that does not shrink the crossing's motion is not worth a smaller one.
        if (!refused || refused === NO_GAIN) break;
      }
    }
  }
}

/** Seats a movement's landing as near the sister it joins as its ink allows.
 *
 * A landing that joins an existing parent beside a sister is laid out at its
 * stage's own spacing, which can stand it far from that sister: the parent then
 * recentres far over the new pair at the movement, and the phrase above it, which
 * keeps its daughters, changes shape. From the movement on, the landing stands
 * nearer its sister, its ink COMPACT_INK_CLEARANCE from all other ink on that
 * side (the clearance the receiving component's compaction keeps,
 * currentRootCompaction.ts), and no nearer than leaves its parent where it stood
 * before. Where a fork inside the landing keeps a head and its host wider than
 * the sibling gap while their ink stands more than HEAD_HOST_INK_GAP apart, the
 * phrase keeps that fork at the sibling gap over its whole life, source and
 * landing alike, when that lets the landing stand nearer: it never changes shape.
 * Kept only where the movement's motion faults shrink and every check holds
 * (checkLifetimeShift). */
function seatLandings(context: Context) {
  const { scenes } = context;
  const faultSum = (k: number, prior: Painted, now: Painted) => replayMotionFaults({ frames: [motionFrame(scenes[k - 1].step, prior, getNodeId),
    motionFrame(scenes[k].step, now, getNodeId, Boolean(scenes[k].closing))] }).reduce((sum, fault) => sum + fault.distance, 0);
  const daughters = (frame: Painted, node: Node) => (node.children ?? []).filter(child => frame.has(getNodeId(child)));
  for (let k = 1; k < scenes.length; k++) {
    const step = scenes[k].step, frames = context.frames;
    if (!trajectoryParticipants(step).length) continue;
    const before = frames[k - 1], after = frames[k], landingId = step.targetNodeId;
    const landing = landingId ? after.get(landingId) : undefined;
    if (!landingId || !landing || before.has(landingId)) continue;
    const parentId = shownParent(after, landing);
    if (!parentId || !before.has(parentId)) continue;
    const pair = daughters(after, after.get(parentId)!);
    if (pair.length !== 2 || !pair.includes(landing)) continue;
    const sister = pair.find(node => node !== landing)!, sisterBefore = before.get(getNodeId(sister));
    if (!sisterBefore || shownParent(before, sisterBefore) !== parentId) continue;
    const side = landing.x < sister.x ? 1 : -1;
    const was = faultSum(k, before, after);
    if (was <= 1) continue;
    // The forks inside the landing that hold a head and its host wider than the sibling gap.
    const forks = new Map<string, number>();
    landing.each(node => {
      const parts = daughters(after, node);
      if (parts.length !== 2) return;
      for (const [head, host] of [[parts[0], parts[1]], [parts[1], parts[0]]]) {
        const headNodes = head.descendants().filter(member => after.has(getNodeId(member)));
        if (headNodes.some(member => daughters(after, member).length > 1) || !daughters(after, host).length) continue;
        const headInk = context.inkOf(scenes[k], headNodes);
        const hostInk = context.inkOf(scenes[k], host.descendants().filter(member => after.has(getNodeId(member))));
        if (!headInk.length || !hostInk.length) break;
        const gap = head === parts[0] ? Math.min(...hostInk.map(box => box.x)) - Math.max(...headInk.map(box => box.x + box.width))
          : Math.min(...headInk.map(box => box.x)) - Math.max(...hostInk.map(box => box.x + box.width));
        const amount = Math.min(gap - HEAD_HOST_INK_GAP, Math.abs(head.x - host.x) - TREE_SIBLING_GAP);
        // Each daughter closes half the amount on the fork's centre, which stays.
        if (amount > 1e-6) { forks.set(getNodeId(parts[0]), amount / 2); forks.set(getNodeId(parts[1]), -amount / 2); }
        break;
      }
    });
    for (const inward of forks.size ? [forks, new Map<string, number>()] : [forks]) {
      // How far the landing may come toward its sister, with these forks kept:
      // its ink keeps the clearance from all other ink on that side in every frame
      // it stands in from the movement on.
      const trial = applyLifetimeShift(context, k, inward, landingId, 0);
      if (!trial) continue;
      let room = Infinity;
      for (let j = k; j < scenes.length; j++) {
        const frame = trial.view(j), node = frame.get(landingId);
        if (!node) break;
        const own = new Set(node.descendants().map(getNodeId)), above = new Set(node.ancestors().map(getNodeId));
        const mine = context.inkOf(scenes[j], node.descendants().filter(member => frame.has(getNodeId(member))));
        const others = context.inkOf(scenes[j], [...frame.values()].filter(other => !own.has(getNodeId(other)) && !above.has(getNodeId(other))));
        for (const a of mine) for (const b of others) {
          if (Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y)) continue;
          const space = side > 0 ? b.x - a.x - a.width : a.x - b.x - b.width;
          if (space >= -1e-6) room = Math.min(room, space);
        }
      }
      trial.undo();
      room -= COMPACT_INK_CLEARANCE;
      if (!(room > 1e-6) || !Number.isFinite(room)) continue;
      // No farther than leaves the parent where it stood before the movement.
      const carry = carryAt(scenes, k, before, after);
      const back = 2 * side * (before.get(parentId)!.x - (after.get(parentId)!.x - carry.x));
      const shift = applyLifetimeShift(context, k, inward, landingId, side * (back > 1e-6 ? Math.min(room, back) : room));
      if (!shift) continue;
      if (!checkLifetimeShift(context, k, landingId, shift) && faultSum(k, shift.view(k - 1), shift.view(k)) < was - 1) { shift.commit(); break; }
      shift.undo();
    }
  }
}

/** Whether the step into scene `j` moves no syntax it does not own farther from
 * `before` to `after` than from `oldBefore` to `oldAfter`, after the camera carry
 * of a crossing: sameMotion, except that what the step owns (ownedBy: its target
 * and trajectories, new or reattached syntax, the ancestors recentring over them)
 * may move differently, as the motion rule lets it. */
function keepsUnownedMotion(scenes: readonly Scene[], j: number, oldBefore: Painted, oldAfter: Painted, before: Painted, after: Painted) {
  if (sameMotion(scenes, j, oldBefore, oldAfter, before, after)) return true;
  const was = carryAt(scenes, j, oldBefore, oldAfter), now = carryAt(scenes, j, before, after);
  const owned = ownedBy(scenes[j].step, before, after), ownedWas = ownedBy(scenes[j].step, oldBefore, oldAfter);
  for (const [id, node] of after) {
    const prior = before.get(id), old = oldAfter.get(id), oldPrior = oldBefore.get(id);
    if (!prior || !old || !oldPrior || (owned.has(id) && ownedWas.has(id))) continue;
    if (Math.hypot(node.x - now.x - prior.x, node.y - now.y - prior.y) > Math.hypot(old.x - was.x - oldPrior.x, old.y - was.y - oldPrior.y) + 1e-6) return false;
  }
  return true;
}

type LifetimeShift = { start: number; end: number; repainted: Painted[]; moved: ReadonlySet<string>[];
  view: (index: number) => Painted; undo: () => void; commit: () => void };

/** Moves each node of `inward` with everything below it by its amount over its
 * whole life, and node `landing` with everything below it by `by` from step `k`
 * on, in every canvas that paints it; null when a canvas spans the movement. The
 * frames from the first changed one are repainted, but kept only on `commit`;
 * `undo` restores the coordinates. */
function applyLifetimeShift(context: Context, k: number, inward: ReadonlyMap<string, number>, landing: string, by: number): LifetimeShift | null {
  const { scenes, frames, coordinates, firstScene, lastScene, paint } = context;
  if (lastScene.get(scenes[k - 1].canvas)! >= k) return null;
  // Each daughter of a packed fork carries what stands below it at the movement,
  // from the frame each piece first appears in.
  const carried = new Map<string, number>();
  for (const [id, amount] of inward) frames[k].get(id)?.each(member => { carried.set(getNodeId(member), (carried.get(getNodeId(member)) ?? 0) + amount); });
  let start = k;
  for (const id of carried.keys()) for (let j = 0; j < start; j++) if (frames[j].has(id)) { start = j; break; }
  const end = scenes.length;
  const painted = new Map<SyntaxNode, Set<string>>();
  for (let j = start; j < end; j++) {
    const ids = painted.get(scenes[j].canvas) ?? new Set<string>();
    for (const id of frames[j].keys()) ids.add(id);
    painted.set(scenes[j].canvas, ids);
  }
  if ([...painted.keys()].some(canvas => firstScene.get(canvas)! < start)) return null;
  const saved = new Map<SyntaxNode, Map<string, { x: number; y: number }>>();
  for (const [canvas, ids] of painted) {
    const points = coordinates.get(canvas)!, root = d3.hierarchy(canvas); applyVizIds(root);
    const after = firstScene.get(canvas)! >= k;
    const next = new Map(points);
    root.each(node => {
      let dx = carried.get(getNodeId(node)) ?? 0;
      if (after && node.ancestors().some(ancestor => getNodeId(ancestor) === landing && ids.has(landing))) dx += by;
      const point = points.get(getNodeId(node));
      if (dx && point) next.set(getNodeId(node), { x: point.x + dx, y: point.y });
    });
    saved.set(canvas, points);
    coordinates.set(canvas, next);
  }
  const repainted = scenes.slice(start, end).map(paint);
  const moved = repainted.map((frame, index) => new Set([...frame].filter(([id, node]) => {
    const old = frames[start + index].get(id);
    return !old || Math.hypot(old.x - node.x, old.y - node.y) > 1e-6;
  }).map(([id]) => id)));
  const view = (index: number) => index >= start && index < end ? repainted[index - start] : context.frames[index];
  return { start, end, repainted, moved, view,
    undo: () => { for (const [canvas, points] of saved) coordinates.set(canvas, points); },
    commit: () => { repainted.forEach((frame, index) => { context.frames[start + index] = frame; }); } };
}

/** Why a lifetime shift is refused, or '' when every check holds: the stages keep
 * their size, no step moves anything farther, newly breaks continuity, or
 * (other than the movement `k` itself) changes its motion; the movement moves
 * nothing it does not carry or grant farther; every frame stays ordered; the
 * moved ink meets no other ink, nor comes within COMPACT_INK_CLEARANCE of it,
 * where it did not before, and no branch newly runs through text; and every
 * proximity plaque keeps its room. */
function checkLifetimeShift(context: Context, k: number, landing: string, shift: LifetimeShift) {
  const { scenes, frames, measureCategoryText } = context;
  const { start, end, repainted, moved, view } = shift;
  const changed = new Map(repainted.map((frame, index) => [start + index, frame]));
  if (!keepsStageSize(scenes, frames, changed)) return 'stage size';
  for (let j = Math.max(1, start); j < end; j++) {
    if (newFaults(scenes[j - 1], scenes[j], frames[j - 1], frames[j], view(j - 1), view(j)).length) return `faults at ${j + 1}`;
    if (newContinuityFaults(scenes[j - 1], scenes[j], frames[j - 1], frames[j], view(j - 1), view(j)).length) return `continuity at ${j + 1}`;
    if (j !== k && !keepsUnownedMotion(scenes, j, frames[j - 1], frames[j], view(j - 1), view(j))) return `motion at ${j + 1}`;
  }
  {
    const now = view(k), prior = view(k - 1), step = scenes[k].step;
    const granted = closingAt(scenes[k - 1].step, step, prior, now, prior, now, { closing: Boolean(scenes[k].closing) });
    const movers = new Set<string>(); for (const id of trajectoryParticipants(step)) now.get(id)?.each(member => { movers.add(getNodeId(member)); });
    const carryNow = carryAt(scenes, k, prior, now), carryWas = carryAt(scenes, k, frames[k - 1], frames[k]);
    for (const [id, node] of now) {
      const was = frames[k - 1].get(id), before = prior.get(id), old = frames[k].get(id);
      if (!was || !before || !old || granted.has(id) || movers.has(id)) continue;
      if (Math.hypot(node.x - carryNow.x - before.x, node.y - carryNow.y - before.y) > Math.hypot(old.x - carryWas.x - was.x, old.y - carryWas.y - was.y) + 1) return `ungranted ${id}`;
    }
  }
  for (let j = start; j < end; j++) {
    const frame = view(j), old = frames[j], shifted = moved[j - start];
    if (!ordered(frame, old)) return `order at ${j + 1}`;
    if (!shifted.size) continue;
    const ink = (nodes: Painted, inside: boolean) => context.inkOf(scenes[j], [...nodes.values()].filter(node => shifted.has(getNodeId(node)) === inside));
    // The least horizontal space between the moved ink and other ink on its rows; overlapping ink counts as negative.
    const least = (nodes: Painted) => {
      let result = Infinity;
      const others = ink(nodes, false);
      for (const a of ink(nodes, true)) for (const b of others)
        if (Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)) result = Math.min(result, Math.max(b.x - a.x - a.width, a.x - b.x - b.width));
      return result;
    };
    if (least(frame) < Math.min(COMPACT_INK_CLEARANCE, least(old)) - 1e-6) return `ink at ${j + 1}`;
    const crossed = branchCrossings(old, shifted, measureCategoryText);
    for (const crossing of branchCrossings(frame, shifted, measureCategoryText)) if (!crossed.has(crossing)) return `branch at ${j + 1}`;
  }
  // The landing's own plaques travel with it; every other plaque keeps its room.
  const carried = new Set<string>();
  view(k).get(landing)?.each(member => { carried.add(getNodeId(member)); });
  const others: PlaqueRoom = { ...context.plaques, anchors: new Map([...context.plaques.anchors].map(([stage, plaques]) =>
    [stage, plaques.filter(plaque => !carried.has(plaque.anchor))] as const)) };
  if (!keepsPlaqueRoom(context.steps, frames, frames.map((_, index) => view(index)), start, others, measureCategoryText)) return 'plaque room';
  return '';
}
