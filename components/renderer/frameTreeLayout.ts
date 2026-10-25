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

/** Each Canopy node's place, by its display ID in the Canopy canvas. */
export type CanopyPlaces = ReadonlyMap<string, { x: number; y: number }>;

/**
 * The Canopy is the last Replay frame without its relation marks, so each of
 * its nodes takes the place of the same occurrence in that frame, found by id
 * or by the alias the frame keeps for an authored terminal. Returns null when
 * the frame does not show every Canopy node exactly once: a layout fault that
 * the view reports as Replay reports its own.
 */
export function canopyPlacesInReplayFrame(canopyCanvas: SyntaxNode, frame: CanopyReplayFrame,
  direction: TreeDirection, measurements?: TreeMeasurements): CanopyPlaces | null {
  const canvas = cloneSyntaxTree(frame.canvas), canopyClone = cloneSyntaxTree(canopyCanvas);
  if (!canvas || !canopyClone) return null;
  const root = d3.hierarchy(canvas), canopy = d3.hierarchy(canopyClone);
  applyVizIds(root);
  applyVizIds(canopy);
  const laidOut = layoutReplayFrameTree(root, frame.size, direction, frame.reservation, frame.visibleIds, measurements);
  const occurrences = indexHierarchyNodesByIdAndAliases(laidOut.descendants());
  const matched = new Map<d3.HierarchyNode<SyntaxNode>, d3.HierarchyPointNode<SyntaxNode>>();
  const used = new Set<d3.HierarchyPointNode<SyntaxNode>>();
  // Preorder visits a parent first, so its occurrence is known; generated ids
  // only count as the same node where the two trees have the same shape.
  for (const node of canopy.descendants()) {
    const occurrence = occurrences.get(getNodeId(node)) ?? occurrences.get(String(node.data.id || ''));
    if (!occurrence || used.has(occurrence)) return null;
    if ((node.parent ? matched.get(node.parent) : null) !== (occurrence.parent ?? null)) return null;
    if (frame.visibleIds && !isSyntheticWorkspaceRootNode(occurrence) && !frame.visibleIds.has(getNodeId(occurrence))) return null;
    used.add(occurrence);
    matched.set(node, occurrence);
  }
  return new Map([...matched].map(([node, occurrence]) => [getNodeId(node), { x: occurrence.x, y: occurrence.y }]));
}

/** Puts a hierarchy of the Canopy canvas the places were made for at those places. */
export function placeCanopy(canopy: d3.HierarchyNode<SyntaxNode>, places: CanopyPlaces): d3.HierarchyPointNode<SyntaxNode> {
  applyVizIds(canopy);
  canopy.each(node => {
    const place = places.get(getNodeId(node));
    if (!place) throw new Error(`The Canopy has no place for ${getNodeId(node)}.`);
    Object.assign(node, place);
  });
  return canopy as d3.HierarchyPointNode<SyntaxNode>;
}
