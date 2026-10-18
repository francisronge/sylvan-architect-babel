import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { categoryMetricKey } from './categoryMetricKey.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import { compactCurrentRootForks } from './currentRootCompaction.ts';
import { retainCurrentRootFork } from './currentRootFork.ts';
import { retainCurrentSiblingRanks, retainCurrentUnaryRank } from './currentSiblingRanks.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { retainedSubtreeMaterial } from './displayWordMaterial.ts';
import { retainMovementSourceSlots } from './movementSourceContinuity.ts';
import { siblingContoursOrdered } from './siblingContours.ts';
import { stageVerticalGeometry } from './stageVerticalGeometry.ts';
import type { TreeInkTextMeasure } from './treeInkGeometry.ts';
import { treeInkMetricKey } from './treeInkMetricKey.ts';
import { treeLabelMetricKey } from './treeLabelMetricKey.ts';
import type { PreparedTreeLabelRuns, TreeLabelMeasure } from './treeLabelRuns.ts';
import { layoutSyntaxTree, type TreeCoordinateReservation, type TreeDirection } from './treeLayout.ts';
import type { PlaybackStep } from './types.ts';
import { separateWorkspaceContours } from './workspaceContourClearance.ts';
import { reserveWorkspaceAttachments } from './workspacePlacement.ts';
import { TREE_SIBLING_GAP } from './treeSpacing.ts';

type Scene = {
  canvas: SyntaxNode;
  nodes: Map<string, d3.HierarchyPointNode<SyntaxNode>>;
  visible: Set<string>;
  coordinates: TreeCoordinateReservation;
  constructionForest?: boolean;
};
type StageReservation = { categoryMetrics: string; treeInkMetrics: string; treeLabelMetrics: string; size: [number, number]; direction: TreeDirection; preceding?: TreeCoordinateReservation; frames: ReadonlyMap<SyntaxNode, TreeCoordinateReservation> };
const cache = new WeakMap<readonly PlaybackStep[], Map<string, StageReservation>>();
const orderedPlans = new WeakMap<ReadonlyMap<SyntaxNode, TreeCoordinateReservation>, boolean>();

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

function hasValidBranches(scene: Scene, orderedContours = false) {
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
  if (!orderedContours) return true;
  const syntax = (node: d3.HierarchyPointNode<SyntaxNode>) => scene.visible.has(getNodeId(node))
    && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace';
  return siblingContoursOrdered([...scene.nodes.values()].filter(node => syntax(node) && (!node.parent || !syntax(node.parent))),
    node => (node.children ?? []).filter(syntax), node => scene.coordinates.get(getNodeId(node))!);
}

/** When a relation opens a stage, a workspace awaiting attachment keeps its
 * completed shape. The later merge centers its new surrounding parents without
 * relaying out the untouched component first. */
