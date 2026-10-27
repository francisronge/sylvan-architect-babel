import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { carriedShift } from './cameraCarry.ts';
import { categoryMetricKey } from './categoryMetricKey.ts';
import { categoryTextLayout, type CategoryTextMeasure } from './categoryTextLayout.ts';
import { compactCurrentRootForks } from './currentRootCompaction.ts';
import { retainCurrentRootFork } from './currentRootFork.ts';
import { retainCurrentSiblingRanks, retainCurrentDaughterRanks } from './currentSiblingRanks.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { retainedSubtreeMaterial } from './displayWordMaterial.ts';
import { reserveMovementSlotClearance } from './movementSlotClearance.ts';
import { retainMovementSourceSlots } from './movementSourceContinuity.ts';
import { siblingContoursOrdered } from './siblingContours.ts';
import { stageVerticalGeometry } from './stageVerticalGeometry.ts';
import type { TreeInkTextMeasure } from './treeInkGeometry.ts';
import { treeInkMetricKey } from './treeInkMetricKey.ts';
import { treeLabelMetricKey } from './treeLabelMetricKey.ts';
import type { PreparedTreeLabelRuns, TreeLabelMeasure } from './treeLabelRuns.ts';
import { layoutSyntaxTree, type TreeCoordinateReservation, type TreeDirection } from './treeLayout.ts';
import { clearTreeText, paintedTreeText } from './treeTextClearance.ts';
import type { PlaybackStep } from './types.ts';
import { separateWorkspaceContours } from './workspaceContourClearance.ts';
import { reserveWorkspaceAttachments } from './workspacePlacement.ts';
import { reserveWaitingSlots } from './waitingSlots.ts';
import { workspaceContinuityReflows } from './workspaceShapeReflows.ts';
import { TREE_SIBLING_GAP } from './treeSpacing.ts';

type Scene = {
  canvas: SyntaxNode;
  nodes: Map<string, d3.HierarchyPointNode<SyntaxNode>>;
  visible: Set<string>;
  coordinates: TreeCoordinateReservation;
  constructionForest?: boolean;
};
type StageReservation = { categoryMetrics: string; treeInkMetrics: string; treeLabelMetrics: string; size: [number, number]; preceding?: TreeCoordinateReservation; frames: ReadonlyMap<SyntaxNode, TreeCoordinateReservation> };
const cache = new WeakMap<readonly PlaybackStep[], Map<string, StageReservation>>();
export type ContourPlanStatus = 'established' | 'repaired' | 'unresolved';
const contourPlans = new WeakMap<readonly PlaybackStep[], Map<ReadonlyMap<SyntaxNode, TreeCoordinateReservation>, ContourPlanStatus>>();
const orderedPlans = new WeakMap<ReadonlyMap<SyntaxNode, TreeCoordinateReservation>, boolean>();
/** Which coordinate plan each layout of these steps used: the established one,
 * the plan repaired for ordered sister contours, or neither ordered. */
export const getContourPlanStatuses = (steps: readonly PlaybackStep[]) => [...(contourPlans.get(steps)?.values() ?? [])];

const syntaxParent = (node: d3.HierarchyPointNode<SyntaxNode>) => node.ancestors().slice(1).find(ancestor =>
  !ancestor.data.replayLayoutOnly && ancestor.data.replayOrigin?.kind !== 'workspace');

function reserveScene(current: Scene, reference: Scene, retained: TreeCoordinateReservation): Scene {
  const relocated = new Set<string>();
  current.nodes.forEach((node, id) => {
    const other = reference.nodes.get(id);
    if (node.data.replayLayoutOnly || !other || other.data.replayLayoutOnly) return;
    const oldParent = syntaxParent(node);
    if (oldParent && !other.ancestors().some(ancestor => getNodeId(ancestor) === getNodeId(oldParent))) {
      node.each(descendant => relocated.add(getNodeId(descendant)));
    }
  });
  const coordinates: TreeCoordinateReservation = new Map();
  current.nodes.forEach((node, id) => {
    const other = reference.nodes.get(id), reserved = reference.coordinates.get(id);
    if (reserved && other && !relocated.has(id)
      && !node.data.replayLayoutOnly && !other.data.replayLayoutOnly) coordinates.set(id, reserved);
  });
  current.nodes.forEach((node, id) => {
    if (coordinates.has(id)) return;
    const isRetained = (candidate: d3.HierarchyPointNode<SyntaxNode>) =>
      coordinates.has(getNodeId(candidate)) && !relocated.has(getNodeId(candidate));
    const attachment = node.ancestors().slice(1).find(isRetained) ?? node.descendants().find(isRetained);
    const reserved = attachment && coordinates.get(getNodeId(attachment));
    coordinates.set(id, {
      x: node.x + (reserved && attachment ? reserved.x - attachment.x : 0),
      y: node.y + (reserved && attachment ? reserved.y - attachment.y : 0)
    });
  });
  retainCurrentSiblingRanks({ ...current, coordinates }, reference, retained, relocated);
  retainCurrentRootFork({ ...current, coordinates }, reference);
  return centerParents({ ...current, coordinates });
}

