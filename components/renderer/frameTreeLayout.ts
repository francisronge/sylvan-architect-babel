import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../../replay/displayIdentity.ts';
import { indexHierarchyNodesByIdAndAliases, isSyntheticWorkspaceRootNode } from '../../replay/replayCanvas.ts';
import { stageTreeLayoutSize, type MeasuredStageCoordinates, type StageLayoutInput } from '../../replay/stageCamera.ts';
import { cloneSyntaxTree } from '../../replay/syntaxForest.ts';
import { layoutSyntaxTree, type TreeCoordinateReservation, type TreeDirection } from '../../replay/treeLayout.ts';
import type { PlaybackStep } from '../../replay/types.ts';
import type { SyntaxNode } from '../../types.ts';
import { alignReplayUnaryTerminalLeaves } from './treeNotation.ts';

type TreeMeasurements = Parameters<typeof layoutSyntaxTree>[5];

/**
 * One Replay frame's syntax where it is painted: the stage's reservation, the
 * current parents centred over their current children, and each unary terminal
 * under its parent. A frame without a reservation is packed fresh.
 */
export function layoutReplayFrameTree(root: d3.HierarchyNode<SyntaxNode>, size: [number, number], direction: TreeDirection,
  reservation: TreeCoordinateReservation | undefined, visibleIds: Set<string> | null, measurements?: TreeMeasurements) {
  const tree = layoutSyntaxTree(root, size, direction, reservation, reservation ? visibleIds ?? undefined : undefined, measurements);
  alignReplayUnaryTerminalLeaves(tree, visibleIds);
  return tree;
}

/** The last Replay frame, as the Canopy reads it: that frame's canvas, stage size, reservation and visible syntax. */
export type CanopyReplayFrame = {
  canvas: SyntaxNode;
  size: [number, number];
  reservation: TreeCoordinateReservation;
  visibleIds: Set<string> | null;
};

/**
 * The last Replay frame of a prepared layout, or null when Replay has no
 * frame or that frame's reservation has not been prepared.
 */
export function selectCanopyReplayFrame(steps: PlaybackStep[], coordinates: MeasuredStageCoordinates | undefined,
  viewport: { width: number; height: number }, layoutGroups?: StageLayoutInput['layoutGroups']): CanopyReplayFrame | null {
  const step = steps.at(-1);
  const stage = step?.replayFrameIndex;
  if (!step?.replayCanvasData || !Number.isInteger(stage)) return null;
  const reservation = coordinates?.get(stage!)?.get(step.replayCanvasData);
  if (!reservation) return null;
  const ids = step.replayVisibleNodeIds;
  return { canvas: step.replayCanvasData, reservation,
    size: stageTreeLayoutSize(steps, stage!, viewport.width, viewport.height, layoutGroups),
    visibleIds: Array.isArray(ids) && ids.length ? new Set(ids.map(id => String(id || '')).filter(Boolean)) : null };
}

/**
 * The Canopy is the last Replay frame without its relation marks, so each of
 * its nodes takes the place of the same occurrence in that frame, found by id
 * or by the alias the frame keeps for an authored terminal. Returns null when
 * the frame does not show every Canopy node exactly once; the caller then lays
 * the Canopy out fresh, as for an analysis without derivation stages.
 */
export function placeCanopyAtReplayFrame(canopy: d3.HierarchyNode<SyntaxNode>, frame: CanopyReplayFrame,
  direction: TreeDirection, measurements?: TreeMeasurements): d3.HierarchyPointNode<SyntaxNode> | null {
  const canvas = cloneSyntaxTree(frame.canvas);
  if (!canvas) return null;
  const root = d3.hierarchy(canvas);
  applyVizIds(root);
  const laidOut = layoutReplayFrameTree(root, frame.size, direction, frame.reservation, frame.visibleIds, measurements);
  const occurrences = indexHierarchyNodesByIdAndAliases(laidOut.descendants());
  applyVizIds(canopy);
  const places = new Map<d3.HierarchyNode<SyntaxNode>, d3.HierarchyPointNode<SyntaxNode>>();
  const placed = new Set<d3.HierarchyPointNode<SyntaxNode>>();
  // Preorder visits a parent first, so its occurrence is known; generated ids
  // only count as the same node where the two trees have the same shape.
  for (const node of canopy.descendants()) {
    const occurrence = occurrences.get(getNodeId(node)) ?? occurrences.get(String(node.data.id || ''));
    if (!occurrence || placed.has(occurrence)) return null;
    if ((node.parent ? places.get(node.parent) : null) !== (occurrence.parent ?? null)) return null;
    if (frame.visibleIds && !isSyntheticWorkspaceRootNode(occurrence) && !frame.visibleIds.has(getNodeId(occurrence))) return null;
    placed.add(occurrence);
    places.set(node, occurrence);
  }
  for (const [node, occurrence] of places) Object.assign(node, { x: occurrence.x, y: occurrence.y });
  return canopy as d3.HierarchyPointNode<SyntaxNode>;
}
