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

export function treeLayoutSize(nodeCount: number, depth: number, width: number, height: number) {
  return [Math.max(width * 1.5, nodeCount * 180) - 600,
    Math.max(height, (depth + 2) * 220) - 520] as [number, number];
}

/** Fit every layout used by a stage, independent of which step is visited first. */
export function buildStageCameraBounds({ steps, stageIndex, completedCanvas, plan, width, height,
  abstractionMode = false, protectedNodeIds = new Set<string>(), includeOverlays = true }: {
  steps: PlaybackStep[];
  stageIndex: number;
  completedCanvas: SyntaxNode;
  plan: RelationRenderPlan | null;
  width: number;
  height: number;
  abstractionMode?: boolean;
  protectedNodeIds?: Set<string>;
  includeOverlays?: boolean;
}): OverlayBounds | null {
  let bounds: OverlayBounds | null = null;
  const include = (next: OverlayBounds | null) => {
    if (!next) return;
    bounds = bounds ? {
      minX: Math.min(bounds.minX, next.minX), minY: Math.min(bounds.minY, next.minY),
      maxX: Math.max(bounds.maxX, next.maxX), maxY: Math.max(bounds.maxY, next.maxY)
    } : { ...next };
  };
  const hierarchy = (canvas: SyntaxNode) => {
    const root = d3.hierarchy(cloneSyntaxTree(canvas)!);
    applyVizIds(root);
    if (abstractionMode) markTriangulatedNodes(root, protectedNodeIds);
    return root;
  };
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.replayFrameIndex !== stageIndex || !step.replayCanvasData) continue;
    const key = JSON.stringify([step.replayCanvasData, Boolean(step.replayUsesFutureLayoutScaffold)]);
    if (seen.has(key)) continue;
    seen.add(key);
    const root = hierarchy(step.replayCanvasData);
    const layout = d3.tree<SyntaxNode>()
      .size(treeLayoutSize(root.descendants().length, root.height, width, height))
      .separation((a, b) => a.parent === b.parent ? 2.5 : 3.5);
    const currentTree = layout(root);
    const fitTree = step.replayUsesFutureLayoutScaffold ? currentTree : layout(hierarchy(completedCanvas));
    const visibleNodes = (tree: typeof currentTree) => tree.descendants().filter(node =>
      !isUnderTriangulation(node) && !isSyntheticWorkspaceRootNode(node));
    const fitNodes = visibleNodes(fitTree);
    for (const node of [...visibleNodes(currentTree), ...fitNodes]) {
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
    include(boundOverlayBounds(bindRelationPlanFrame(plan, stageIndex, positionFor, {
      labelWidth: 150, labelHeight: 70, badgeGap: 46, laneGap: 60, markerScale: 1,
      trajectoryCeilingY: (d3.min(fitNodes, node => node.y) ?? 0) - 160,
      trajectoryFloorY: maxY + 180, connectorBaselineY: maxY + 130, railBaseY: maxY + 240,
      hasExistingGapNotation: (id, text) => {
        const node = byId.get(id);
        return Boolean(node && (resolveLeafSurface(node) || node.data.label) === text);
      }
    }), { markerScale: 1 }));
  }
  return bounds;
}
