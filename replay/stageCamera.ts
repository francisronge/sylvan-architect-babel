import { layoutSyntaxTree, type TreeDirection } from './treeLayout.ts';
import { categoryTextLayout, type CategoryTextMeasure } from './categoryTextLayout.ts';
import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import {
  applyVizIds, cloneSyntaxTree, indexHierarchyNodesByIdAndAliases,
  isDisplayTerminalSurface, isSyntheticWorkspaceRootNode, isUnderTriangulation,
  markTriangulatedNodes, resolveLeafSurface, type PlaybackStep
} from './replayCompiler.ts';
import { bindRelationPlanFrame, boundOverlayBounds, resolveUniqueDisplayTerminal,
  type OverlayBounds, type PlanPositionProvider } from './relations/geometryBinding.ts';
import { resolveDisplayedTrajectoryAttachments, type RelationRenderPlan } from './relations/renderPlanCompiler.ts';
import { sampleCubic, sampleQuadratic } from './relations/markGeometry.ts';
import { placeStagePlaques, prepareStagePlaqueRequests, nativeRelationPlaqueRects, plaqueIdentity, plaqueTreeObstacles, plaqueConnectorObstacles, plaqueCaseConnectorObstacles, plaqueCollectionConnectorObstacles, prepareCasePlaqueSpace, prepareCollectionPlaqueSpace, projectPlaqueLayout, uniquePlaqueObstacles, type PlaquePlacement } from './relations/plaquePlacement.ts';
import type { PlaqueTextMeasure } from './relations/plaqueTextLayout.ts';
import { translateObstacle } from './relations/plaqueObstacleIndex.ts';

export type StageLayoutInput = {
  steps: PlaybackStep[]; stageIndex: number; completedCanvas: SyntaxNode;
  plan: RelationRenderPlan | null; width: number; height: number;
  direction?: TreeDirection;
  abstractionMode?: boolean; protectedNodeIds?: Set<string>;
  layoutGroups?: readonly (readonly number[])[];
  measurePlaqueText?: PlaqueTextMeasure;
  measureCategoryText?: CategoryTextMeasure;
};