function retainWorkspaceComponents(scenes: Scene[], preceding: Scene, originOffsetX: number, orderedContours: boolean): Scene[] {
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
      [id, { x: point.x + originOffsetX, y: point.y * scale + offset }]));
    unchanged.forEach(root => root.each(node => {
      const id = getNodeId(node);
      const prior = preceding.coordinates.get(id)!;
      coordinates.set(id, { x: prior.x + originOffsetX, y: prior.y });
    }));
    return centerParents({ ...scene, coordinates });
  });
  return result.every(scene => hasValidBranches(scene, orderedContours)) ? result : scenes;
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
  direction: TreeDirection = 'ltr', measureCategoryText?: CategoryTextMeasure, measureTreeInk?: TreeInkTextMeasure,
  treeLabelRuns?: PreparedTreeLabelRuns, measureTreeLabel?: TreeLabelMeasure, orderedContours = false): ReadonlyMap<SyntaxNode, TreeCoordinateReservation> {
  let stages = cache.get(steps);
  if (!stages) cache.set(steps, stages = new Map());
  const frames = steps.filter(step => step.replayFrameIndex === stageIndex && step.replayCanvasData)
    .sort((a, b) => (a.replayStageStepIndex ?? (a.replayKind === 'macro' ? Infinity : 0))
      - (b.replayStageStepIndex ?? (b.replayKind === 'macro' ? Infinity : 0)));
  const previous = frames[0]?.replayKind === 'relation' && sizeForStage && steps.find(step => step.replayFrameIndex === stageIndex - 1 && step.replayKind === 'macro');
  const previousSize = previous && sizeForStage!(stageIndex - 1);
  const precedingCoordinates = previous?.replayCanvasData && previousSize
    ? buildStageLocalCoordinates(steps, stageIndex - 1, previousSize, sizeForStage, direction, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel, orderedContours).get(previous.replayCanvasData) : undefined;
  const categoryMetrics = categoryMetricKey(steps, measureCategoryText);
  const treeInkMetrics = treeInkMetricKey(steps, measureCategoryText, measureTreeInk);
  const treeLabelMetrics = treeLabelMetricKey(steps, treeLabelRuns, measureTreeLabel);
  const cacheKey = `${stageIndex}:${orderedContours}`, cached = stages.get(cacheKey);
  if (cached && cached.size[0] === size[0] && cached.size[1] === size[1]
    && cached.direction === direction && cached.categoryMetrics === categoryMetrics && cached.treeInkMetrics === treeInkMetrics && cached.treeLabelMetrics === treeLabelMetrics && cached.preceding === precedingCoordinates) return cached.frames;
  const { rowHeight, temporaryRootDepth } = stageVerticalGeometry(frames);
  const scenes: Scene[] = frames.map(step => {
    const canvas = step.replayCanvasData!, root = d3.hierarchy(canvas);
    applyVizIds(root);
    const tree = layoutSyntaxTree(root, size);
    // A temporary construction forest contributes no extra syntax level.
    tree.each(node => { node.y = (node.depth - temporaryRootDepth(canvas)) * rowHeight; });
    const nodes = new Map<string, d3.HierarchyPointNode<SyntaxNode>>(tree.descendants().map(node => [getNodeId(node), node]));
    return { canvas, nodes, visible: new Set(step.replayVisibleNodeIds ?? nodes.keys()),
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
  const resolved = preserved.every(scene => hasValidBranches(scene, orderedContours)) ? preserved : reserve(new Map());
  const contours = reserveContours(resolved);
  for (const scene of contours.slice(1)) retainCurrentUnaryRank(scene, contours[0]);
  let finalScenes = separateWorkspaceContours(contours, measureCategoryText);
  if (frames[0]?.replayKind === 'relation' && previous?.replayCanvasData && precedingCoordinates) {
    const root = d3.hierarchy(previous.replayCanvasData); applyVizIds(root);
    const nodes = new Map<string, d3.HierarchyPointNode<SyntaxNode>>(
      layoutSyntaxTree(root, previousSize!, 'ltr', precedingCoordinates).descendants().map(node => [getNodeId(node), node]));
    // RTL painting reflects x around the current canvas width. Carry the origin
    // with the retained workspace, translating the whole scene to preserve its
    // existing clearances instead of pushing that component into its neighbours.
    const originOffsetX = direction === 'rtl' ? size[0] - previousSize![0] : 0;
    finalScenes = retainWorkspaceComponents(finalScenes, { canvas: previous.replayCanvasData, nodes,
      coordinates: precedingCoordinates, visible: new Set(previous.replayVisibleNodeIds ?? nodes.keys()) }, originOffsetX, orderedContours);
  }
  const reservations = new Map(finalScenes.map(scene => [scene.canvas, scene.coordinates]));
  stages.set(cacheKey, { size: [...size], direction, categoryMetrics, treeInkMetrics, treeLabelMetrics, preceding: precedingCoordinates, frames: reservations });
  return reservations;
}

/** Every current tree keeps sister subtrees in reading order on each row they
 * share, as painted. Direct daughters can stay ordered while a deeper node of
 * one sister passes under the other. */
function framesKeepContours(frames: ReadonlyArray<readonly [PlaybackStep, TreeCoordinateReservation, [number, number]]>,
  direction: TreeDirection): boolean {
  return frames.every(([step, coordinates, size]) => {
    const root = d3.hierarchy(step.replayCanvasData!); applyVizIds(root);
    const visible = new Set<string>(step.replayVisibleNodeIds ?? root.descendants().map(node => getNodeId(node)));
    const syntax = (node: d3.HierarchyNode<SyntaxNode>) => visible.has(getNodeId(node))
      && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace';
    const nodes = layoutSyntaxTree(root, size, direction, coordinates, visible).descendants().filter(syntax);
    return siblingContoursOrdered<d3.HierarchyPointNode<SyntaxNode>>(nodes.filter(node => !node.parent || !syntax(node.parent)),
      node => (node.children ?? []).filter(syntax), node => node, direction);
  });
}

/** All consumers share the same placement plan. Stage-local geometry is built
 * first; a retained workspace can then reserve its attachment position throughout
 * its compatible construction lifetime without importing future branch ranks.
 * The established plan stands when it keeps every sister contour ordered. If a
 * retained placement interleaves sisters, each retention is planned again under
 * that requirement, and the new plan is used only if it is ordered throughout. */
export function buildStageCoordinateReservations(steps: readonly PlaybackStep[], stageIndex: number, size: [number, number],
  sizeForStage?: (stageIndex: number) => [number, number] | null,
  direction: TreeDirection = 'ltr', measureCategoryText?: CategoryTextMeasure, measureTreeInk?: TreeInkTextMeasure,
  treeLabelRuns?: PreparedTreeLabelRuns, measureTreeLabel?: TreeLabelMeasure): ReadonlyMap<SyntaxNode, TreeCoordinateReservation> {
  const sizes = new Map<number, [number, number]>();
  if (sizeForStage) for (const step of steps) {
    if (step.replayFrameIndex === undefined || sizes.has(step.replayFrameIndex)) continue;
    const stageSize = sizeForStage(step.replayFrameIndex);
    if (stageSize) sizes.set(step.replayFrameIndex, stageSize);
  }
  const plan = (orderedContours: boolean) => {
    const local = (stage: number, stageSize: [number, number]) => buildStageLocalCoordinates(steps, stage, stageSize, sizeForStage,
      direction, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel, orderedContours);
    const original = local(stageIndex, size);
    if (!sizeForStage) return { frames: original, plan: original, painted: () => steps.flatMap(step => step.replayFrameIndex === stageIndex
      && original.has(step.replayCanvasData!) ? [[step, original.get(step.replayCanvasData!)!, size] as const] : []) };
    const planned = reserveWorkspaceAttachments({ steps, sizes, direction, minimumSiblingGap: TREE_SIBLING_GAP, coordinatesForStage: local,
      measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel, orderedContours });
    const compact = compactCurrentRootForks(steps, sizes, planned, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel);
    const continuous = retainMovementSourceSlots(steps, sizes, compact, direction, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel);
    return { frames: new Map([...original].map(([canvas, coordinates]) => [canvas, continuous.get(canvas) ?? coordinates])), plan: continuous,
      painted: () => steps.flatMap(step => {
        const stageSize = sizes.get(step.replayFrameIndex!), canvas = step.replayCanvasData;
        const coordinates = canvas && stageSize && (continuous.get(canvas) ?? local(step.replayFrameIndex!, stageSize).get(canvas));
        return coordinates ? [[step, coordinates, stageSize] as const] : [];
      }) };
  };
  const ordered = ({ plan, painted }: ReturnType<typeof plan>) => {
    let result = orderedPlans.get(plan);
    if (result === undefined) orderedPlans.set(plan, result = framesKeepContours(painted(), direction));
    return result;
  };
  const established = plan(false);
  if (ordered(established)) return established.frames;
  const repaired = plan(true);
  return ordered(repaired) ? repaired.frames : established.frames;
}
