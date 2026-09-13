import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import {
  applyVizIds, cloneSyntaxTree, indexHierarchyNodesByIdAndAliases,
  isDisplayTerminalSurface, isSyntheticWorkspaceRootNode, isUnderTriangulation,
  markTriangulatedNodes, resolveLeafSurface, type PlaybackStep
} from './replayCompiler.ts';
import { bindRelationPlanFrame, boundOverlayBounds, resolveUniqueDisplayTerminal,
  type OverlayBounds, type PlanPositionProvider } from './relations/geometryBinding.ts';
import type { RelationRenderPlan } from './relations/renderPlanCompiler.ts';
import { placeStagePlaques, plaqueIdentity, plaqueTreeObstacles, projectPlaqueLayout, type PlaquePlacement } from './relations/plaquePlacement.ts';

type StageLayoutInput = {
  steps: PlaybackStep[]; stageIndex: number; completedCanvas: SyntaxNode;
  plan: RelationRenderPlan | null; width: number; height: number;
  abstractionMode?: boolean; protectedNodeIds?: Set<string>;
};

function stageLayouts({ steps, stageIndex, completedCanvas, plan, width, height,
  abstractionMode = false, protectedNodeIds = new Set<string>() }: StageLayoutInput) {
  const stageSize = stageTreeLayoutSize(steps, stageIndex, width, height);
  const hierarchy = (canvas: SyntaxNode) => {
    const root = d3.hierarchy(cloneSyntaxTree(canvas)!);
    applyVizIds(root);
    if (abstractionMode) markTriangulatedNodes(root, protectedNodeIds);
    return root;
  };
  const scenes: Array<{ currentTree: d3.HierarchyPointNode<SyntaxNode>;
    isRecord: boolean; visibleIds: Set<string> | null }> = [];
  const seen = new Map<string, (typeof scenes)[number]>();
  for (const step of steps) {
    if (step.replayFrameIndex !== stageIndex || !step.replayCanvasData) continue;
    const key = JSON.stringify([step.replayCanvasData, Boolean(step.replayUsesFutureLayoutScaffold)]);
    const existing = seen.get(key);
    if (existing) {
      existing.isRecord ||= step.replayKind === 'macro';
      step.replayVisibleNodeIds?.forEach(id => existing.visibleIds?.add(id));
      continue;
    }
    const root = hierarchy(step.replayCanvasData);
    const layout = d3.tree<SyntaxNode>()
      .size(stageSize ?? treeLayoutSize(root.descendants().length, root.height, width, height))
      .separation((a, b) => a.parent === b.parent ? 2.5 : 3.5);
    const currentTree = layout(root);
    const scene = { currentTree,
      isRecord: step.replayKind === 'macro', visibleIds: step.replayVisibleNodeIds ? new Set(step.replayVisibleNodeIds) : null };
    scenes.push(scene);
    seen.set(key, scene);
  }
  const root = hierarchy(completedCanvas);
  const completedTree = d3.tree<SyntaxNode>()
    .size(stageSize ?? treeLayoutSize(root.descendants().length, root.height, width, height))
    .separation((a, b) => a.parent === b.parent ? 2.5 : 3.5)(root);
  return { scenes, completedTree };
}

/** Reserve every plaque before any relation is revealed, using every tree layout in this stage. */
export function buildStagePlaqueLayout(input: StageLayoutInput): Map<number, PlaquePlacement> {
  let previous = new Map<string, PlaquePlacement>();
  let layout = new Map<number, PlaquePlacement>();
  for (let stageIndex = 0; stageIndex <= input.stageIndex; stageIndex++) {
    if (stageIndex !== input.stageIndex && !input.steps.some(step => step.replayFrameIndex === stageIndex)) continue;
    layout = allocateStagePlaques({ ...input, stageIndex }, previous);
    const items = input.plan?.frames[stageIndex]?.items ?? [];
    previous = new Map([...layout].map(([index, placement]) => [plaqueIdentity(items[index]), placement]));
  }
  return layout;
}

function allocateStagePlaques(input: StageLayoutInput, previous: Map<string, PlaquePlacement>) {
  const { scenes, completedTree } = stageLayouts(input);
  const visibleNodes = (tree: typeof completedTree, ids: Set<string> | null = null) => tree.descendants().filter(node =>
    !isUnderTriangulation(node) && !isSyntheticWorkspaceRootNode(node)
    && (!ids || ids.has(String((node as any).__vizId ?? node.data.id ?? ''))));
  // The completed authored tree is smaller than Replay's reserved future layout.
  // Only use it when no Replay exists, never as the coordinate system for Replay plaques.
  const reference = scenes.find(scene => scene.isRecord) ?? [...scenes].sort((a, b) =>
    b.currentTree.descendants().length - a.currentTree.descendants().length
    || JSON.stringify(a.currentTree.data).localeCompare(JSON.stringify(b.currentTree.data)))[0];
  const nodes = reference ? visibleNodes(reference.currentTree, reference.visibleIds) : visibleNodes(completedTree);
  const obstacles = scenes.length ? scenes.flatMap(scene => plaqueTreeObstacles(visibleNodes(scene.currentTree, scene.visibleIds)))
    : plaqueTreeObstacles(nodes);
  return placeStagePlaques(input.plan?.frames[input.stageIndex]?.items ?? [], nodes, obstacles, previous);
}