function centerParents(current: Scene): Scene {
  const coordinates = current.coordinates;
  // Centering belongs to the visible parent-child relation, not to the reserved
  // slot of a parent whose children have changed. Keep descendants stationary.
  [...current.nodes.values()].reverse().forEach(node => {
    if (node.data.replayLayoutOnly || !current.visible.has(getNodeId(node))) return;
    const children = (node.children ?? []).filter(child => !child.data.replayLayoutOnly && current.visible.has(getNodeId(child)));
    if (!children.length) return;
    const first = coordinates.get(getNodeId(children[0]))!, last = coordinates.get(getNodeId(children[children.length - 1]))!;
    const point = coordinates.get(getNodeId(node))!, center = (first.x + last.x) / 2;
    if (Math.abs(point.x - center) > 1e-8) coordinates.set(getNodeId(node), { ...point, x: center });
  });
  return current;
}

function hasValidBranches(scene: Scene) {
  const occupied = new Set<string>();
  for (const [id, node] of scene.nodes) {
    if (!scene.visible.has(id)) continue;
    const point = scene.coordinates.get(id)!;
    const position = `${point.x.toFixed(6)},${point.y.toFixed(6)}`;
    if (occupied.has(position)) return false;
    occupied.add(position);
    if (node.parent && scene.visible.has(getNodeId(node.parent))
      && point.y <= scene.coordinates.get(getNodeId(node.parent))!.y) return false;
    const children = (node.children ?? []).filter(child => scene.visible.has(getNodeId(child)));
    for (let index = 1; index < children.length; index++) {
      if (scene.coordinates.get(getNodeId(children[index - 1]))!.x
        >= scene.coordinates.get(getNodeId(children[index]))!.x) return false;
    }
  }
  return true;
}

/** When a relation opens a stage, a workspace awaiting attachment keeps its
 * completed shape. The later merge centers its new surrounding parents without
 * relaying out the untouched component first. */
function retainWorkspaceComponents(scenes: Scene[], preceding: Scene): Scene[] {
  const roots = [...preceding.nodes.values()].filter(node => preceding.visible.has(getNodeId(node))
    && (!node.parent || !preceding.visible.has(getNodeId(node.parent))
      || node.parent.data.replayOrigin?.kind === 'workspace'));
  if (roots.length < 2) return scenes;
  const first = scenes[scenes.length - 1];
  const unchanged = roots.filter(root => {
    const entry = first.nodes.get(getNodeId(root));
    if (!entry || (entry.parent && first.visible.has(getNodeId(entry.parent))
      && entry.parent.data.replayOrigin?.kind !== 'workspace')) return false;
    const finalParent = scenes[0].nodes.get(getNodeId(root))?.parent;
    if (!finalParent || !scenes[0].visible.has(getNodeId(finalParent))
      || finalParent.data.replayOrigin?.kind === 'workspace') return false;
    return scenes.every(scene => {
      const node = scene.nodes.get(getNodeId(root));
      return node && scene.visible.has(getNodeId(node))
        && retainedSubtreeMaterial(root.data) === retainedSubtreeMaterial(node.data);
    });
  });
  const reference = unchanged.find(node => node.children?.length);
  if (!reference) return scenes;
  const id = getNodeId(reference), childId = getNodeId(reference.children![0]);
  const oldRoot = preceding.coordinates.get(id)!, oldChild = preceding.coordinates.get(childId)!;
  const newRoot = first.coordinates.get(id)!, newChild = first.coordinates.get(childId)!;
  const scale = (oldChild.y - oldRoot.y) / (newChild.y - newRoot.y);
  if (!Number.isFinite(scale) || scale <= 0) return scenes;
  const offset = oldRoot.y - newRoot.y * scale;
  const result = scenes.map(scene => {
    const coordinates = new Map([...scene.coordinates].map(([id, point]) =>
      [id, { x: point.x, y: point.y * scale + offset }]));
    unchanged.forEach(root => root.each(node => {
      const id = getNodeId(node);
      const prior = preceding.coordinates.get(id)!;
      coordinates.set(id, { x: prior.x, y: prior.y });
    }));
    return centerParents({ ...scene, coordinates });
  });
  return result.every(hasValidBranches) ? result : scenes;
}

/** Reserve the whole earlier subtree, not only its attachment point. A compact
 * lower copy cannot stand in for the contour of the source that preceded it.
 * Coordinate lifetimes share leaf slots; actual constituents supply their order.
 * Independent workspace objects do not impose an ordering on each other. */
