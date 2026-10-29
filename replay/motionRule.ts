/** Node motion continuity over laid-out Replay frames, in layout units.
 *
 * Painted syntax may change position only at a step that owns it, and the step
 * that attaches existing material must find that material already at its
 * attachment site. Ownership is decided here, from each frame's own step, so a
 * checkout cannot hide motion by weakening its planner's diagnostics:
 * - `unowned-motion`: painted syntax moved that the step does not own. A step
 *   owns its target, the participants of its own trajectory links, syntax new
 *   in its frame or whose painted parent changed there, everything below those,
 *   and the ancestors that recentre over them. Only the topmost moving node of
 *   each unowned subtree is reported.
 * - `attachment-site-motion`: a micro step created a parent, and one of its
 *   daughters that was already painted moved in that same step. A waiting
 *   workspace or a selected head that does not stand at its merge site makes
 *   the joining step jump. `waiting` marks a daughter that was a workspace root.
 *   When the step inserts the new parent above a host it already had, a
 *   daughter whose old row the new parent now occupies may descend below it;
 *   its horizontal motion still counts.
 *
 * - `shape-motion`: a node moved, and moved relative to its painted parent,
 *   while that parent kept exactly the same painted children. Whoever owns the step, a
 *   phrase's internal shape is then unchanged, so any such motion deforms it.
 *
 * Each frame is `{ stage, kind, operation, target, links, points, closing? }` (see
 * `motionFrame`). Within a stage the camera holds its pose, so motion is raw
 * layout motion. Each stage has its own layout origin, and crossing into a new
 * stage the renderer carries the camera by the common shift of unmoved shared
 * syntax (`carryCamera`, with the frame's `closing`), so there motion is measured
 * after that carried shift.
 *
 * This is the one definition of the rule: the corpus comparator reaches it through
 * scripts/replayMotionContinuity.mjs, and stage planning (movementGapClosing.ts)
 * uses it to keep a closing only where the rule accepts it. */
import { paintedShift } from './cameraCarry.ts';
import { TREE_SIBLING_GAP } from './treeSpacing.ts';

/** Which painted syntax one Replay step owns: the single ownership definition of
 * the motion rules (scripts/replayMotionContinuity.mjs over laid-out frames, and
 * the browser audit's settled-continuity rule over painted frames). Painted
 * syntax may change position only at a step that owns it.
 *
 * A step owns its target, the participants of its own trajectory links, syntax
 * new in its frame or whose painted parent changed there, everything below
 * those, and the ancestors that recentre over them. Ancestors are owned without
 * owning their other branches. `points` and `prior` hold `{ id, parent }` for
 * the step's frame and the frame before it, `parent` being the painted parent or
 * null; `prior` may be an array or a Map by id. */
export function stepOwnership({ target, links = [], points, prior }: { target?: string; links?: readonly string[]; points: readonly any[]; prior: any }): Set<string> {
  const current = new Map<string, any>(points.map(point => [point.id, point]));
  const before: Map<string, any> = prior instanceof Map ? prior : new Map(prior.map(point => [point.id, point]));
  const children = new Map();
  for (const point of points) if (point.parent) children.set(point.parent, [...(children.get(point.parent) ?? []), point.id]);
  const owned = new Set<string>(), expanded = new Set<string>(), seeds = [target, ...links].filter((id): id is string => Boolean(id) && current.has(id!));
  for (const point of points) {
    const old = before.get(point.id);
    if (!old || old.parent !== point.parent) seeds.push(point.id);
  }
  for (const seed of seeds) {
    // Subtree expansion is tracked apart from ownership, since an owned
    // ancestor does not own its other branches.
    for (const pending = [seed]; pending.length;) {
      const id = pending.pop();
      if (expanded.has(id)) continue;
      expanded.add(id);
      owned.add(id);
      pending.push(...(children.get(id) ?? []));
    }
    for (let id = current.get(seed)?.parent; id; id = current.get(id)?.parent) owned.add(id);
  }
  return owned;
}