/** Shared geometric endpoint estimates for reservation and camera bounds. */
function stagePositionProvider(byId: Map<string, d3.HierarchyPointNode<SyntaxNode>>): PlanPositionProvider {
  return (id, attachment = 'position') => {
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
}

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
    const tree = layoutSyntaxTree(root, [1, 1]);
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

function stageLayouts({ steps, stageIndex, completedCanvas, plan, width, height, layoutGroups, direction = 'ltr',
  abstractionMode = false, protectedNodeIds = new Set<string>() }: StageLayoutInput) {
  const stageSize = stageTreeLayoutSize(steps, stageIndex, width, height, layoutGroups);
  const hierarchy = (canvas: SyntaxNode) => {
    const root = d3.hierarchy(cloneSyntaxTree(canvas)!);
    applyVizIds(root);
    if (abstractionMode) markTriangulatedNodes(root, protectedNodeIds);
    return root;
  };
  const scenes: Array<{ currentTree: d3.HierarchyPointNode<SyntaxNode>;
    isRecord: boolean; visibleIds: Set<string> | null; playedRelations: Set<number> }> = [];
  const seen = new Map<string, (typeof scenes)[number]>();
  for (const step of steps) {
    if (step.replayFrameIndex !== stageIndex || !step.replayCanvasData) continue;
    const playedRelations = new Set((step.replayRelationLinks ?? []).flatMap(link => {
      const [stage, relation] = String('authoredRelationKey' in link ? link.authoredRelationKey : '').split(':').map(Number);
      return stage === stageIndex && Number.isInteger(relation) ? [relation] : [];
    }));
    const key = JSON.stringify([step.replayCanvasData, Boolean(step.replayUsesFutureLayoutScaffold)]);
    const existing = seen.get(key);
    if (existing) {
      existing.isRecord ||= step.replayKind === 'macro';
      playedRelations.forEach(index => existing.playedRelations.add(index));
      step.replayVisibleNodeIds?.forEach(id => existing.visibleIds?.add(id));
      continue;
    }
    const root = hierarchy(step.replayCanvasData);
    const currentTree = layoutSyntaxTree(root,
      stageSize ?? treeLayoutSize(root.descendants().length, root.height, width, height), direction);
    const scene = { currentTree, playedRelations: new Set(playedRelations),
      isRecord: step.replayKind === 'macro', visibleIds: step.replayVisibleNodeIds ? new Set(step.replayVisibleNodeIds) : null };
    scenes.push(scene);
    seen.set(key, scene);
  }
  const root = hierarchy(completedCanvas);
  const completedTree = layoutSyntaxTree(root,
    stageSize ?? treeLayoutSize(root.descendants().length, root.height, width, height), direction);
  return { scenes, completedTree };
}

/** Choose a pocket against every remaining frame in the claim's lifetime. */
export function buildReplayPlaqueLayouts(input: StageLayoutInput): Map<number, PlaquePlacement>[] {
  const frames = input.plan?.frames ?? [];
  const spaces = frames.map((_, stageIndex) => measureStagePlaqueSpace({ ...input, stageIndex }));
  const sizes = new Map<string, { width: number; height: number }>();
  frames.forEach((frame, i) => prepareStagePlaqueRequests(frame.items, spaces[i].nodes, input.measurePlaqueText).forEach(request => {
    const key = plaqueIdentity(frame.items[request.index]), prior = sizes.get(key);
    sizes.set(key, { width: Math.max(prior?.width ?? 0, request.width), height: Math.max(prior?.height ?? 0, request.height) });
  }));
  const remembered = new Map<string, PlaquePlacement>();
  const allocate = (stageIndex: number, collectionsOnly = false) => {
    const frame = frames[stageIndex];
    const { nodes, obstacles } = spaces[stageIndex];
    const layout = placeStagePlaques(frame.items, nodes, obstacles, remembered, input.measurePlaqueText, { sizes, collectionsOnly,
      spaceFor: (index, anchor, allocated) => {
        const key = plaqueIdentity(frame.items[index]);
        const known = new Map(remembered);
        allocated.forEach((placement, itemIndex) => known.set(plaqueIdentity(frame.items[itemIndex]), placement));
        const futureScenes = spaces.slice(stageIndex).flatMap((space, offset) => {
          const items = frames[stageIndex + offset].items;
          if (!items.some(item => plaqueIdentity(item) === key)) return [];
          return space.scenes.flatMap(scene => {
            const byId = indexHierarchyNodesByIdAndAliases(scene.nodes);
            const futureAnchor = byId.get(String((anchor as any).__vizId ?? anchor.data.id));
            if (!futureAnchor) return [];
            const dx = anchor.x - futureAnchor.x, dy = anchor.y - futureAnchor.y;
            const otherPlacements = new Map(items.flatMap((item, index) => {
              const otherKey = plaqueIdentity(item), placement = known.get(otherKey);
              return otherKey !== key && placement ? [[index, placement] as const] : [];
            }));
            const projected = projectPlaqueLayout(otherPlacements, id => byId.get(id) ?? null);
            const plaques = [...projected.values()].map(box => ({ ...box, blocksConnectors: true }));
            const obstacles = [...scene.obstacles, ...plaques, ...plaqueCaseConnectorObstacles(items, scene.nodes, projected),
              ...plaqueCollectionConnectorObstacles(scene.nodes, projected)];
            const visibleRows = new WeakMap<string[], boolean>();
            const rowVisible = (owners: string[] | undefined): boolean => {
              if (!scene.playedRelations || !owners) return true;
              let visible = visibleRows.get(owners);
              if (visible === undefined) {
                visible = owners.some(key => {
                  const [stage, relation] = key.split(':').map(Number);
                  return stage < stageIndex + offset || (stage === stageIndex + offset && scene.playedRelations!.has(relation));
                });
                visibleRows.set(owners, visible);
              }
              return visible;
            };
            return [{ anchor: futureAnchor, caseClears: prepareCasePlaqueSpace(futureAnchor, obstacles), collectionSpace: prepareCollectionPlaqueSpace(scene.nodes, obstacles), rowVisible, dx, dy,
              obstacles }];
          });
        });
        return {
          obstacles: uniquePlaqueObstacles(futureScenes.flatMap(scene => scene.obstacles.map(box =>
            translateObstacle(box, scene.dx, scene.dy)))),
          connectorCandidateXs: box => futureScenes.flatMap(scene =>
            scene.collectionSpace.candidateXs({ ...box, x: box.x - scene.dx, y: box.y - scene.dy })
              .map(x => x + scene.dx)),
          connectorCandidateYs: box => futureScenes.flatMap(scene =>
            scene.collectionSpace.candidateYs({ ...box, x: box.x - scene.dx, y: box.y - scene.dy })
              .map(y => y + scene.dy)),
          acceptsConnector: box => futureScenes.every(scene => {
            const projected = { ...box, x: box.x - scene.dx, y: box.y - scene.dy,
              collectionRows: box.collectionRows?.filter(row => scene.rowVisible(row.ownerKeys)) };
            return (box.caseRowY === undefined || scene.caseClears(projected))
              && scene.collectionSpace.clears(projected);
          })
        };
      } });
    layout.forEach((placement, index) => remembered.set(plaqueIdentity(frame.items[index]), placement));
    return layout;
  };
  // D6 collection curves have fixed endpoints and control lanes. Reserve them
  // first so an earlier, freely placed grid cannot force a later detour.
  frames.forEach((_, stageIndex) => allocate(stageIndex, true));
  return frames.map((_, stageIndex) => allocate(stageIndex));
}

export function buildStagePlaqueLayout(input: StageLayoutInput): Map<number, PlaquePlacement> {
  return buildReplayPlaqueLayouts(input)[input.stageIndex] ?? new Map();
}

/** Shared reservation for placement and verification, including unrevealed stage trajectories. */
export function measureStagePlaqueSpace(input: StageLayoutInput) {
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
  const items = input.plan?.frames[input.stageIndex]?.items ?? [];
  const measured = (scenes.length ? scenes : [{ currentTree: completedTree, visibleIds: null, playedRelations: null }]).map(scene => {
    const currentNodes = visibleNodes(scene.currentTree, scene.visibleIds);
    const obstacles = [...plaqueTreeObstacles(currentNodes, input.measureCategoryText), ...plaqueConnectorObstacles(items, currentNodes)];
    // Use the trajectory binder's actual geometry in each frame's coordinates.
    if (!input.plan) return { nodes: currentNodes, obstacles, playedRelations: scene.playedRelations };
    const byId = indexHierarchyNodesByIdAndAliases(visibleNodes(scene.currentTree, scene.visibleIds));
    const frame = input.plan.frames[input.stageIndex];
    const trajectories = (frame?.items ?? []).filter(item => item.kind === 'trajectory')
      .map(item => resolveDisplayedTrajectoryAttachments(item, id => byId.get(id)?.data,
        { stageIndex: input.stageIndex, playedRelationIndices: scene.playedRelations }));
    if (!trajectories.length) return { nodes: currentNodes, obstacles, playedRelations: scene.playedRelations };
    const plan = { ...input.plan, frames: input.plan.frames.map((frame, index) =>
      index === input.stageIndex ? { ...frame, items: trajectories } : frame) };
    const bound = bindRelationPlanFrame(plan, input.stageIndex, stagePositionProvider(byId), {
      trajectoryCeilingY: (d3.min([...byId.values()], node => node.y) ?? 0) - 160,
      trajectoryFloorY: (d3.max([...byId.values()], node => node.y) ?? 0) + 180
    });
    for (const path of bound.primitives) {
      if (path.type !== 'trajectory-path') continue;
      const points = path.route === 'cubic' && path.control2
        ? sampleCubic(path.start, path.control, path.control2, path.end, 32)
        : path.route === 'orthogonal' ? [path.start, { x: path.start.x, y: path.control.y },
          { x: path.end.x, y: path.control.y }, path.end]
          : sampleQuadratic(path.start, path.control, path.end, 32);
      points.slice(1).forEach((point, i) => obstacles.push({
        x: Math.min(points[i].x, point.x) - 5, y: Math.min(points[i].y, point.y) - 5,
        width: Math.abs(point.x - points[i].x) + 10, height: Math.abs(point.y - points[i].y) + 10
      }));
    }
    return { nodes: currentNodes, obstacles, playedRelations: scene.playedRelations };
  });
  return { nodes, obstacles: measured.flatMap(scene => scene.obstacles), scenes: measured };
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

function measureStageCameraBounds({ steps, stageIndex, completedCanvas, plan, width, height, layoutGroups, direction = 'ltr',
  abstractionMode = false, protectedNodeIds = new Set<string>(), includeOverlays = true,
  includePlaques = includeOverlays, plaqueLayout, measureCategoryText }: StageCameraInput): OverlayBounds | null {
  let bounds: OverlayBounds | null = null;
  const include = (next: OverlayBounds | null) => {
    if (!next) return;
    bounds = bounds ? {
      minX: Math.min(bounds.minX, next.minX), minY: Math.min(bounds.minY, next.minY),
      maxX: Math.max(bounds.maxX, next.maxX), maxY: Math.max(bounds.maxY, next.maxY)
    } : { ...next };
  };
  const input = { steps, stageIndex, completedCanvas, plan, width, height, direction, abstractionMode, protectedNodeIds, layoutGroups, measureCategoryText };
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
      const label = categoryTextLayout(node.data.label || '', measureCategoryText);
      include({ minX: node.x, maxX: node.x, minY: node.y,
        maxY: node.y + (node.children?.length ? 0 : 130) });
      if (label.lines.length > 1) include({ minX: node.x + label.x, maxX: node.x - label.x,
        minY: node.y + label.y, maxY: node.y });
    }
    const byId = indexHierarchyNodesByIdAndAliases(fitNodes);
    if (includePlaques && plan) {
      const rectFor = (id: string, terminal: boolean) => {
        const node = byId.get(id);
        if (!node) return null;
        const leaves = terminal ? node.descendants().filter(child =>
          !child.children?.length && isDisplayTerminalSurface(resolveLeafSurface(child))) : [];
        const rects = (leaves.length ? leaves : [node]).map(child => {
          const word = leaves.length ? resolveLeafSurface(child) : '';
          const width = Math.max(150, String(word || child.data.label || '').length * 40);
          return { x: child.x - width / 2, y: child.y + (word ? 85 : -42), width, height: word ? 90 : 84 };
        });
        const x = Math.min(...rects.map(rect => rect.x)), y = Math.min(...rects.map(rect => rect.y));
        return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x,
          height: Math.max(...rects.map(rect => rect.y + rect.height)) - y };
      };
      nativeRelationPlaqueRects(plan.frames[stageIndex]?.items ?? [], rectFor).forEach(rect => include({
        minX: rect.x - 24, maxX: rect.x + rect.width + 24, minY: rect.y - 24, maxY: rect.y + rect.height + 24
      }));
    }
    if (!includeOverlays || !plan) continue;
    const positionFor = stagePositionProvider(byId);
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