function reserveContours(scenes: Scene[], separateAttachments = false): Scene[] {
  const leaves = scenes.map(scene => [...scene.nodes.values()][0].leaves().filter(node => !node.data.replayLayoutOnly));
  // The container created by retained attachments is not a syntactic sibling
  // layout. Derive spacing from the completed tree and genuine forest scenes.
  const nativePitches = leaves.flatMap((nodes, sceneIndex) =>
    scenes[sceneIndex].constructionForest ? [] : nodes.slice(1).flatMap((node, index) => {
    const prior = nodes[index];
    return node.depth === prior.depth && node.x > prior.x
      ? [(node.x - prior.x) / (node.parent === prior.parent ? 2.5 : 3.5)] : [];
  }));
  const pitch = Math.min(...nativePitches);
  const points = new Map<string, number>(), edges = new Map<string, Map<string, number>>();
  const key = (scene: Scene, node: d3.HierarchyPointNode<SyntaxNode>) => {
    const point = scene.coordinates.get(getNodeId(node))!;
    // Authored sibling reorderings can reuse a point while reversing its order.
    // Separate those attachment paths instead of dropping a contour constraint.
    const attachment = separateAttachments ? node.ancestors().map(ancestor =>
      [getNodeId(ancestor), ancestor.parent?.children?.indexOf(ancestor) ?? 0]) : getNodeId(node);
    return JSON.stringify([attachment, point.x.toFixed(6), point.y.toFixed(6)]);
  };
  scenes.forEach((scene, sceneIndex) => leaves[sceneIndex].forEach((node, index, nodes) => {
    const id = key(scene, node);
    points.set(id, scene.coordinates.get(getNodeId(node))!.x);
    if (!index) return;
    const prior = nodes[index - 1], common = node.ancestors().find(ancestor => prior.ancestors().includes(ancestor));
    if (!common || common.data.replayOrigin?.kind === 'workspace') return;
    const priorId = key(scene, prior), next = edges.get(priorId) ?? new Map<string, number>();
    const distance = Math.min(Math.max(0, node.x - prior.x), pitch * (node.parent === prior.parent ? 2.5 : 3.5));
    next.set(id, Math.max(next.get(id) ?? 0, distance));
    edges.set(priorId, next);
  }));
  const indegree = new Map([...points.keys()].map(id => [id, 0]));
  for (const next of edges.values()) for (const id of next.keys()) indegree.set(id, indegree.get(id)! + 1);
  const ready = [...points.keys()].filter(id => !indegree.get(id));
  let visited = 0;
  while (ready.length) {
    const id = ready.pop()!;
    visited++;
    for (const [target, gap] of edges.get(id) ?? []) {
      points.set(target, Math.max(points.get(target)!, points.get(id)! + gap));
      indegree.set(target, indegree.get(target)! - 1);
      if (!indegree.get(target)) ready.push(target);
    }
  }
  if (visited !== points.size && !separateAttachments) return reserveContours(scenes, true);
  if (visited !== points.size) throw new Error('Conflicting Replay contour attachment order');
  const result = scenes.map(scene => {
    const coordinates = new Map(scene.coordinates);
    [...scene.nodes.values()][0].eachAfter(node => {
      const children = node.children?.filter(child => !child.data.replayLayoutOnly);
      const point = coordinates.get(getNodeId(node))!;
      if (children?.length) {
        const first = coordinates.get(getNodeId(children[0]))!, last = coordinates.get(getNodeId(children[children.length - 1]))!;
        coordinates.set(getNodeId(node), { ...point, x: (first.x + last.x) / 2 });
      } else if (!node.children?.length && !node.data.replayLayoutOnly) {
        coordinates.set(getNodeId(node), { ...point, x: points.get(key(scene, node))! });
      }
    });
    return centerParents({ ...scene, coordinates });
  });
  return result;
}

/** Reserve one stage's geometry separately from its current visible syntax.
 * Completed geometry reserves room for new parents before they appear. Unchanged
 * subtrees keep their entry positions when that leaves every current branch valid.
 * Actual reparenting retains the earlier subtree at its earlier attachment until
 * the owning moment. The same maps serve camera bounds, allocation and painting. */