/** The participants of a step's own trajectory links: the moments a relation step
 * plays, never another step's persisting arrows. */
export function stepTrajectoryParticipants(step: any): string[] {
  const identity = step.replayRelationIdentity, key = identity && `${identity.stageIndex}:${identity.relationIndex}`;
  if (step.replayKind !== 'relation' || !key) return [];
  return [...new Set<string>((step.replayRelationLinks ?? [])
    .filter(link => link.renderFamily === 'trajectory' && link.authoredRelationKey === key)
    .flatMap(link => [link.priorSourceNodeId, link.witnessNodeId, link.targetNodeId].filter(Boolean)))];
}

export const MOTION_FAULT_THRESHOLD = 1;

/** What the corpus gate fails on (scripts/replayCorpusInputs.mjs). Every fault
 * above MOTION_FAULT_THRESHOLD is reported, but the owner does not want motion
 * he could not notice brought to him (27 Oct 2026): a new fault fails from
 * NOTICEABLE_MOTION tree units, and a fault the base already has fails when it
 * moves farther by NOTICEABLE_MOTION or NOTICEABLE_MOTION_GROWTH of its old
 * distance, whichever is larger. */
export const NOTICEABLE_MOTION = 20;
export const NOTICEABLE_MOTION_GROWTH = 0.1;

/** Whether `fault` is motion the gate fails on, given the base's fault at the
 * same step (undefined when it is new). */
export const noticeableMotion = (fault: { distance: number }, base?: { distance: number }) => base === undefined ? fault.distance >= NOTICEABLE_MOTION
  : fault.distance - base.distance >= Math.max(NOTICEABLE_MOTION, base.distance * NOTICEABLE_MOTION_GROWTH);

