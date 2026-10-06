import type { ContourFrame, LifetimeContour } from './workspaceLifetimeContours.ts';

type PartReference = {
  id: string;
  incarnation: number;
  first: number;
  last: number;
  children: readonly string[];
  memberY: ReadonlyMap<string, number>;
};
export type WorkspaceNativeVerticalReference = {
  step: ContourFrame['step'];
  canvas: ContourFrame['step']['replayCanvasData'];
  roots: readonly string[];
  nodes: ReadonlyMap<string, PartReference>;
};

/** Snapshot a complete native composition, after current-rank constraints have
 * been applied. Cosmetic gap refinement may retain these ranks; it may not
 * substitute a different topology, lifetime, frame or vertical arrangement. */
export function workspaceNativeVerticalReference(frame: ContourFrame): WorkspaceNativeVerticalReference | undefined {
  const nodes = new Map<string, PartReference>();
  const visited = new Set<string>();
  const collect = (part: LifetimeContour): Set<string> | undefined => {
    if (visited.has(part.id) || frame.nodes.get(part.id) !== part
      || !Number.isFinite(part.incarnation) || !Number.isFinite(part.first) || !Number.isFinite(part.last)) return undefined;
    visited.add(part.id);
    const members = new Set([part.id]);
    for (const child of part.children) {
      const descendants = collect(child);
      if (!descendants) return undefined;
      for (const id of descendants) members.add(id);
    }
    if (members.size !== part.members.size) return undefined;
    const memberY = new Map<string, number>();
    for (const [id, point] of part.members) {
      if (!members.has(id) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
      memberY.set(id, point.y);
    }
    nodes.set(part.id, { id: part.id, incarnation: part.incarnation, first: part.first, last: part.last,
      children: part.children.map(child => child.id), memberY });
    return members;
  };
  for (const root of frame.roots) if (!collect(root)) return undefined;
  if (visited.size !== frame.nodes.size) return undefined;
  return { step: frame.step, canvas: frame.step.replayCanvasData, roots: frame.roots.map(root => root.id), nodes };
}

export function matchesWorkspaceNativeVerticalReference(
  frame: ContourFrame, reference: WorkspaceNativeVerticalReference,
): boolean {
  if (frame.step !== reference.step || frame.step.replayCanvasData !== reference.canvas
    || frame.roots.length !== reference.roots.length || frame.nodes.size !== reference.nodes.size
    || frame.roots.some((root, index) => root.id !== reference.roots[index])) return false;
  const visited = new Set<string>();
  const matches = (part: LifetimeContour): boolean => {
    const old = reference.nodes.get(part.id);
    if (!old || visited.has(part.id) || frame.nodes.get(part.id) !== part
      || part.incarnation !== old.incarnation || part.first !== old.first || part.last !== old.last
      || part.children.length !== old.children.length || part.members.size !== old.memberY.size) return false;
    visited.add(part.id);
    for (const [id, point] of part.members) {
      const oldY = old.memberY.get(id);
      if (oldY === undefined || !Number.isFinite(point.x) || !Number.isFinite(point.y)
        || Math.abs(point.y - oldY) > 1e-6) return false;
    }
    return part.children.every((child, index) => child.id === old.children[index] && matches(child));
  };
  return frame.roots.every(matches) && visited.size === reference.nodes.size;
}