function buildStageLocalCoordinates(steps: readonly PlaybackStep[], stageIndex: number, size: [number, number],
  sizeForStage?: (stageIndex: number) => [number, number] | null,
  measureCategoryText?: CategoryTextMeasure, measureTreeInk?: TreeInkTextMeasure,
  treeLabelRuns?: PreparedTreeLabelRuns, measureTreeLabel?: TreeLabelMeasure,
  { orderedContours = false }: { orderedContours?: boolean } = {}): ReadonlyMap<SyntaxNode, TreeCoordinateReservation> {
  let stages = cache.get(steps);
  if (!stages) cache.set(steps, stages = new Map());
  const frames = steps.filter(step => step.replayFrameIndex === stageIndex && step.replayCanvasData)
    .sort((a, b) => (a.replayStageStepIndex ?? (a.replayKind === 'macro' ? Infinity : 0))
      - (b.replayStageStepIndex ?? (b.replayKind === 'macro' ? Infinity : 0)));
  const previous = frames[0]?.replayKind === 'relation' && sizeForStage && steps.find(step => step.replayFrameIndex === stageIndex - 1 && step.replayKind === 'macro');
  const previousSize = previous && sizeForStage!(stageIndex - 1);
  const precedingCoordinates = previous?.replayCanvasData && previousSize
    ? buildStageLocalCoordinates(steps, stageIndex - 1, previousSize, sizeForStage, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel, { orderedContours }).get(previous.replayCanvasData) : undefined;
  const categoryMetrics = categoryMetricKey(steps, measureCategoryText);
  const treeInkMetrics = treeInkMetricKey(steps, measureCategoryText, measureTreeInk);
  const treeLabelMetrics = treeLabelMetricKey(steps, treeLabelRuns, measureTreeLabel);
  const cacheKey = `${stageIndex}:${orderedContours}`, cached = stages.get(cacheKey);
  if (cached && cached.size[0] === size[0] && cached.size[1] === size[1]
    && cached.categoryMetrics === categoryMetrics && cached.treeInkMetrics === treeInkMetrics && cached.treeLabelMetrics === treeLabelMetrics && cached.preceding === precedingCoordinates) return cached.frames;
  const { rowHeight, temporaryRootDepth } = stageVerticalGeometry(frames);
  const scenes: Scene[] = frames.map(step => {
    const canvas = step.replayCanvasData!, root = d3.hierarchy(canvas);
    applyVizIds(root);
    const tree = layoutSyntaxTree(root, size);
    // A temporary construction forest contributes no extra syntax level.
    tree.each(node => { node.y = (node.depth - temporaryRootDepth(canvas)) * rowHeight; });
    const visible = new Set(step.replayVisibleNodeIds ?? tree.descendants().map(getNodeId));
    // Styled-label measurements show where painted text runs into text on
    // another row; without them the D3 layout stands. Only the lines of the
    // label's own layout have measured widths: a run wrapped under other
    // measures keeps its cell width.
    const labels = measureTreeLabel && treeLabelRuns?.get(canvas);
    if (labels) clearTreeText(tree, node => visible.has(getNodeId(node))
      && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace', node => {
      const measured = new Set(measureCategoryText ? categoryTextLayout(node.data.label || '', measureCategoryText).lines : []);
      return paintedTreeText(labels.get(getNodeId(node)), measureTreeLabel!, line => measured.has(line) ? measureCategoryText!(line) : undefined);
    });
    const nodes = new Map<string, d3.HierarchyPointNode<SyntaxNode>>(tree.descendants().map(node => [getNodeId(node), node]));
    return { canvas, nodes, visible,
      constructionForest: Boolean(temporaryRootDepth(canvas) && step.replayPendingAttachmentNodeIds),
      coordinates: new Map([...nodes].map(([id, node]) => [id, { x: node.x, y: node.y }])) };
  });
  const entry = scenes[0];
  const retained = new Map<string, { x: number; y: number }>();
  if (entry) for (const [id, node] of entry.nodes) {
    if (retained.has(id) || !entry.visible.has(id) || node.data.replayLayoutOnly) continue;
    const parentId = node.parent && getNodeId(node.parent);
    if (!parentId || !entry.visible.has(parentId)) continue;
    const material = retainedSubtreeMaterial(node.data);
    if (!scenes.every(scene => {
      const match = scene.nodes.get(id);
      return match?.parent && scene.visible.has(id) && scene.visible.has(parentId)
        && JSON.stringify(match.ancestors().map(getNodeId)) === JSON.stringify(node.ancestors().map(getNodeId))
        && retainedSubtreeMaterial(match.data) === material;
    })) continue;
    node.each(descendant => retained.set(getNodeId(descendant), { x: descendant.x, y: descendant.y }));
  }
  const reserve = (retained: TreeCoordinateReservation) => {
    const completed: Scene[] = [];
    for (const scene of [...scenes].reverse()) completed.push(completed.length
      ? reserveScene(scene, completed[completed.length - 1], retained) : scene);
    return completed;
  };
  const completed = reserve(retained);
  const preserved = completed.map(scene => {
    const coordinates = new Map(scene.coordinates);
    retained.forEach((point, id) => coordinates.set(id, point));
    return centerParents({ ...scene, coordinates });
  });
  const resolved = preserved.every(hasValidBranches) ? preserved : reserve(new Map());
  const contours = reserveContours(resolved);
  for (const scene of contours.slice(1)) retainCurrentDaughterRanks(scene, contours[0], { lowerSmallerAbove: true });
  let finalScenes = separateWorkspaceContours(contours, measureCategoryText);
  if (frames[0]?.replayKind === 'relation' && previous?.replayCanvasData && precedingCoordinates) {
    const root = d3.hierarchy(previous.replayCanvasData); applyVizIds(root);
    const nodes = new Map<string, d3.HierarchyPointNode<SyntaxNode>>(
      layoutSyntaxTree(root, previousSize!, 'ltr', precedingCoordinates).descendants().map(node => [getNodeId(node), node]));
    const retained = retainWorkspaceComponents(finalScenes, { canvas: previous.replayCanvasData, nodes,
      coordinates: precedingCoordinates, visible: new Set(previous.replayVisibleNodeIds ?? nodes.keys()) });
    // The repair plan keeps this stage's own layout when a retained component would interleave a sister.
    if (!orderedContours || retained.every(scene => siblingContoursOrdered([...scene.nodes.values()]
      .filter(node => scene.visible.has(getNodeId(node))), 'ltr', node => scene.coordinates.get(getNodeId(node))!))) finalScenes = retained;
  }
  const reservations = new Map(finalScenes.map(scene => [scene.canvas, scene.coordinates]));
  stages.set(cacheKey, { size: [...size], categoryMetrics, treeInkMetrics, treeLabelMetrics, preceding: precedingCoordinates, frames: reservations });
  return reservations;
}

type StageFrames = ReadonlyMap<SyntaxNode, TreeCoordinateReservation>;
type StageOffset = { x: number; y: number };
type PaintedFrame = readonly [TreeCoordinateReservation | undefined, [number, number]] | undefined;
const stageOffsets = new WeakMap<StageFrames, WeakMap<object, StageOffset>>();
const completedStage = {};
const alignedStages = new WeakMap<StageFrames, Map<string, StageFrames>>();
type PlanChoice = { mode: 'stage' | 'slotted' | 'aligned'; shift: StageOffset };
const alignedChoices = new WeakMap<StageFrames, PlanChoice>();
// Each chosen reservation translated onto the established plan's final tree, per
// shift, so a reused layout returns the same reservations.
const shiftedReservations = new WeakMap<TreeCoordinateReservation, Map<string, TreeCoordinateReservation>>();
// The slot pass per planned reservation, so a reused layout does not repeat it.
const slotPlans = new WeakMap<StageFrames, Map<string, StageFrames>>();
const stageStepOrder = (step: PlaybackStep) => step.replayStageStepIndex ?? (step.replayKind === 'macro' ? Infinity : 0);
const stageSteps = (steps: readonly PlaybackStep[], stage: number) => steps
  .filter(step => step.replayFrameIndex === stage && step.replayCanvasData).sort((a, b) => stageStepOrder(a) - stageStepOrder(b));

