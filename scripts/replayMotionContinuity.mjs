/** Node motion continuity over laid-out Replay frames, in layout units.
 *
 * Painted syntax may change position only at a step that owns it, and the step
 * that attaches existing material must find that material already at its
 * attachment site. Two fault kinds follow:
 * - `unowned-motion`: a component the step does not own moved. Ownership is the
 *   exact stationary-witness rule of `workspaceMotionOwnership`, reported by the
 *   checkout's own `workspaceContinuityReflows` for the same frames.
 * - `attachment-site-motion`: a micro step created a parent, and one of its
 *   daughters that was already painted moved in that same step. A waiting
 *   workspace or a selected head that does not stand at its merge site makes
 *   the joining step jump. `waiting` marks a daughter that was a workspace root.
 *   A daughter whose old row the new parent now occupies may descend below it,
 *   as reserved hosts do; its horizontal motion still counts.
 *
 * Each frame is `{ kind, operation, target, points }`, with points
 * `{ id, x, y, parent }`; `parent` is the painted syntax parent, or null for a
 * workspace root. Like the planner, the rule compares raw stage coordinates,
 * including across stage boundaries. */
export const MOTION_FAULT_THRESHOLD = 1;

export function replayMotionFaults({ frames, continuity = [] }, { threshold = MOTION_FAULT_THRESHOLD } = {}) {
  const points = frames.map(frame => new Map(frame.points.map(point => [point.id, point])));
  const motion = (index, id) => {
    const before = points[index - 1]?.get(id), after = points[index]?.get(id);
    return before && after ? { x: after.x - before.x, y: after.y - before.y } : undefined;
  };
  const faults = [];
  for (const fault of continuity) {
    if (fault.kind !== 'unowned-component-motion') continue;
    const moved = motion(fault.index, fault.rootId), distance = moved ? Math.hypot(moved.x, moved.y) : 0;
    if (distance > threshold) faults.push({ frame: fault.index + 1, node: fault.rootId, kind: 'unowned-motion',
      operation: frames[fault.index].operation, distance });
  }
  for (let index = 1; index < frames.length; index++) {
    const { kind, operation, target } = frames[index];
    const parent = points[index].get(target);
    if (kind !== 'micro' || !['ExternalMerge', 'Project'].includes(operation) || !parent || points[index - 1].has(target)) continue;
    for (const point of frames[index].points) {
      const prior = point.parent === target && points[index - 1].get(point.id);
      if (!prior) continue;
      const moved = motion(index, point.id);
      const descends = prior.parent && Math.abs(parent.y - prior.y) < 1e-6 && point.y > parent.y;
      const distance = descends ? Math.abs(moved.x) : Math.hypot(moved.x, moved.y);
      if (distance > threshold) faults.push({ frame: index + 1, node: point.id, kind: 'attachment-site-motion',
        operation, distance, waiting: !prior.parent });
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
