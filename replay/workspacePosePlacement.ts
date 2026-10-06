import type { PlaqueRect } from './relations/plaquePlacement.ts';
import type { WorkspacePoseGraph } from './workspacePoseGraph.ts';
import { currentWorkspaceMovements } from './currentWorkspaceMovements.ts';
import type { LifetimeContour, Point } from './workspaceLifetimeContours.ts';
import { cubicIntersectsRect } from './relations/curveClearance.ts';
import { verticalObstacleIndex } from './verticalObstacleIndex.ts';
type ReferenceFrame = {
  nodes: readonly ({
    id: string;
  } & Point)[];
};
type Occurrence = {
  group: number;
  offset: Point;
  shape: LifetimeContour;
  index: number;
};
type PoseGroup = {
  group: number;
  first: number;
  firstId: string;
  rootIndex: number;
  desiredX: number[];
  desiredY: number[];
  occurrences: Occurrence[];
  x: number;
  y: number;
};
type ClearanceConflict = {
  frame: number;
  roots: string[];
  pairs: {
    a: PlaqueRect;
    b: PlaqueRect;
  }[];
};
export type WorkspacePosePlacement = {
  accepted: false;
  reason: 'inconsistent-temporal-constraints' | 'fixed-group-clearance';
  conflicts?: ClearanceConflict[];
} | {
  accepted: true;
  coordinates: Map<string, Point>[];
  groups: Pick<PoseGroup, 'group' | 'first' | 'firstId' | 'x' | 'y'>[];
};
const translated = (rect: PlaqueRect, x: number, y: number): PlaqueRect => ({
  ...rect, x: rect.x + x, y: rect.y + y,
  ...(rect.curve ? { curve: {
      source: { x: rect.curve.source.x + x, y: rect.curve.source.y + y },
      control1: { x: rect.curve.control1.x + x, y: rect.curve.control1.y + y },
      control2: { x: rect.curve.control2.x + x, y: rect.curve.control2.y + y },
      target: { x: rect.curve.target.x + x, y: rect.curve.target.y + y },
    } } : {}),
});
const collision = (a: PlaqueRect, b: PlaqueRect) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) + 1e-6
  && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y) + 1e-6
  && (!a.curve || cubicIntersectsRect(a.curve, b, a.curvePadding))
  && (!b.curve || cubicIntersectsRect(b.curve, a, b.curvePadding));
const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Prefer stable poses for unchanged material outside the actual movement,
 * and let independent merge inputs wait at their attachment positions. Required
 * pose equations and complete-lifetime clearance take precedence. These optional
 * ties never change child contours or the operation's motion ownership. */
