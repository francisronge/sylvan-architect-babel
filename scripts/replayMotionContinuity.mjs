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
 *   daughter whose old row the new parent now occupies (the host, or a piece
 *   waiting beside it) may descend below it; its horizontal motion still counts.
 *
 * - `shape-motion`: a node moved, and moved relative to its painted parent,
 *   while that parent kept exactly the same painted children. Whoever owns the step, a
 *   phrase's internal shape is then unchanged, so any such motion deforms it.
 *
 * Each frame is `{ stage, kind, operation, target, links, points }` (see
 * `motionFrame`). Within a stage the camera holds its pose, so motion is raw
 * layout motion. Each stage has its own layout origin, and crossing into a new
 * stage the renderer carries the camera by the common shift of unmoved shared
 * syntax (`carryCamera`), so there motion is measured after that carried shift. */
import { carryCamera } from '../components/treeViewport.ts';

export const MOTION_FAULT_THRESHOLD = 1;

export function replayMotionFaults({ frames }, { threshold = MOTION_FAULT_THRESHOLD } = {}) {
  const points = frames.map(frame => new Map(frame.points.map(point => [point.id, point])));
  const painted = index => new Map(frames[index].points.map(point => [point.id, { x: point.x, y: point.y, parentId: point.parent }]));
  const carried = frames.map((frame, index) => index && frame.stage !== frames[index - 1].stage
    ? carryCamera({ x: 0, y: 0, k: 1 }, painted(index - 1), painted(index)) : { x: 0, y: 0 });
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
    const children = new Map();
    for (const point of frames[index].points) if (point.parent) children.set(point.parent, [...(children.get(point.parent) ?? []), point.id]);
    const owned = new Set(), expanded = new Set(), seeds = [target, ...links].filter(id => current.has(id));
    for (const point of frames[index].points) {
      const old = prior.get(point.id);
      if (!old || old.parent !== point.parent) seeds.push(point.id);
    }
    for (const seed of seeds) {
      // Ancestors are owned without owning their other branches, so subtree
      // expansion is tracked apart from ownership.
      for (const pending = [seed]; pending.length;) {
        const id = pending.pop();
        if (expanded.has(id)) continue;
        expanded.add(id);
        owned.add(id);
        pending.push(...(children.get(id) ?? []));
      }
      for (let id = current.get(seed)?.parent; id; id = current.get(id)?.parent) owned.add(id);
    }
    const moved = new Set(frames[index].points.filter(point => !owned.has(point.id) && prior.has(point.id)
      && length(motion(index, point.id)) > threshold).map(point => point.id));
    // A node riding with its moving parent is reported once, at the parent; one
    // that moves differently from its parent is reported as well.
    for (const id of moved) {
      const parentId = current.get(id).parent, shift = motion(index, id), carriedBy = moved.has(parentId) && motion(index, parentId);
      if (carriedBy && length({ x: shift.x - carriedBy.x, y: shift.y - carriedBy.y }) <= threshold) continue;
      faults.push({ frame: index + 1, step: stepKeys[index], node: id, kind: 'unowned-motion', operation, distance: length(shift) });
    }
    const childIds = (map, id) => [...map.values()].filter(point => point.parent === id).map(point => point.id).join(' ');
    for (const point of frames[index].points) {
      const old = prior.get(point.id);
      if (!old || !point.parent || old.parent !== point.parent || !prior.has(point.parent)
        || childIds(current, point.parent) !== childIds(prior, point.parent)) continue;
      // A parent recentring over deeper changes moves alone; the child did not move.
      const own = motion(index, point.id), carrier = motion(index, point.parent);
      const distance = length({ x: own.x - carrier.x, y: own.y - carrier.y });
      if (length(own) > threshold && distance > threshold) faults.push({ frame: index + 1, step: stepKeys[index], node: point.id, kind: 'shape-motion', operation, distance });
    }
    const parent = current.get(target);
    if (kind !== 'micro' || !['ExternalMerge', 'Project'].includes(operation) || !parent || prior.has(target)) continue;
    // An insertion places the new parent above a host it already had; the host
    // and any piece waiting beside it then descend together, which the step owns.
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

/** Painted points of one laid-out scene, with each point's painted parent. */
export function paintedPoints(nodes, getNodeId) {
  return [...nodes].map(([id, node]) => {
    const parent = node.parent && nodes.has(getNodeId(node.parent)) ? getNodeId(node.parent) : null;
    return { id, x: node.x, y: node.y, parent };
  });
}

/** The rule's view of one Replay step: its operation, target, the participants
 * of its own trajectory links, and its painted points. */
export function motionFrame(step, nodes, getNodeId) {
  const identity = step.replayRelationIdentity, key = identity && `${identity.stageIndex}:${identity.relationIndex}`;
  const links = step.replayKind !== 'relation' || !key ? [] : (step.replayRelationLinks ?? [])
    .filter(link => link.renderFamily === 'trajectory' && link.authoredRelationKey === key)
    .flatMap(link => [link.priorSourceNodeId, link.witnessNodeId, link.targetNodeId].filter(Boolean));
  return { stage: step.replayFrameIndex, kind: step.replayKind, operation: step.operation, target: step.targetNodeId,
    links: [...new Set(links)], points: paintedPoints(nodes, getNodeId) };
}