export function replayMotionFaults({ frames }: { frames: readonly any[] }, { threshold = MOTION_FAULT_THRESHOLD }: { threshold?: number } = {}): any[] {
  const points = frames.map(frame => new Map<string, any>(frame.points.map(point => [point.id, point])));
  const painted = (index: number) => new Map<string, { x: number; y: number; parentId: string | null }>(frames[index].points.map(point => [point.id, { x: point.x, y: point.y, parentId: point.parent }]));
  // The camera carry of a stage crossing, as the screen applies it (carryCamera).
  const carried = frames.map((frame, index) => {
    if (!index || frame.stage === frames[index - 1].stage) return { x: 0, y: 0 };
    const shift = paintedShift(painted(index - 1), painted(index), { closing: Boolean(frame.closing) });
    return { x: -shift.x, y: -shift.y };
  });
  const motion = (index, id) => {
    const before = points[index - 1]?.get(id), after = points[index]?.get(id);
    return before && after ? { x: after.x + carried[index].x - before.x, y: after.y + carried[index].y - before.y } : undefined;
  };
  const length = shift => Math.hypot(shift.x, shift.y);
  // Faults name their step semantically, so an inserted or removed frame elsewhere
  // does not make an unchanged fault look new.
  const seen = new Map();
  const stepKeys = frames.map(frame => {
    const identity = JSON.stringify([frame.stage, frame.kind, frame.operation, frame.target, frame.relationIndex]);
    const occurrence = seen.get(identity) ?? 0;
    seen.set(identity, occurrence + 1);
    return `${identity}#${occurrence}`;
  });
  const faults = [];
  for (let index = 1; index < frames.length; index++) {
    const { kind, operation, target, links = [] } = frames[index], current = points[index], prior = points[index - 1];
    const owned = stepOwnership({ target, links, points: frames[index].points, prior });
    const closing = closingGroups({ kind, links, current, prior, motion: id => motion(index, id), owned, threshold });
    for (const id of closing) owned.add(id);
    const moved = new Set<string>(frames[index].points.filter(point => !owned.has(point.id) && prior.has(point.id)
      && length(motion(index, point.id)) > threshold).map(point => point.id));
    // A node riding with its moving parent is reported once, at the parent; one
    // that moves differently from its parent is reported as well.
    for (const id of moved) {
      const parentId = current.get(id).parent, shift = motion(index, id), carriedBy = moved.has(parentId) && motion(index, parentId);
      if (carriedBy && length({ x: shift.x - carriedBy.x, y: shift.y - carriedBy.y }) <= threshold) continue;
      faults.push({ frame: index + 1, step: stepKeys[index], node: id, kind: 'unowned-motion', operation, distance: length(shift) });
    }
    const daughters = map => {
      const result = new Map<string, string[]>();
      for (const point of map.values()) if (point.parent) result.set(point.parent, [...(result.get(point.parent) ?? []), point.id]);
      return result;
    };
    const currentDaughters = daughters(current), priorDaughters = daughters(prior);
    const childIds = (map, id) => ((map === current ? currentDaughters : priorDaughters).get(id) ?? []).join(' ');
    for (const point of frames[index].points) {
      const old = prior.get(point.id);
      if (!old || !point.parent || old.parent !== point.parent || !prior.has(point.parent)
        || childIds(current, point.parent) !== childIds(prior, point.parent)) continue;
      // A closing side slides whole while the parents spanning the gap recentre.
      if (closing.has(point.id)) continue;
      // A parent recentring over deeper changes moves alone; the child did not move.
      const own = motion(index, point.id), carrier = motion(index, point.parent);
      const distance = length({ x: own.x - carrier.x, y: own.y - carrier.y });
      if (length(own) > threshold && distance > threshold) faults.push({ frame: index + 1, step: stepKeys[index], node: point.id, kind: 'shape-motion', operation, distance });
    }
    const parent = current.get(target);
    if (kind !== 'micro' || !['ExternalMerge', 'Project'].includes(operation) || !parent || prior.has(target)) continue;
    // An insertion places the new parent above a host it already had; the host
    // then descends below it, which the step owns.
    const insertion = frames[index].points.some(point => point.parent === target && prior.get(point.id)?.parent
      && prior.get(point.id).parent === parent.parent);
    for (const point of frames[index].points) {
      const old = point.parent === target && prior.get(point.id);
      if (!old) continue;
      const shift = motion(index, point.id);
      const descends = insertion && Math.abs(parent.y + carried[index].y - old.y) < 1e-6 && point.y > parent.y;
      const distance = descends ? Math.abs(shift.x) : length(shift);
      if (distance > threshold) faults.push({ frame: index + 1, step: stepKeys[index], node: point.id, kind: 'attachment-site-motion',
        operation, distance, waiting: !old.parent });
    }
  }
  return faults.sort((a, b) => a.frame - b.frame || a.kind.localeCompare(b.kind) || a.node.localeCompare(b.node));
}

/** The step where a phrase moves away may close the gap it leaves (Francis,
 * 25 October 2026: "yes, the closing the gap is alright."). At a relation step
 * whose own trajectory takes material away (relocated or no longer painted),
 * the remaining syntax may close toward it while the far side stays: leaves on
 * one side of the departing extent slide horizontally toward it in blocks, each
 * no farther than the departing extent and one node unit and no farther than
 * the block before it, or one whole side of the departing extent slides as one.
 * Both sides together close no more than that room; motion away from the gap is
 * never a closing. The lower occurrence may shift within that room, and parents
 * spanning the gap recentre over their daughters.
 * Syntax joining a new parent at this step is judged as attachment instead.
 * Returns the ids so closing. */