export function treeLayoutSize(nodeCount: number, depth: number, width: number, height: number) {
  return [Math.max(width * 1.5, nodeCount * 180) - 600,
    Math.max(height, (depth + 2) * 220) - 520] as [number, number];
}

/** Reserve the same dimensions for every Replay layout in one authored stage. */
export function stageTreeLayoutSize(steps: PlaybackStep[], stageIndex: number, width: number, height: number) {
  let nodeCount = 0;
  let depth = 0;
  for (const step of steps) {
    if (step.replayFrameIndex !== stageIndex || !step.replayCanvasData) continue;
    const root = d3.hierarchy(step.replayCanvasData);
    nodeCount = Math.max(nodeCount, root.descendants().length);
    depth = Math.max(depth, root.height);
  }
  return nodeCount ? treeLayoutSize(nodeCount, depth, width, height) : null;
}

/** Fit every layout used by a stage, independent of which step is visited first. */
export function buildStageCameraBounds({ steps, stageIndex, completedCanvas, plan, width, height,
  abstractionMode = false, protectedNodeIds = new Set<string>(), includeOverlays = true,
  plaqueLayout }: {
  steps: PlaybackStep[];
  stageIndex: number;
  completedCanvas: SyntaxNode;
  plan: RelationRenderPlan | null;
  width: number;
  height: number;
  abstractionMode?: boolean;
  protectedNodeIds?: Set<string>;
  includeOverlays?: boolean;
  plaqueLayout?: Map<number, PlaquePlacement>;
}): OverlayBounds | null {
  let bounds: OverlayBounds | null = null;
  const include = (next: OverlayBounds | null) => {
    if (!next) return;
    bounds = bounds ? {
      minX: Math.min(bounds.minX, next.minX), minY: Math.min(bounds.minY, next.minY),
      maxX: Math.max(bounds.maxX, next.maxX), maxY: Math.max(bounds.maxY, next.maxY)
    } : { ...next };
  };
  const input = { steps, stageIndex, completedCanvas, plan, width, height, abstractionMode, protectedNodeIds };
  const placements = includeOverlays ? plaqueLayout ?? buildStagePlaqueLayout(input) : new Map();
  for (const { currentTree, visibleIds } of stageLayouts(input).scenes) {
    const positions = indexHierarchyNodesByIdAndAliases(currentTree.descendants());
    projectPlaqueLayout(placements, id => positions.get(id) ?? null).forEach(rect => include({
      minX: rect.x - 24, maxX: rect.x + rect.width + 24, minY: rect.y - 24, maxY: rect.y + rect.height + 24
    }));
    // Future syntax reserves layout coordinates, not camera space. Union the
    // actually revealed syntax across the stage to keep its microsteps stable.
    const fitNodes = currentTree.descendants().filter(node =>
      !isUnderTriangulation(node) && !isSyntheticWorkspaceRootNode(node)
      && (!visibleIds || visibleIds.has(String((node as any).__vizId ?? node.data.id ?? ''))));
    for (const node of fitNodes) {
      include({ minX: node.x, maxX: node.x, minY: node.y,
        maxY: node.y + (node.children?.length ? 0 : 130) });
    }
    if (!includeOverlays || !plan) continue;
    const byId = indexHierarchyNodesByIdAndAliases(fitNodes);
    const positionFor: PlanPositionProvider = (id, attachment = 'position') => {
      const node = byId.get(id);
      if (!node) return null;
      if (attachment === 'parent') return node.parent ? { x: node.parent.x, y: node.parent.y } : null;
      if (attachment === 'terminal') {
        const { terminal } = resolveUniqueDisplayTerminal(node, n => n.children || [],
          n => !n.children?.length && isDisplayTerminalSurface(resolveLeafSurface(n)));
        return terminal ? { x: terminal.x, y: terminal.y + 140 } : null;
      }
      return { x: node.x, y: node.y + (attachment === 'shell-bottom' ? 6 : attachment === 'shell-top' ? -8 : 0) };
    };
    const maxY = d3.max(fitNodes, node => node.y) ?? 0;
    // Bounds reserve all stage marks at nominal scale, never reading the live DOM or camera.
    const bound = bindRelationPlanFrame(plan, stageIndex, positionFor, {
      labelWidth: 150, labelHeight: 70, badgeGap: 46, laneGap: 60, markerScale: 1,
      trajectoryCeilingY: (d3.min(fitNodes, node => node.y) ?? 0) - 160,
      trajectoryFloorY: maxY + 180, connectorBaselineY: maxY + 130, railBaseY: maxY + 240,
      hasExistingGapNotation: (id, text) => {
        const node = byId.get(id);
        return Boolean(node && (resolveLeafSurface(node) || node.data.label) === text);
      }
    });
    // The shared stage allocation above owns plaque extents, not their legacy anchor-relative estimates.
    include(boundOverlayBounds({ ...bound, primitives: bound.primitives.filter(primitive => primitive.type !== 'plaque') }, { markerScale: 1 }));
  }
  return bounds;
}