function paintedSyntax(step: PlaybackStep, size: [number, number], coordinates: TreeCoordinateReservation) {
  const root = d3.hierarchy(step.replayCanvasData!); applyVizIds(root);
  const visible = new Set<string>(step.replayVisibleNodeIds ?? root.descendants().map(node => getNodeId(node)));
  return new Map<string, d3.HierarchyPointNode<SyntaxNode>>(layoutSyntaxTree(root, size, 'ltr', coordinates, visible).descendants()
    .filter(node => visible.has(getNodeId(node)) && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace')
    .map(node => [getNodeId(node), node] as const));
}

/** Each stage lays out its own frame, centred on its own size. Those origins are
 * arbitrary, but retained workspaces and attachment lifetimes carry coordinates
 * across stage boundaries. Translate each earlier stage, as a whole, by the median
 * shift of the unmoved syntax painted on both sides of its closing boundary, as the
 * camera carry does; the remaining motion is then that boundary's real change. The
 * completed stage is the anchor, so the final tree keeps its coordinates. A
 * translation leaves every stage's own geometry and camera fit unchanged. */
function stageOffset(steps: readonly PlaybackStep[], stage: number, sizeForStage: (stage: number) => [number, number] | null,
  local: (stage: number, size: [number, number]) => StageFrames): StageOffset {
  const size = sizeForStage(stage), nextSize = sizeForStage(stage + 1);
  if (!size) return { x: 0, y: 0 };
  // An offset depends on this stage's local frames and on the aligned frames of
  // every later stage, which the next stage's aligned frames already embody.
  const frames = local(stage, size);
  const next = nextSize && stageSteps(steps, stage + 1).length
    ? alignedStageCoordinates(steps, stage + 1, nextSize, sizeForStage, local) : undefined;
  let offsets = stageOffsets.get(frames);
  if (!offsets) stageOffsets.set(frames, offsets = new WeakMap());
  const cached = offsets.get(next ?? completedStage);
  if (cached) return cached;
  const closing = stageSteps(steps, stage).at(-1), opening = stageSteps(steps, stage + 1)[0];
  let offset: StageOffset = { x: 0, y: 0 };
  if (next && nextSize && closing && opening) {
    offset = carriedShift(paintedSyntax(closing, size, frames.get(closing.replayCanvasData!)!),
      paintedSyntax(opening, nextSize, next.get(opening.replayCanvasData!)!));
  }
  offsets.set(next ?? completedStage, offset);
  return offset;
}

function alignedStageCoordinates(steps: readonly PlaybackStep[], stage: number, size: [number, number],
  sizeForStage: (stage: number) => [number, number] | null,
  local: (stage: number, size: [number, number]) => StageFrames): StageFrames {
  const frames = local(stage, size);
  const { x, y } = stageOffset(steps, stage, sizeForStage, local);
  if (!x && !y) return frames;
  let aligned = alignedStages.get(frames);
  if (!aligned) alignedStages.set(frames, aligned = new Map());
  const key = `${x},${y}`;
  let result = aligned.get(key);
  if (!result) aligned.set(key, result = new Map([...frames].map(([canvas, coordinates]) => [canvas,
    new Map([...coordinates].map(([id, point]) => [id, { x: point.x + x, y: point.y + y }]))])));
  return result;
}

/** A stage's local frames as the alignment translates them, before cross-stage
 * planning. Diagnostics and cache checks read this; layout uses the plans below. */
export function alignedStageFrames(steps: readonly PlaybackStep[], stage: number, size: [number, number],
  sizeForStage: (stage: number) => [number, number] | null): StageFrames {
  return alignedStageCoordinates(steps, stage, size, sizeForStage, (index, stageSize) =>
    buildStageLocalCoordinates(steps, index, stageSize, sizeForStage));
}

/** Motion a plan's own frames show: components the step does not own that move,
 * and existing daughters that move as a new parent joins them. A host lowered
 * below an inserted parent that takes its row keeps only its horizontal motion.
 * A component that keeps its painted parent stays one row below it, so when the
 * step moves that parent to another row the component's row change is the
 * parent's; its other motion counts. */
function planMotion(steps: readonly PlaybackStep[], painted: (step: PlaybackStep) => PaintedFrame) {
  // Playback order, whatever order the steps were passed in.
  const ordered = [...steps].sort((a, b) => (a.replayFrameIndex ?? 0) - (b.replayFrameIndex ?? 0) || stageStepOrder(a) - stageStepOrder(b));
  const scenes = ordered.flatMap(step => {
    const [coordinates, size] = step.replayCanvasData && painted(step) || [];
    return coordinates && size ? [{ step, canvas: step.replayCanvasData!, size, coordinates,
      nodes: paintedSyntax(step, size, coordinates) }] : [];
  });
  const render = (scene: typeof scenes[number]) => [...scene.nodes.values()];
  const paintedParent = (scene: typeof scenes[number], id: string) => {
    const parent = scene.nodes.get(id)?.parent;
    return parent && scene.nodes.has(getNodeId(parent)) ? getNodeId(parent) : null;
  };
  const unowned = new Map(workspaceContinuityReflows(scenes, new Map(scenes.map(scene => [scene.canvas, scene.coordinates])), render)
    // A component whose painted parent changes is attaching at that step, which owns its motion.
    .filter(reflow => reflow.kind === 'unowned-component-motion' && paintedParent(scenes[reflow.index], reflow.rootId)
      === paintedParent(scenes[reflow.index - 1], reflow.rootId)).map(reflow => {
      // Across a stage crossing, distance is measured after the camera carry.
      const before = scenes[reflow.index - 1], after = scenes[reflow.index];
      const carry = before.step.replayFrameIndex === after.step.replayFrameIndex ? { x: 0, y: 0 } : carriedShift(before.nodes, after.nodes);
      const from = before.nodes.get(reflow.rootId)!, to = after.nodes.get(reflow.rootId)!, parent = paintedParent(after, reflow.rootId);
      const rows = parent ? after.nodes.get(parent)!.y - before.nodes.get(parent)!.y : carry.y;
      return [`${reflow.index}:${reflow.rootId}`, Math.hypot(to.x - from.x - carry.x, to.y - from.y - rows)] as const;
    }));
  const joins = new Map<string, number>();
  scenes.forEach((scene, index) => {
    const before = scenes[index - 1], target = scene.step.targetNodeId, parent = target && scene.nodes.get(target);
    if (!before || scene.step.replayKind !== 'micro' || !['ExternalMerge', 'Project'].includes(scene.step.operation)
      || !parent || before.nodes.has(target)) return;
    // At an insertion the host descends under the new parent; only its
    // horizontal motion counts.
    const priorParent = (id: string) => { const old = before.nodes.get(id)?.parent; return old && before.nodes.has(getNodeId(old)) ? getNodeId(old) : null; };
    const grand = parent.parent && scene.nodes.has(getNodeId(parent.parent)) ? getNodeId(parent.parent) : null;
    const insertion = Boolean(grand) && (parent.children ?? []).some(child => priorParent(getNodeId(child)) === grand);
    for (const node of parent.children ?? []) {
      const id = getNodeId(node), now = scene.nodes.get(id), prior = before.nodes.get(id);
      if (!now || !prior) continue;
      const descends = insertion && Math.abs(parent.y - prior.y) < 1e-6 && now.y > parent.y;
      const distance = descends ? Math.abs(now.x - prior.x) : Math.hypot(now.x - prior.x, now.y - prior.y);
      if (distance > 1) joins.set(`${index}:${id}`, distance);
    }
  });
  const moves = new Map<string, number>();
  scenes.forEach((scene, index) => {
    const before = scenes[index - 1];
    if (before) for (const [id, node] of scene.nodes) {
      const prior = before.nodes.get(id);
      if (prior) moves.set(`${index}:${id}`, Math.hypot(node.x - prior.x, node.y - prior.y));
    }
  });
  const last = scenes.at(-1);
  return { unowned, joins, moves, count: unowned.size + joins.size,
    final: last ? [...last.nodes].map(([id, node]) => [id, node.x, node.y] as const) : [] };
}

/** The painted shift that carries one plan's final tree onto another's, when
 * every final node keeps its place relative to the others; null otherwise. Such
 * a translation is the same tree, since the stage camera fits it. */
function finalTreeShift(before: ReturnType<typeof planMotion>, after: ReturnType<typeof planMotion>): StageOffset | null {
  const final = new Map(before.final.map(([id, x, y]) => [id, [x, y]]));
  const [first] = after.final, origin = first && final.get(first[0]);
  if (after.final.length !== before.final.length || (first && !origin)) return null;
  const x = first ? first[1] - origin![0] : 0, y = first ? first[2] - origin![1] : 0;
  return after.final.every(([id, px, py]) => final.has(id) && Math.hypot(px - x - final.get(id)![0], py - y - final.get(id)![1]) <= 1e-6)
    ? { x, y } : null;
}

/** An aligned plan replaces an established one only when it removes motion and
 * adds none: no new unowned component, no surviving one or join that moves
 * farther, and the same final tree. */
export function alignmentImprovesMotion(before: ReturnType<typeof planMotion>, after: ReturnType<typeof planMotion>) {
  return after.count < before.count && finalTreeShift(before, after) !== null
    && [...after.unowned].every(([key, distance]) => before.unowned.has(key) && distance <= before.unowned.get(key)! + 1e-6)
    && [...after.joins].every(([key, distance]) => distance <= (before.joins.get(key) ?? 1) + 1e-6);
}

/** Slots in stage-local frames change only the pieces they place, so they are
 * judged without ownership: no painted node may move farther in any frame, total
 * motion must fall, and the final tree stays the same. */
function slotsReduceMotion(before: ReturnType<typeof planMotion>, after: ReturnType<typeof planMotion>) {
  const total = (moves: ReadonlyMap<string, number>) => [...moves.values()].reduce((sum, distance) => sum + distance, 0);
  return after.count < before.count && total(after.moves) < total(before.moves) - 1
    && [...after.moves].every(([key, distance]) => distance <= (before.moves.get(key) ?? 0) + 1)
    && finalTreeShift(before, after) !== null;
}

/** All consumers share the same placement plan. Stage-local geometry is built
 * first; a retained workspace can then reserve its attachment position throughout
 * its compatible construction lifetime without importing future branch ranks.
 * The established plan stands when every painted frame keeps its sister contours
 * ordered. Otherwise the stage-local workspace retention and the attachment
 * lifetimes are planned again with ordered contours. That plan is used only if
 * every frame is then ordered; the outcome is recorded per layout. It is accepted
 * on contour order alone, without comparing motion or ink clearance: a lifetime
 * that ends early can move a lower occurrence and its ancestors at its moment.
 * When the chosen plan still moves syntax that a step does not own, or moves
 * material as it is joined, the same plan is made again with aligned stage
 * frames and replaces it only under `alignmentImprovesMotion`.
 *
 * Planning reads no writing direction: one plan, in left-to-right coordinates,
 * serves both directions (`reflectedReservations`), so every comparison it makes
 * across stages of different widths measures from the same edge. */
export function buildStageCoordinateReservations(steps: readonly PlaybackStep[], stageIndex: number, size: [number, number],
  sizeForStage?: (stageIndex: number) => [number, number] | null,
  direction: TreeDirection = 'ltr', measureCategoryText?: CategoryTextMeasure, measureTreeInk?: TreeInkTextMeasure,
  treeLabelRuns?: PreparedTreeLabelRuns, measureTreeLabel?: TreeLabelMeasure): ReadonlyMap<SyntaxNode, TreeCoordinateReservation> {
  const planned = planStageCoordinates(steps, stageIndex, size, sizeForStage, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel);
  return direction === 'rtl' ? reflectedReservations(steps, planned, size, sizeForStage) : planned;
}

// Each plan's right-to-left reservations, per translation, so a reused layout
// returns the same maps, and each such map's plan.
const reflections = new WeakMap<ReadonlyMap<SyntaxNode, TreeCoordinateReservation>, Map<number, ReadonlyMap<SyntaxNode, TreeCoordinateReservation>>>();
const reflectedPlans = new WeakMap<ReadonlyMap<SyntaxNode, TreeCoordinateReservation>, ReadonlyMap<SyntaxNode, TreeCoordinateReservation>>();

/** The x about which right-to-left Replay reflects every stage: the completed
 * stage's width, or `size`'s when no stage size is known. A painted
 * right-to-left x is this axis less the painted left-to-right x. */
export function rightToLeftAxis(steps: readonly PlaybackStep[], size: [number, number],
  sizeForStage?: (stageIndex: number) => [number, number] | null) {
  const completed = Math.max(...steps.flatMap(step => step.replayCanvasData && step.replayFrameIndex !== undefined ? [step.replayFrameIndex] : []));
  return Number.isFinite(completed) && sizeForStage?.(completed)?.[0] || size[0];
}

const translated = (frames: ReadonlyMap<SyntaxNode, TreeCoordinateReservation>, dx: number) => new Map([...frames].map(([canvas, points]) =>
  [canvas, new Map([...points].map(([id, point]) => [id, { x: point.x + dx, y: point.y }]))]));

/** A stage's right-to-left reservations: its left-to-right plan, translated so
 * that painting (layoutSyntaxTree reflects x about the stage width) reflects
 * every frame of every stage about the same axis, `rightToLeftAxis`.
 * Right-to-left Replay is then the left-to-right Replay reflected: the same rows,
 * the same relative positions and the same motion, and the camera carry across
 * a stage boundary is the left-to-right carry reflected. */
function reflectedReservations(steps: readonly PlaybackStep[], planned: ReadonlyMap<SyntaxNode, TreeCoordinateReservation>,
  size: [number, number], sizeForStage?: (stageIndex: number) => [number, number] | null) {
  const dx = size[0] - rightToLeftAxis(steps, size, sizeForStage);
  if (!dx) return planned;
  let byShift = reflections.get(planned);
  if (!byShift) reflections.set(planned, byShift = new Map());
  let result = byShift.get(dx);
  if (!result) {
    byShift.set(dx, result = translated(planned, dx));
    reflectedPlans.set(result, planned);
  }
  return result;
}

/** The left-to-right plan of one stage's right-to-left reservations, so work
 * that must be the reflection of its left-to-right result (plaque placement)
 * can run on the left-to-right layout. Reservations that crossed a worker
 * boundary are translated back. */
export function leftToRightReservations(steps: readonly PlaybackStep[], reflected: ReadonlyMap<SyntaxNode, TreeCoordinateReservation>,
  size: [number, number], sizeForStage?: (stageIndex: number) => [number, number] | null): ReadonlyMap<SyntaxNode, TreeCoordinateReservation> {
  const dx = size[0] - rightToLeftAxis(steps, size, sizeForStage);
  return !dx ? reflected : reflectedPlans.get(reflected) ?? translated(reflected, -dx);
}

function planStageCoordinates(steps: readonly PlaybackStep[], stageIndex: number, size: [number, number],
  sizeForStage?: (stageIndex: number) => [number, number] | null,
  measureCategoryText?: CategoryTextMeasure, measureTreeInk?: TreeInkTextMeasure,
  treeLabelRuns?: PreparedTreeLabelRuns, measureTreeLabel?: TreeLabelMeasure): ReadonlyMap<SyntaxNode, TreeCoordinateReservation> {
  const sizes = new Map<number, [number, number]>();
  if (sizeForStage) for (const step of steps) {
    if (step.replayFrameIndex === undefined || sizes.has(step.replayFrameIndex)) continue;
    const stageSize = sizeForStage(step.replayFrameIndex);
    if (stageSize) sizes.set(step.replayFrameIndex, stageSize);
  }
  // `stage`: the established plan. `slotted`: the same stage frames with waiting
  // and newly selected pieces at their attachment slots within each stage.
  // `aligned`: stage frames aligned to one origin, with slots across stages.
  const plan = (orderedContours: boolean, mode: 'stage' | 'slotted' | 'aligned' = 'stage') => {
    const alignStages = mode === 'aligned';
    const stageLocal = (stage: number, stageSize: [number, number]) => buildStageLocalCoordinates(steps, stage, stageSize, sizeForStage,
      measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel, { orderedContours });
    const local = alignStages && sizeForStage ? (stage: number, stageSize: [number, number]) =>
      alignedStageCoordinates(steps, stage, stageSize, sizeForStage, stageLocal) : stageLocal;
    const original = local(stageIndex, size);
    if (!sizeForStage) return { frames: original, key: original, painted: (step: PlaybackStep): PaintedFrame =>
      step.replayFrameIndex === stageIndex ? [original.get(step.replayCanvasData!), size] as const : undefined };
    const planned = reserveWorkspaceAttachments({ steps, sizes, direction: 'ltr', minimumSiblingGap: TREE_SIBLING_GAP, coordinatesForStage: local,
      measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel, orderedContours, alignedStages: alignStages });
    const compact = compactCurrentRootForks(steps, sizes, planned, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel);
    const retained = retainMovementSourceSlots(steps, sizes, compact, 'ltr', measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel);
    let slotted = slotPlans.get(retained);
    if (!slotted) slotPlans.set(retained, slotted = new Map());
    let continuous = mode === 'stage' ? retained : slotted.get(mode);
    if (!continuous) slotted.set(mode, continuous = reserveWaitingSlots({ steps, sizes, coordinates: retained, direction: 'ltr',
      measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel, withinStage: !alignStages }));
    // Every placement above can hold a movement's slot for its lower occurrence alone.
    continuous = reserveMovementSlotClearance({ steps, sizes, coordinates: continuous, direction: 'ltr',
      measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel });
    return { frames: new Map([...original].map(([canvas, coordinates]) => [canvas, continuous.get(canvas) ?? coordinates])),
      key: continuous, painted: (step: PlaybackStep): PaintedFrame => {
        const stageSize = sizes.get(step.replayFrameIndex!);
        return stageSize && [continuous.get(step.replayCanvasData!)
          ?? local(step.replayFrameIndex!, stageSize).get(step.replayCanvasData!), stageSize] as const;
      } };
  };
  const ordered = ({ key, painted }: ReturnType<typeof plan>) => {
    let result = orderedPlans.get(key);
    if (result === undefined) orderedPlans.set(key, result = steps.every(step => {
      const [coordinates, stageSize] = step.replayCanvasData && painted(step) || [];
      if (!coordinates || !stageSize) return true;
      const root = d3.hierarchy(step.replayCanvasData!); applyVizIds(root);
      const visible = new Set<string>(step.replayVisibleNodeIds ?? root.descendants().map(node => getNodeId(node)));
      return siblingContoursOrdered(layoutSyntaxTree(root, stageSize, 'ltr', coordinates, visible).descendants()
        .filter(node => visible.has(getNodeId(node))));
    }));
    return result;
  };
  // A plan with motion is replaced by the aligned plan when that removes motion
  // under `alignmentImprovesMotion`, otherwise by its slotted form when no painted
  // node moves farther in any frame. A replacement whose final tree is the
  // established one translated is moved back as a whole, every stage alike, so
  // the final tree keeps its coordinates and the camera sees no difference.
  const settle = (chosen: ReturnType<typeof plan>, orderedContours: boolean) => {
    if (!sizeForStage) return chosen.frames;
    let choice = alignedChoices.get(chosen.key);
    if (choice === undefined) {
      const before = planMotion(steps, chosen.painted);
      choice = { mode: 'stage', shift: { x: 0, y: 0 } };
      const accept = (mode: 'slotted' | 'aligned', candidate: ReturnType<typeof plan>, improves: typeof alignmentImprovesMotion) => {
        if (!ordered(candidate)) return false;
        const after = planMotion(steps, candidate.painted), shift = finalTreeShift(before, after);
        if (!shift || !improves(before, after)) return false;
        choice = { mode, shift: { x: -shift.x, y: -shift.y } };
        return true;
      };
      if (before.count && !accept('aligned', plan(orderedContours, 'aligned'), alignmentImprovesMotion))
        accept('slotted', plan(orderedContours, 'slotted'), slotsReduceMotion);
      alignedChoices.set(chosen.key, choice);
    }
    if (choice.mode === 'stage') return chosen.frames;
    const frames = plan(orderedContours, choice.mode).frames, { x, y } = choice.shift, key = `${x},${y}`;
    if (Math.abs(x) <= 1e-9 && Math.abs(y) <= 1e-9) return frames;
    return new Map([...frames].map(([canvas, coordinates]) => {
      let shifted = shiftedReservations.get(coordinates);
      if (!shifted) shiftedReservations.set(coordinates, shifted = new Map());
      let result = shifted.get(key);
      if (!result) shifted.set(key, result = new Map([...coordinates].map(([id, point]) => [id, { x: point.x + x, y: point.y + y }])));
      return [canvas, result] as const;
    }));
  };
  const established = plan(false);
  const record = (status: ContourPlanStatus) => {
    let statuses = contourPlans.get(steps);
    if (!statuses) contourPlans.set(steps, statuses = new Map());
    statuses.set(established.key, status);
  };
  if (ordered(established)) { record('established'); return settle(established, false); }
  const repaired = plan(true);
  if (ordered(repaired)) { record('repaired'); return settle(repaired, true); }
  record('unresolved');
  return established.frames;
}
