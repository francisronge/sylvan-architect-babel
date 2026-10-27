import { currentWorkspaceMovements } from './currentWorkspaceMovements.ts';
import type { ContourFrame, LifetimeContour, Point } from './workspaceLifetimeContours.ts';

type Preferences = ReadonlyMap<number, ReadonlyMap<string, Point>>;

/** A head movement whose receiving head keeps its ID and parent grows that head
 * into the complex at the movement moment. The fork above it keeps its children,
 * so the head has no reason to move within it: the fork before the moment should
 * already hold the slots the complex needs. Each result names that earlier fork
 * and the fork as the moment composes it. */
export function receivingHeadForks(frames: readonly ContourFrame[]) {
  const result: Array<{ frame: number; receiver: string; before: LifetimeContour; after: LifetimeContour }> = [];
  frames.forEach((frame, index) => {
    const previous = frames[index - 1];
    if (!previous) return;
    const parentOf = (nodes: ContourFrame['nodes'], id: string) =>
      [...nodes.values()].find(part => part.children.some(child => child.id === id));
    for (const link of currentWorkspaceMovements(frame.step, previous.nodes, frame.nodes)) {
      if (link.trajectoryKind !== 'head') continue;
      const receiver = parentOf(frame.nodes, link.targetNodeId), prior = receiver && previous.nodes.get(receiver.id);
      if (!receiver || !prior || prior.incarnation === receiver.incarnation || prior.members.has(link.priorSourceNodeId)) continue;
      const after = parentOf(frame.nodes, receiver.id), before = after && parentOf(previous.nodes, receiver.id);
      if (!after || !before || before.id !== after.id || before.incarnation === after.incarnation
        || before.children.length !== after.children.length
        || before.children.some((child, offset) => child.id !== after.children[offset].id)
        || result.some(item => item.before === before)) continue;
      result.push({ frame: index, receiver: receiver.id, before, after });
    }
  });
  return result;
}

/** Give each earlier fork the child slots its moment composes. Only horizontal
 * slots change; rows remain the earlier fork's own. */
export function receivingHeadPreferences(preferred: Preferences, forks: ReturnType<typeof receivingHeadForks>) {
  const result = new Map(preferred);
  for (const { before, after } of forks) {
    const current = preferred.get(before.incarnation);
    if (!current) continue;
    const points = new Map(current);
    const root = points.get(before.id);
    if (!root) continue;
    for (const child of before.children) {
      const slot = after.members.get(child.id), point = points.get(child.id);
      if (!slot || !point) return undefined;
      points.set(child.id, { x: root.x + slot.x, y: point.y });
    }
    result.set(before.incarnation, points);
  }
  return result;
}

/** How far each receiving head stands from where its moment places it within
 * the unchanged fork, in composed fork coordinates. */
export function receivingHeadOffsets(frames: readonly ContourFrame[], forks: ReturnType<typeof receivingHeadForks>) {
  return forks.map(({ frame, receiver, before, after }) => {
    const prior = frames[frame - 1]?.nodes.get(before.id), current = frames[frame]?.nodes.get(after.id);
    const a = prior?.members.get(receiver), b = current?.members.get(receiver);
    return a && b ? Math.abs(a.x - b.x) : Infinity;
  });
}
