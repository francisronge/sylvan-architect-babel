import type { ContourFrame, LifetimeContour, Point } from './workspaceLifetimeContours.ts';
import { matchesWorkspaceNativeVerticalReference, type WorkspaceNativeVerticalReference } from './workspaceNativeVerticalReference.ts';

const EPSILON = 1e-6;
export const ROOT_DISPLACEMENT_FRACTION = 0.01;
export const LOCAL_SPAN_FRACTION = 0.1;

/** Decide whether further cosmetic search is worthwhile after a complete plan
 * has passed its geometry and temporal constraints. Small global displacement
 * is insufficient by itself: every local fork/edge must also preserve its span,
 * and all relative vertical coordinates must remain unchanged. An explicit
 * native reference permits only the ranks already established by that complete
 * composition; callers must still validate placement and rendered geometry. */
export function withinWorkspaceVisualPreference(
  frame: ContourFrame, reference: ReadonlyMap<string, Point>,
  nativeVertical?: WorkspaceNativeVerticalReference,
): boolean {
  if (nativeVertical && !matchesWorkspaceNativeVerticalReference(frame, nativeVertical)) return false;
  const sameSpan = (before: number, after: number) => {
    if (Math.abs(before) <= EPSILON || Math.abs(after) <= EPSILON) {
      return Math.abs(before) <= EPSILON && Math.abs(after) <= EPSILON;
    }
    return Math.abs(after / before - 1) <= LOCAL_SPAN_FRACTION + Number.EPSILON;
  };
  for (const root of frame.roots) {
    const oldRoot = reference.get(root.id);
    if (!oldRoot || [...root.members.keys()].some(id => !reference.has(id))) return false;
    if (nativeVertical && [...root.members.keys()].some(id => {
      const point = reference.get(id)!;
      return !Number.isFinite(point.x) || !Number.isFinite(point.y);
    })) return false;
    const oldXs = [...root.members.keys()].map(id => reference.get(id)!.x);
    const span = Math.max(...oldXs) - Math.min(...oldXs);
    if (nativeVertical && !Number.isFinite(span)) return false;
    for (const [id, point] of root.members) {
      const old = reference.get(id)!;
      if (Math.abs(point.x - (old.x - oldRoot.x)) > ROOT_DISPLACEMENT_FRACTION * span + EPSILON
        || (!nativeVertical && Math.abs(point.y - (old.y - oldRoot.y)) > EPSILON)) return false;
    }
    const localSpansMatch = (part: LifetimeContour): boolean => {
      const oldParent = reference.get(part.id)!;
      const currentParent = root.members.get(part.id)!;
      for (const [index, child] of part.children.entries()) {
        const old = reference.get(child.id)!, current = root.members.get(child.id)!;
        if (!sameSpan(old.x - oldParent.x, current.x - currentParent.x)) return false;
        if (index) {
          const prior = part.children[index - 1];
          if (!sameSpan(old.x - reference.get(prior.id)!.x, current.x - root.members.get(prior.id)!.x)) return false;
        }
        if (!localSpansMatch(child)) return false;
      }
      return true;
    };
    if (!localSpansMatch(root)) return false;
  }
  return true;
}
