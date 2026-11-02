import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { isSyntheticWorkspaceRootNode } from './replayCanvas.ts';
import { stageVerticalGeometry } from './stageVerticalGeometry.ts';
import type { PlaybackStep } from './types.ts';

/** Each painted node's row height (tree units) in each step, by step and node id. */
export type ReplayRows = ReadonlyMap<PlaybackStep, ReadonlyMap<string, number>>;

const plans = new WeakMap<readonly PlaybackStep[], { rows: ReplayRows; seeded: boolean }>();

/**
 * One row plan for the whole Replay. A tree grows from its root, so a parent
 * inserted above existing syntax deepens everything under it by a row. Walking
 * back from the last step through every step of every stage, each separately
 * painted piece of a step (a tree, a waiting phrase) is instead placed so that
 * the larger part of the syntax it shares with the next step keeps its row:
 * the smaller part above an insertion rises, a waiting phrase waits at the row
 * it merges at, and a piece the step does not touch stays where it is. The
 * last step keeps the rows its layout gives it (`finalRows`, by node id), so
 * the finished tree and the Canopy are unchanged.
 *
 * Rows are whole multiples of the stage's row height counted from a common
 * origin, so stages need no vertical alignment to each other. Only painted
 * syntax is planned; reserved, unpainted nodes keep the rows the layout gave.
 */
export function planReplayRows(steps: readonly PlaybackStep[], finalRows?: ReadonlyMap<string, number>): ReplayRows {
  const cached = plans.get(steps);
  if (cached && (cached.seeded || !finalRows)) return cached.rows;
  // Stage order, then each stage's own step order (as the stage layout reads
  // it), so the plan never depends on how the step list is ordered.
  const within = (step: PlaybackStep) => step.replayStageStepIndex ?? (step.replayKind === 'macro' ? Infinity : 0);
  const framed = steps.filter(step => step.replayCanvasData && step.replayFrameIndex !== undefined)
    .sort((a, b) => a.replayFrameIndex! - b.replayFrameIndex! || within(a) - within(b));
  const geometry = new Map<number, ReturnType<typeof stageVerticalGeometry>>();
  const syntax = (node: d3.HierarchyNode<SyntaxNode>) => !node.data.replayLayoutOnly
    && node.data.replayOrigin?.kind !== 'workspace' && !isSyntheticWorkspaceRootNode(node);
  const scenes = framed.map(step => {
    const stage = step.replayFrameIndex!;
    if (!geometry.has(stage)) geometry.set(stage, stageVerticalGeometry(steps.filter(other => other.replayFrameIndex === stage)));
    const { rowHeight, temporaryRootDepth } = geometry.get(stage)!;
    const canvas = step.replayCanvasData!, root = d3.hierarchy(canvas);
    applyVizIds(root);
    const visible = new Set(step.replayVisibleNodeIds ?? root.descendants().map(getNodeId));
    const depthRow = new Map<string, number>(), piece = new Map<string, string>(), ancestry = new Map<string, string[]>();
    root.each(node => {
      const id = getNodeId(node);
      if (!syntax(node) || !visible.has(id)) return;
      depthRow.set(id, (node.depth - temporaryRootDepth(canvas)) * rowHeight);
      ancestry.set(id, node.ancestors().slice(1).filter(ancestor => syntax(ancestor) && visible.has(getNodeId(ancestor))).map(getNodeId));
      // A piece is the painted tree a node hangs in: walk up painted branches.
      let top = node;
      while (top.parent && syntax(top.parent) && visible.has(getNodeId(top.parent))) top = top.parent;
      piece.set(id, getNodeId(top));
    });
    return { step, depthRow, piece, ancestry };
  });
  const rows = new Map<PlaybackStep, Map<string, number>>();
  let next: Map<string, number> | undefined, nextScene: (typeof scenes)[number] | undefined;
  // Syntax that keeps its painted parents votes, and so does a piece that
  // attaches to more syntax above it; what a step moves out of its parents
  // follows its own new place.
  const keepsParents = (id: string, before: (typeof scenes)[number], after: (typeof scenes)[number]) => {
    const prior = before.ancestry.get(id)!.filter(ancestor => after.ancestry.has(ancestor));
    const current = after.ancestry.get(id)!.filter(ancestor => before.ancestry.has(ancestor));
    return prior.length <= current.length && prior.every((ancestor, index) => ancestor === current[index]);
  };
  for (let index = scenes.length - 1; index >= 0; index--) {
    const scene = scenes[index], { step, depthRow, piece } = scene;
    const shifts = new Map<string, number[]>();
    if (next && nextScene) for (const [id, row] of depthRow) {
      const later = next.get(id);
      if (later === undefined || !keepsParents(id, scene, nextScene)) continue;
      const list = shifts.get(piece.get(id)!) ?? [];
      list.push(later - row);
      shifts.set(piece.get(id)!, list);
    }
    // A tie keeps the lower half still: half a piece is not its larger part.
    const offsets = new Map([...shifts].map(([top, list]) => [top, list.sort((a, b) => a - b)[(list.length - 1) >> 1]]));
    const planned = new Map<string, number>();
    for (const [id, row] of depthRow) planned.set(id, !next && finalRows?.has(id) ? finalRows.get(id)! : row + (offsets.get(piece.get(id)!) ?? 0));
    rows.set(step, planned);
    next = planned; nextScene = scene;
  }
  plans.set(steps, { rows, seeded: Boolean(finalRows) });
  return rows;
}