export function closingGroups({ kind, links, current, prior, motion, threshold = MOTION_FAULT_THRESHOLD }: any): Set<string> {
  const result = new Set<string>();
  if (kind !== 'relation' || !links.length) return result;
  const priorChildren = new Map();
  for (const point of prior.values()) if (point.parent) priorChildren.set(point.parent, [...(priorChildren.get(point.parent) ?? []), point.id]);
  // The departing material: what leaves the step's own trajectory participants
  // (relocated under another parent, or no longer painted), with everything it
  // painted below it in the frame before.
  const departing = new Set();
  const take = id => { for (const pending = [id]; pending.length;) {
    const next = pending.pop();
    if (departing.has(next)) continue;
    departing.add(next); pending.push(...(priorChildren.get(next) ?? []));
  } };
  for (const participant of links) {
    if (!prior.has(participant)) continue;
    for (const pending = [participant]; pending.length;) {
      const id = pending.pop(), old = prior.get(id), now = current.get(id);
      if (!now || (old.parent && now.parent !== old.parent)) { take(id); continue; }
      pending.push(...(priorChildren.get(id) ?? []));
    }
  }
  const xs = [...departing].map(id => prior.get(id).x);
  // A phrase's room is its extent and one node unit.
  const lo = Math.min(...xs), hi = Math.max(...xs), width = hi - lo + TREE_SIBLING_GAP;
  // Each node's painted extent in the frame before, below it included.
  const extent = new Map();
  const span = id => {
    if (extent.has(id)) return extent.get(id);
    const own = prior.get(id).x, parts = (priorChildren.get(id) ?? []).map(span);
    const result = [Math.min(own, ...parts.map(part => part[0])), Math.max(own, ...parts.map(part => part[1]))];
    extent.set(id, result);
    return result;
  };
  // Syntax that joins a new parent here, and what rides along with it, moves
  // because the step attaches it, not to close a gap.
  const joining = id => {
    for (let top = id; top;) {
      const old = prior.get(top), now = current.get(top);
      if (!old) return true;
      if (old.parent !== now.parent) {
        const a = motion(id), b = motion(top);
        return Boolean(a && b) && Math.abs(a.x - b.x) <= threshold && Math.abs(a.y - b.y) <= threshold;
      }
      top = now.parent;
    }
    return false;
  };
  // The painted leaves outside the departing material, left to right: some cut
  // between them may close, everything on one side of it sliding as one toward
  // it while the other side stays.
  const leaves = [...prior.values()].filter(point => !priorChildren.has(point.id) && !departing.has(point.id)
    && current.has(point.id) && !joining(point.id) && !links.includes(point.id)).sort((a, b) => a.x - b.x);
  const shiftOf = leaves.map(point => motion(point.id));
  // Leaves on the moving side slide in blocks, each block as one, by amounts
  // that shrink toward the side that stays (gaps closing one after another).
  const still = shift => Math.hypot(shift.x, shift.y) <= threshold;
  const flows = shifts => {
    if (!shifts.length || !still(shifts.at(-1))) return false;
    let previous = Infinity;
    for (const shift of shifts) {
      if (Math.abs(shift.y) > threshold) return false;
      if (Math.abs(shift.x) > width + threshold || Math.abs(shift.x) > previous + threshold) return false;
      previous = Math.abs(shift.x);
    }
    return true;
  };
  let moving = null;
  if (leaves.length) for (const side of [-1, 1]) {
    // Leaves read from the moving end toward the end that stays.
    const order = side < 0 ? leaves.map((_, k) => k) : leaves.map((_, k) => leaves.length - 1 - k);
    const shifts = order.map(k => shiftOf[k]);
    // A leaf moves toward the gap only with vacated room ahead of it: one moving
    // right stands left of the departing extent's right end, and the mirror.
    const toward = order.every(k => still(shiftOf[k]) || Math.sign(shiftOf[k].x) === -side && (side < 0 ? leaves[k].x < hi : leaves[k].x > lo));
    if (toward && !still(shifts[0]) && flows(shifts)) { moving = new Map<string, any>(order.map(k => [leaves[k].id, shiftOf[k]] as [string, any]).filter(([, shift]) => !still(shift))); break; }
  }
  if (moving) {
    const leavesOf = new Map();
    const below = id => {
      if (leavesOf.has(id)) return leavesOf.get(id);
      const parts = priorChildren.get(id);
      const result = parts ? parts.flatMap(below) : [id];
      leavesOf.set(id, result);
      return result;
    };
    // A node whose leaves all slide by one amount slides with them.
    for (const point of current.values()) {
      if (!prior.has(point.id) || departing.has(point.id) || joining(point.id)) continue;
      const under = below(point.id).filter(id => !departing.has(id));
      if (!under.length || !under.every(id => moving.has(id))) continue;
      const dx = moving.get(under[0]).x, shift = motion(point.id);
      if (shift && Math.abs(shift.y) <= threshold && under.every(id => Math.abs(moving.get(id).x - dx) <= threshold) && Math.abs(shift.x - dx) <= threshold) result.add(point.id);
    }
  }
  // Or each side of the departing material's former extent slides as one.
  for (const side of [-1, 1]) {
    const group = [...current.values()].filter(point => !departing.has(point.id) && prior.has(point.id) && !joining(point.id)
      && (side < 0 ? span(point.id)[1] < lo : span(point.id)[0] > hi));
    const shifts = group.map(point => motion(point.id)).filter(Boolean);
    const moving = shifts.filter(shift => Math.hypot(shift.x, shift.y) > threshold);
    if (!moving.length) continue;
    const dx = moving[0].x;
    // The whole side moves as one, toward the gap, no farther than it.
    if (shifts.some(shift => Math.abs(shift.x - dx) > threshold || Math.abs(shift.y) > threshold)) continue;
    if (Math.sign(dx) !== -side || Math.abs(dx) > width + threshold) continue;
    for (const point of group) result.add(point.id);
  }
  // A source's lower occurrence may shift within the room its material left.
  for (const participant of links) {
    const old = prior.get(participant), now = current.get(participant), shift = motion(participant);
    if (!old || !now || departing.has(participant) || !shift || Math.abs(shift.y) > threshold || Math.abs(shift.x) > width + threshold) continue;
    if ((priorChildren.get(participant) ?? []).some(id => departing.has(id))) result.add(participant);
  }
  if (!result.size) return result;
  // Every closing moves toward the gap, so syntax moving right closes it from the
  // left and syntax moving left from the right: together they take no more than
  // the room, the largest move each way adding up to at most its size.
  const closes = (direction: number) => Math.max(0, ...[...result].map(id => direction * (motion(id)?.x ?? 0)));
  if (closes(-1) + closes(1) > width + threshold) return new Set<string>();
  // Parents with daughters on both sides of the gap recentre over them: they
  // move only horizontally, toward the gap, and no farther than their daughters.
  const children = new Map();
  for (const point of current.values()) if (point.parent) children.set(point.parent, [...(children.get(point.parent) ?? []), point.id]);
  for (let grown = true; grown;) {
    grown = false;
    for (const point of current.values()) {
      if (result.has(point.id) || departing.has(point.id) || !prior.has(point.id)) continue;
      const daughters = children.get(point.id) ?? [];
      if (!daughters.some(id => result.has(id))) continue;
      const shift = motion(point.id), most = Math.max(...daughters.map(id => Math.abs(motion(id)?.x ?? 0)));
      if (!shift || Math.abs(shift.y) > threshold || Math.abs(shift.x) > most + threshold) continue;
      result.add(point.id); grown = true;
    }
  }
  return result;
}

/** Painted points of one laid-out scene, with each point's painted parent. */
export function paintedPoints(nodes: ReadonlyMap<string, any>, getNodeId: (node: any) => string) {
  return [...nodes].map(([id, node]) => {
    const parent = node.parent && nodes.has(getNodeId(node.parent)) ? getNodeId(node.parent) : null;
    return { id, x: node.x, y: node.y, parent };
  });
}

/** The rule's view of one Replay step: its operation, target, the participants
 * of its own trajectory links, and its painted points; `closing` when the stage
 * plan closed a movement's room at the crossing into it (CarryOptions). */
export function motionFrame(step: any, nodes: ReadonlyMap<string, any>, getNodeId: (node: any) => string, closing = false) {
  return { stage: step.replayFrameIndex, kind: step.replayKind, operation: step.operation, target: step.targetNodeId,
    links: stepTrajectoryParticipants(step), points: paintedPoints(nodes, getNodeId), ...(closing ? { closing: true } : {}) };
}
