import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { PlaybackStep } from './replayCompiler.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { layoutSyntaxTree, type TreeCoordinateReservation, type TreeDirection } from './treeLayout.ts';
import { caseSurfaceInitial } from '../server/babelParser/surfaceTokens.js';
import { separateWorkspaceContours } from './workspaceContourClearance.ts';
import { reserveWorkspaceAttachments } from './workspacePlacement.ts';
import { retainCurrentRootFork } from './currentRootFork.ts';
import { retainCurrentSiblingRanks } from './currentSiblingRanks.ts';

type Scene = {
  canvas: SyntaxNode;
  nodes: Map<string, d3.HierarchyPointNode<SyntaxNode>>;
  visible: Set<string>;
  coordinates: TreeCoordinateReservation;
  constructionForest?: boolean;
};
type StageReservation = { size: [number, number]; direction: TreeDirection; preceding?: TreeCoordinateReservation; frames: ReadonlyMap<SyntaxNode, TreeCoordinateReservation> };
const cache = new WeakMap<readonly PlaybackStep[], Map<number, StageReservation>>();

const syntaxParent = (node: d3.HierarchyPointNode<SyntaxNode>) => node.ancestors().slice(1).find(ancestor =>
  !ancestor.data.replayLayoutOnly && ancestor.data.replayOrigin?.kind !== 'workspace');

/** Sentence casing changes a generated word label, not its unchanged syntax
 * owner. Compare that display child against its owner's spelling while keeping
 * every authored field and every other display property in the signature. */
function retainedSubtreeMaterial(node: SyntaxNode): string {
  const material = (current: SyntaxNode, parent?: SyntaxNode): SyntaxNode => {
    const displayWord = parent?.word && current.replayOrigin?.kind === 'word'
      && current.replayOrigin.ownerId === parent.id && !current.children?.length
      && current.word === current.label
      && caseSurfaceInitial(current.word, 'lower') === caseSurfaceInitial(parent.word, 'lower');
    const next = displayWord ? { ...current, word: parent.word, label: parent.word } : current;
    return current.children ? { ...next, children: current.children.map(child => material(child, current)) } : next;
  };
  return JSON.stringify(material(node));
}

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
function retainWorkspaceComponents(scenes: Scene[], preceding: Scene, originOffsetX: number): Scene[] {
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
  const extent = (states: Scene[]) => {
    const xs = states.flatMap(scene => [...scene.coordinates.values()].map(point => point.x));
    return [Math.min(...xs), Math.max(...xs)];
  };
  const [oldMin, oldMax] = extent(scenes), [newMin, newMax] = extent(result);
  const scale = (oldMax - oldMin) / (newMax - newMin || 1);
  // Keep the existing stage width, as with D3's sized tree layout. This is one
  // transform for every scene, so fitting cannot shrink at a later reveal.
  if (scale < 1) for (const scene of result) scene.coordinates.forEach((point, id) =>
    scene.coordinates.set(id, { x: oldMin + (point.x - newMin) * scale, y: point.y }));
  return result;
}

/** Reserve one stage's geometry separately from its current visible syntax.
 * Completed geometry reserves room for new parents before they appear. Unchanged
 * subtrees keep their entry positions when that leaves every current branch valid.
 * Actual reparenting retains the earlier subtree at its earlier attachment until
 * the owning moment. The same maps serve camera bounds, allocation and painting. */
