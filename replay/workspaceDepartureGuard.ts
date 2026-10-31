import { currentWorkspaceMovements } from './currentWorkspaceMovements.ts';
import type { ContourFrame, LifetimeContour } from './workspaceLifetimeContours.ts';

/** Per frame, the IDs a movement there leaves on its lower occurrence: the
 * analysis gave the moved source's ID to the occurrence it leaves behind, not
 * to the landing. */
export function workspaceLeftBehindIds(frames: readonly ContourFrame[]): ReadonlyMap<number, ReadonlySet<string>> {
  const result = new Map<number, Set<string>>();
  frames.forEach((frame, index) => {
    if (index) for (const link of currentWorkspaceMovements(frame.step, frames[index - 1].nodes, frame.nodes))
      if (link.witnessNodeId === link.priorSourceNodeId) result.set(index, (result.get(index) ?? new Set()).add(link.witnessNodeId));
  });
  return result;
}

/** A fork whose daughter moves away at the step that ends its lifetime, its
 * lower occurrence keeping the daughter's ID, can be measured on the final fork
 * (workspaceRealizedGap matches children by ID), where only that lower
 * occurrence stands, while refinement adjusts the earlier fork the daughter
 * waits in. Such a refinement can widen or narrow the room around the waiting
 * daughter for the sake of other syntax, and the lower occurrence and its
 * sisters then cross that room at the movement. (With the landing keeping the
 * ID the fork is measured where the daughter still waits.) Returns, for such a
 * fork, how far its daughters shift inside it at that movement under a plan's
 * frames, else undefined. */
export function workspaceDepartureJump(part: LifetimeContour, leftBehind: ReadonlyMap<number, ReadonlySet<string>>) {
  const departing = leftBehind.get(part.last + 1);
  if (!part.children.some(child => departing?.has(child.id))) return undefined;
  return (frames: readonly ContourFrame[]) => {
    const before = frames[part.last]?.nodes.get(part.id), after = frames[part.last + 1]?.nodes.get(part.id);
    let jump = 0;
    if (before && after) for (const child of part.children) {
      const old = before.members.get(child.id), current = after.members.get(child.id);
      if (old && current) jump = Math.max(jump, Math.abs(current.x - old.x));
    }
    return jump;
  };
}
