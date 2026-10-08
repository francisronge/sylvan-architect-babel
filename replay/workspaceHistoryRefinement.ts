import type { SyntaxNode } from '../types.ts';
import type { ContourFrame, LifetimeContour, Point } from './workspaceLifetimeContours.ts';
import { currentWorkspaceMovements } from './currentWorkspaceMovements.ts';
import { LOCAL_SPAN_FRACTION } from './workspaceVisualPreference.ts';
import { workspaceFinalWidth } from './workspaceVisualScore.ts';

const EPSILON = 1e-6;
export const WORKSPACE_HISTORY_EVALUATION_LIMIT = 4;
type Positions = ReadonlyMap<string, Point>;

/** Only lifetimes ending at a proved movement can own this refinement.
 * Their current children supply the reference, never a later reuse of the ID. */
export function earlierWorkspaceForks(frames: readonly ContourFrame[], parts: Iterable<LifetimeContour>, references: ReadonlyMap<number, Positions>) {
  return [...parts].flatMap(part => {
    if (part.last >= frames.length - 1 || frames[part.last]?.step.replayKind !== 'macro') return [];
    const next = frames[part.last + 1];
    if (!currentWorkspaceMovements(next.step, frames[part.last].nodes, next.nodes)
      .some(link => part.members.has(link.priorSourceNodeId))) return [];
    const current = frames[part.last].nodes.get(part.id), reference = references.get(part.incarnation);
    if (current?.incarnation !== part.incarnation || !reference) return [];
    return part.children.slice(1).flatMap((child, offset) => {
      const index = offset + 1, left = part.children[offset];
      const oldLeft = reference.get(left.id), oldRight = reference.get(child.id);
      const a = current.members.get(left.id), b = current.members.get(child.id);
      const gap = a && b && b.x - a.x, original = oldLeft && oldRight && oldRight.x - oldLeft.x;
      return gap !== undefined && original !== undefined && Number.isFinite(gap) && Number.isFinite(original)
        && original > EPSILON && gap > original * (1 + LOCAL_SPAN_FRACTION) + EPSILON
        ? [{ part, index, reference: original, distortion: gap / original - 1 }] : [];
    });
  }).sort((a, b) => b.distortion - a.distortion || a.part.first - b.part.first || a.index - b.index);
}

/** Earlier compaction must not move the cost elsewhere: completed roots cannot
 * widen, individual current branches cannot drift farther from their own stage
 * reference, and the final contour is retained exactly within geometry epsilon.
 * Full pose/paint validation still owns continuity, ink clearance and motion. */
export function prepareWorkspaceHistoryGuard(frames: readonly ContourFrame[], references: ReadonlyMap<SyntaxNode, Positions>, coordinates: readonly Positions[]) {
  const completed = frames.flatMap((frame, index) => frame.step.replayKind === 'macro' || index === frames.length - 1 ? [index] : []);
  const widths = new Map(completed.map(index => [index, workspaceFinalWidth(coordinates[index])]));
  const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= EPSILON;
  return {
    contours(candidate: readonly ContourFrame[]) {
      if (candidate.length !== frames.length) return false;
      for (const index of completed) {
        const before = frames[index], after = candidate[index], reference = references.get(before.step.replayCanvasData!);
        if (!reference || before.roots.length !== after.roots.length || before.nodes.size !== after.nodes.size) return false;
        for (const root of before.roots) {
          const current = after.roots.find(item => item.id === root.id);
          if (!current || current.members.size !== root.members.size) return false;
          const width = workspaceFinalWidth(current.members), oldWidth = workspaceFinalWidth(root.members);
          if (!Number.isFinite(width) || !Number.isFinite(oldWidth) || width > oldWidth + EPSILON) return false;
          for (const [id, point] of root.members) {
            const next = current.members.get(id);
            if (!next || !close(point.y, next.y) || (index === frames.length - 1 && !close(point.x, next.x))) return false;
          }
        }
        for (const part of before.nodes.values()) {
          const current = after.nodes.get(part.id), origin = reference.get(part.id);
          if (!current || !origin || current.children.length !== part.children.length) return false;
          for (const [offset, child] of part.children.entries()) {
            if (current.children[offset].id !== child.id) return false;
            const old = part.members.get(child.id), next = current.members.get(child.id), preferred = reference.get(child.id);
            if (!old || !next || !preferred || ![old.x, next.x, preferred.x, origin.x].every(Number.isFinite)
              || Math.abs(next.x - (preferred.x - origin.x)) > Math.abs(old.x - (preferred.x - origin.x)) + EPSILON) return false;
            if (offset) {
              const previous = part.children[offset - 1].id;
              const prior = part.members.get(previous), nextPrior = current.members.get(previous), referencePrior = reference.get(previous);
              if (!prior || !nextPrior || !referencePrior
                || Math.abs(next.x - nextPrior.x - (preferred.x - referencePrior.x)) > Math.abs(old.x - prior.x - (preferred.x - referencePrior.x)) + EPSILON) return false;
            }
          }
        }
      }
      return true;
    },
    placement(candidate: readonly Positions[]) {
      if (candidate.length !== coordinates.length || !completed.every(index => {
        const width = workspaceFinalWidth(candidate[index]);
        return Number.isFinite(width) && width <= widths.get(index)! + EPSILON;
      })) return false;
      const before = coordinates.at(-1)!, after = candidate.at(-1)!;
      const origin = before.entries().next().value;
      if (!origin || before.size !== after.size) return false;
      const nextOrigin = after.get(origin[0]);
      if (!nextOrigin) return false;
      const dx = nextOrigin.x - origin[1].x, dy = nextOrigin.y - origin[1].y;
      return [...before].every(([id, point]) => {
        const next = after.get(id);
        return next && close(next.x - point.x, dx) && close(next.y - point.y, dy);
      });
    },
  };
}