function buildStageLocalCoordinates(steps: readonly PlaybackStep[], stageIndex: number, size: [number, number],
  sizeForStage?: (stageIndex: number) => [number, number] | null,
  direction: TreeDirection = 'ltr'): ReadonlyMap<SyntaxNode, TreeCoordinateReservation> {
  let stages = cache.get(steps);
  if (!stages) cache.set(steps, stages = new Map());
  const frames = steps.filter(step => step.replayFrameIndex === stageIndex && step.replayCanvasData)
    .sort((a, b) => (a.replayStageStepIndex ?? (a.replayKind === 'macro' ? Infinity : 0))
      - (b.replayStageStepIndex ?? (b.replayKind === 'macro' ? Infinity : 0)));
  const previous = frames[0]?.replayKind === 'relation' && sizeForStage && steps.find(step => step.replayFrameIndex === stageIndex - 1 && step.replayKind === 'macro');
  const previousSize = previous && sizeForStage!(stageIndex - 1);
  const precedingCoordinates = previous?.replayCanvasData && previousSize
    ? buildStageLocalCoordinates(steps, stageIndex - 1, previousSize, sizeForStage, direction).get(previous.replayCanvasData) : undefined;
  const cached = stages.get(stageIndex);
  if (cached && cached.size[0] === size[0] && cached.size[1] === size[1]
    && cached.direction === direction && cached.preceding === precedingCoordinates) return cached.frames;
  const completedCanvas = frames.find(step => step.replayKind === 'macro')?.replayCanvasData;
  const completesSingleTree = Boolean(completedCanvas && completedCanvas.replayOrigin?.kind !== 'workspace');
  const temporaryRootDepth = (canvas: SyntaxNode) => Number(completesSingleTree && canvas.replayOrigin?.kind === 'workspace');
  const stageDepth = Math.max(1, ...frames.map(step =>
    d3.hierarchy(step.replayCanvasData!).height - temporaryRootDepth(step.replayCanvasData!)));
  const scenes: Scene[] = frames.map(step => {
    const canvas = step.replayCanvasData!, root = d3.hierarchy(canvas);
    applyVizIds(root);
    const tree = layoutSyntaxTree(root, size);
    // D3 sizes each canvas by its own depth. Reservations combine canvases, so
    // they need one vertical unit before any unchanged subtree is retained.
    // A temporary construction forest contributes no extra syntax level.
    tree.each(node => { node.y = (node.depth - temporaryRootDepth(canvas)) * (size[1] / stageDepth); });
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
  const resolved = preserved.every(hasValidBranches) ? preserved : reserve(new Map());
  let finalScenes = separateWorkspaceContours(reserveContours(resolved));
  if (frames[0]?.replayKind === 'relation' && previous?.replayCanvasData && precedingCoordinates) {
    const root = d3.hierarchy(previous.replayCanvasData); applyVizIds(root);
    const nodes = new Map<string, d3.HierarchyPointNode<SyntaxNode>>(
      layoutSyntaxTree(root, previousSize!).descendants().map(node => [getNodeId(node), node]));
    // RTL painting reflects x around the current canvas width. Carry the origin
    // with the retained workspace, translating the whole scene to preserve its
    // existing clearances instead of pushing that component into its neighbours.
    const originOffsetX = direction === 'rtl' ? size[0] - previousSize![0] : 0;
    finalScenes = retainWorkspaceComponents(finalScenes, { canvas: previous.replayCanvasData, nodes,
      coordinates: precedingCoordinates, visible: new Set(previous.replayVisibleNodeIds ?? nodes.keys()) }, originOffsetX);
  }
  const reservations = new Map(finalScenes.map(scene => [scene.canvas, scene.coordinates]));
  stages.set(stageIndex, { size: [...size], direction, preceding: precedingCoordinates, frames: reservations });
  return reservations;
}

/** All consumers share the same placement plan. Stage-local geometry is built
 * first; a retained workspace can then reserve its attachment position throughout
 * its compatible construction lifetime without importing future branch ranks. */
export function buildStageCoordinateReservations(steps: readonly PlaybackStep[], stageIndex: number, size: [number, number],
  sizeForStage?: (stageIndex: number) => [number, number] | null,
  direction: TreeDirection = 'ltr'): ReadonlyMap<SyntaxNode, TreeCoordinateReservation> {
  const original = buildStageLocalCoordinates(steps, stageIndex, size, sizeForStage, direction);
  if (!sizeForStage) return original;
  const sizes = new Map<number, [number, number]>();
  for (const step of steps) {
    if (step.replayFrameIndex === undefined || sizes.has(step.replayFrameIndex)) continue;
    const stageSize = sizeForStage(step.replayFrameIndex);
    if (stageSize) sizes.set(step.replayFrameIndex, stageSize);
  }
  const planned = reserveWorkspaceAttachments(steps, sizes, direction, (stage, stageSize) =>
    buildStageLocalCoordinates(steps, stage, stageSize, sizeForStage, direction));
  return new Map([...original].map(([canvas, coordinates]) => [canvas, planned.get(canvas) ?? coordinates]));
}
