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
  layoutGroups?: readonly (readonly number[])[];
};

/** Share dimensions only across unchanged authored syntax with compatible ordinary layouts. */
export function buildStageLayoutGroups(steps: PlaybackStep[], stages: { workspaceForest: SyntaxNode[] }[]) {
  const structure = (forest: SyntaxNode[]) => {
    const ids = new Set<string>();
    let valid = forest.length > 0;
    const visit = (node: SyntaxNode): unknown => {
      if (!node.id || ids.has(node.id)) valid = false;
      ids.add(node.id ?? '');
      return [node.id, node.label, (node.children ?? []).map(visit)];
    };
    const key = JSON.stringify(forest.map(visit));
    return valid ? { key, ids: [...ids] } : null;
  };
  const positions = (canvas: SyntaxNode, ids: string[]) => {
    const root = d3.hierarchy(canvas);
    applyVizIds(root);
    const tree = d3.tree<SyntaxNode>().size([1, 1])
      .separation((a, b) => a.parent === b.parent ? 2.5 : 3.5)(root);
    const byId = new Map<string | undefined, d3.HierarchyPointNode<SyntaxNode>>(
      tree.descendants().map(node => [node.data.id, node]));
    return ids.map(id => byId.get(id));
  };
  const groups: number[][] = [];
  const structures = stages.map(stage => structure(stage.workspaceForest));
  stages.forEach((_stage, stageIndex) => {
    const current = structures[stageIndex];
    const previous = structures[stageIndex - 1];
    const preceding = steps.find(step => step.replayFrameIndex === stageIndex - 1 && step.replayKind === 'macro');
    const currentSteps = steps.filter(step => step.replayFrameIndex === stageIndex && step.replayCanvasData);
    let compatible = false;
    if (current && previous?.key === current.key && preceding?.replayCanvasData && currentSteps.length) {
      const reference = positions(preceding.replayCanvasData, current.ids);
      compatible = currentSteps.every(step => positions(step.replayCanvasData!, current.ids).every((node, index) => {
        const prior = reference[index];
        return node && prior && Math.abs(node.x - prior.x) < 1e-10 && Math.abs(node.y - prior.y) < 1e-10;
      }));
    }
    if (compatible) groups[groups.length - 1].push(stageIndex);
    else groups.push([stageIndex]);
  });
  return groups;
}

function stageLayouts({ steps, stageIndex, completedCanvas, plan, width, height, layoutGroups,
  abstractionMode = false, protectedNodeIds = new Set<string>() }: StageLayoutInput) {
  const stageSize = stageTreeLayoutSize(steps, stageIndex, width, height, layoutGroups);
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

/** Compatible continuations retain the original stage's dimensions; new content still expands fit bounds. */
export function stageTreeLayoutSize(steps: PlaybackStep[], stageIndex: number, width: number, height: number,
  layoutGroups?: StageLayoutInput['layoutGroups']) {
  const layoutStageIndex = layoutGroups?.find(group => group.includes(stageIndex))?.[0] ?? stageIndex;
  let nodeCount = 0;
  let depth = 0;
  for (const step of steps) {
    if (step.replayFrameIndex !== layoutStageIndex || !step.replayCanvasData) continue;
    const root = d3.hierarchy(step.replayCanvasData);
    nodeCount = Math.max(nodeCount, root.descendants().length);
    depth = Math.max(depth, root.height);
  }
  return nodeCount ? treeLayoutSize(nodeCount, depth, width, height) : null;
}

type StageCameraInput = StageLayoutInput & {
  includeOverlays?: boolean; includePlaques?: boolean; plaqueLayout?: Map<number, PlaquePlacement>
};

/** Reserve upcoming content before reveal, using one fit for a compatible layout group. */
export function buildStageCameraBounds(input: StageCameraInput): OverlayBounds | null {
  const stageIndices = input.layoutGroups?.find(group => group.includes(input.stageIndex)) ?? [input.stageIndex];
  const bounds = stageIndices.map(stageIndex => measureStageCameraBounds({
    ...input, stageIndex,
    plaqueLayout: stageIndex === input.stageIndex ? input.plaqueLayout : undefined
  })).filter((bounds): bounds is OverlayBounds => bounds !== null);
  return bounds.length ? {
    minX: Math.min(...bounds.map(bounds => bounds.minX)), minY: Math.min(...bounds.map(bounds => bounds.minY)),
    maxX: Math.max(...bounds.map(bounds => bounds.maxX)), maxY: Math.max(...bounds.map(bounds => bounds.maxY))
  } : null;
}

function measureStageCameraBounds({ steps, stageIndex, completedCanvas, plan, width, height, layoutGroups,
  abstractionMode = false, protectedNodeIds = new Set<string>(), includeOverlays = true,
  includePlaques = includeOverlays, plaqueLayout }: StageCameraInput): OverlayBounds | null {
  let bounds: OverlayBounds | null = null;
  const include = (next: OverlayBounds | null) => {
    if (!next) return;
    bounds = bounds ? {
      minX: Math.min(bounds.minX, next.minX), minY: Math.min(bounds.minY, next.minY),
      maxX: Math.max(bounds.maxX, next.maxX), maxY: Math.max(bounds.maxY, next.maxY)
    } : { ...next };
  };
  const input = { steps, stageIndex, completedCanvas, plan, width, height, abstractionMode, protectedNodeIds, layoutGroups };
  const placements = includePlaques ? plaqueLayout ?? buildStagePlaqueLayout(input) : new Map();
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