function preferredStationaryPoses(graph: WorkspacePoseGraph, baseline: readonly ReferenceFrame[]) {
  let union = graph.union.copy();
  const references = baseline.map(frame => new Map(frame.nodes.map(node => [node.id, node])));
  type Entry = { index: number; variable: number; shape: LifetimeContour };
  const occurrences = new Map<number, Entry[]>();
  for (const [index, frame] of graph.frames.entries()) for (const shape of frame.roots) {
    const variable = graph.variables[index].get(shape.id)!, group = union.find(variable).group;
    let entries = occurrences.get(group);
    if (!entries) occurrences.set(group, entries = []);
    entries.push({ index, variable, shape });
  }
  for (let index = 1; index < graph.frames.length; index++) {
    const current = graph.frames[index], before = graph.frames[index - 1], candidates = new Set<string>();
    // Independent inputs can wait at their attachment position before an
    // ordinary merge. The lifetime clearance check below must accept the tie.
    const merge = current.step.replayKind === 'micro' && current.step.operation === 'ExternalMerge'
      && current.step.targetNodeId && !before.nodes.has(current.step.targetNodeId)
      ? current.nodes.get(current.step.targetNodeId) : undefined;
    const incoming = new Set(merge?.children.filter(child =>
      before.nodes.has(child.id) && !graph.topologies[index - 1].parent.has(child.id)).map(child => child.id));
    const movements = currentWorkspaceMovements(current.step, before.nodes, current.nodes);
    const moving = new Set(movements.flatMap(link => [
      ...before.nodes.get(link.priorSourceNodeId)!.members.keys(),
      ...current.nodes.get(link.witnessNodeId)!.members.keys(),
      ...current.nodes.get(link.targetNodeId)!.members.keys()
    ]));
    for (const [id, shape] of current.nodes) {
      if (!graph.owned[index].has(id) || before.nodes.get(id)?.incarnation !== shape.incarnation) continue;
      if (incoming.has(id) || movements.length && [...shape.members.keys()].every(member => !moving.has(member)) || [...shape.members.keys()].every(member => {
        const a = references[index - 1].get(member), b = references[index].get(member);
        return a && b && Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6;
      })) candidates.add(id);
    }
    for (const id of candidates) {
      const parent = graph.topologies[index].parent.get(id);
      if (parent && candidates.has(parent)) continue;
      const oldRoot = graph.topologies[index - 1].root.get(id)!, newRoot = graph.topologies[index].root.get(id)!;
      const from = graph.variables[index - 1].get(oldRoot.id)!, to = graph.variables[index].get(newRoot.id)!;
      const a = union.find(from), b = union.find(to);
      if (a.group === b.group) continue;
      const oldPoint = oldRoot.members.get(id)!, newPoint = newRoot.members.get(id)!;
      const trial = union.copy();
      trial.join(from, to, { x: oldPoint.x - newPoint.x, y: oldPoint.y - newPoint.y });
      const earlier = occurrences.get(a.group)!, later = occurrences.get(b.group)!;
      // Only pairs newly coupled by this tie can add a fixed conflict. Test
      // their real cubic envelopes at every shared frame before committing it.
      const clear = earlier.every(left => later.every(right => {
        if (left.index !== right.index) return true;
        const x = trial.find(left.variable).offset, y = trial.find(right.variable).offset;
        const own = left.shape.obstacles.map(rect => translated(rect, x.x, x.y));
        const other = right.shape.obstacles.map(rect => translated(rect, y.x, y.y));
        const query = verticalObstacleIndex(other);
        for (let i = 0; i < own.length; i++) {
          if (query(own[i], obstacle => collision(own[i], obstacle))) return false;
        }
        return true;
      }));
      if (!clear) continue;
      union = trial;
      occurrences.set(a.group, [...earlier, ...later]);
      occurrences.delete(b.group);
    }
  }
  return union;
}
/** Place whole pose groups only. Their internal coordinates were fixed by exact
* temporal equations and never change during clearance. */
export function placeRigidGroups(graph: WorkspacePoseGraph, baseline: readonly ReferenceFrame[]): WorkspacePosePlacement {
  if (graph.conflicts.length)
    return { accepted: false, reason: 'inconsistent-temporal-constraints' };
  const union = preferredStationaryPoses(graph, baseline);
  const groups = new Map<number, PoseGroup>();
  const scenes = graph.frames.map((frame, index) => frame.roots.map((shape, rootIndex): Occurrence => {
    const variable = graph.variables[index].get(shape.id)!;
    const { group, offset } = union.find(variable);
    const old = baseline[index].nodes.find(node => node.id === shape.id)!;
    let value = groups.get(group);
    if (!value) {
      value = { group, first: index, firstId: shape.id, rootIndex, desiredX: [], desiredY: [], occurrences: [], x: 0, y: 0 };
      groups.set(group, value);
    }
    value.desiredX.push(old.x - offset.x);
    value.desiredY.push(old.y - offset.y);
    const occurrence = { group, offset, shape, index };
    value.occurrences.push(occurrence);
    return occurrence;
  }));
  for (const group of groups.values()) {
    group.x = median(group.desiredX);
    group.y = median(group.desiredY);
  }
  const conflicts: ClearanceConflict[] = [];
  for (const [index, roots] of scenes.entries())
    for (let i = 0; i < roots.length; i++)
      for (let j = i + 1; j < roots.length; j++) {
        const a = roots[i], b = roots[j];
        if (a.group !== b.group)
          continue;
        const left = a.shape.obstacles.map(box => translated(box, a.offset.x, a.offset.y));
        const right = b.shape.obstacles.map(box => translated(box, b.offset.x, b.offset.y));
        const query = verticalObstacleIndex(right);
        const pairs: ClearanceConflict['pairs'] = [];
        for (const x of left)
          query(x, y => {
            if (collision(x, y))
              pairs.push({ a: x, b: y });
            return false;
          });
        if (pairs.length)
          conflicts.push({ frame: index + 1, roots: [a.shape.id, b.shape.id], pairs });
      }
  if (conflicts.length)
    return { accepted: false, reason: 'fixed-group-clearance', conflicts };
  const ordinaryOrder = [...groups.values()].sort((a, b) => a.first - b.first || a.x - b.x || a.rootIndex - b.rootIndex);
  const attachment = new Map<number, { target: number; x: number; y: number }>();
  for (let index = 1; index < graph.frames.length; index++) {
    const current = graph.frames[index], before = graph.frames[index - 1], step = current.step;
    if (step.replayKind !== 'micro' || step.operation !== 'ExternalMerge' || !step.targetNodeId) continue;
    const merge = current.nodes.get(step.targetNodeId);
    if (!merge || before.nodes.has(merge.id)) continue;
    for (const child of merge.children) {
      const oldRoot = graph.topologies[index - 1].root.get(child.id);
      if (oldRoot?.id !== child.id || oldRoot.incarnation !== child.incarnation) continue;
      const newRoot = graph.topologies[index].root.get(child.id)!;
      const from = union.find(graph.variables[index - 1].get(oldRoot.id)!);
      const to = union.find(graph.variables[index].get(newRoot.id)!);
      if (from.group === to.group || attachment.has(from.group)) continue;
      const oldPoint = oldRoot.members.get(child.id)!, nextPoint = newRoot.members.get(child.id)!;
      attachment.set(from.group, { target: to.group,
        x: to.offset.x + nextPoint.x - from.offset.x - oldPoint.x,
        y: to.offset.y + nextPoint.y - from.offset.y - oldPoint.y });
    }
  }
  // Place the receiving scene first, then let an independent input wait in the
  // nearest clear position to its next attachment. A failed exact tie must not
  // send it back to an unrelated corner. Cyclic preferences retain normal order.
  const ordered: PoseGroup[] = [], scheduled = new Set<number>(), visiting = new Set<number>();
  const schedule = (group: PoseGroup): boolean => {
    if (scheduled.has(group.group)) return true;
    if (visiting.has(group.group)) return false;
    visiting.add(group.group);
    const preference = attachment.get(group.group);
    if (preference && !schedule(groups.get(preference.target)!)) attachment.delete(group.group);
    visiting.delete(group.group);
    scheduled.add(group.group); ordered.push(group);
    return true;
  };
  ordinaryOrder.forEach(schedule);
  const placed = new Set<number>();
  for (const group of ordered) {
    const preference = attachment.get(group.group);
    if (preference && placed.has(preference.target)) {
      const target = groups.get(preference.target)!;
      group.x = target.x + preference.x;
      group.y = target.y + preference.y;
    }
    const intervals: [
      number,
      number
    ][] = [];
    for (const occurrence of group.occurrences) {
      if (!scenes[occurrence.index].some(peer => placed.has(peer.group))) continue;
      const own = occurrence.shape.obstacles.map(box => translated(box, occurrence.offset.x, occurrence.offset.y + group.y));
      for (const peer of scenes[occurrence.index]) {
        if (!placed.has(peer.group))
          continue;
        const other = groups.get(peer.group)!;
        const boxes = peer.shape.obstacles.map(box => translated(box, peer.offset.x + other.x, peer.offset.y + other.y));
        for (const a of own)
          for (const b of boxes) {
            if (Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y) + 1e-6) {
              intervals.push([b.x - a.x - a.width - 1, b.x + b.width - a.x + 1]);
            }
          }
      }
    }
    intervals.sort((a, b) => a[0] - b[0]);
    const merged: [
      number,
      number
    ][] = [];
    for (const interval of intervals) {
      const last = merged.at(-1);
      if (last && interval[0] <= last[1])
        last[1] = Math.max(last[1], interval[1]);
      else
        merged.push([...interval]);
    }
    const blocked = merged.find(([a, b]) => group.x > a && group.x < b);
    if (blocked)
      group.x = group.x - blocked[0] <= blocked[1] - group.x ? blocked[0] : blocked[1];
    placed.add(group.group);
  }
  const coordinates = graph.frames.map((_, index) => {
    const result = new Map<string, Point>();
    for (const root of scenes[index]) {
      const group = groups.get(root.group)!, x = root.offset.x + group.x, y = root.offset.y + group.y;
      for (const [id, point] of root.shape.members)
        result.set(id, { x: point.x + x, y: point.y + y });
    }
    return result;
  });
  return { accepted: true, coordinates, groups: ordered.map(({ group, first, firstId, x, y }) => ({ group, first, firstId, x, y })) };
}
