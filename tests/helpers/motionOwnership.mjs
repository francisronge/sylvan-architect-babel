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
export function stepOwnership({ target, links = [], points, prior }) {
  const current = new Map(points.map(point => [point.id, point]));
  const before = prior instanceof Map ? prior : new Map(prior.map(point => [point.id, point]));
  const children = new Map();
  for (const point of points) if (point.parent) children.set(point.parent, [...(children.get(point.parent) ?? []), point.id]);
  const owned = new Set(), expanded = new Set(), seeds = [target, ...links].filter(id => current.has(id));
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
export function stepTrajectoryParticipants(step) {
  const identity = step.replayRelationIdentity, key = identity && `${identity.stageIndex}:${identity.relationIndex}`;
  if (step.replayKind !== 'relation' || !key) return [];
  return [...new Set((step.replayRelationLinks ?? [])
    .filter(link => link.renderFamily === 'trajectory' && link.authoredRelationKey === key)
    .flatMap(link => [link.priorSourceNodeId, link.witnessNodeId, link.targetNodeId].filter(Boolean)))];
}
