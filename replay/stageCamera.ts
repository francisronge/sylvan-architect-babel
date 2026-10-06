import { layoutSyntaxTree, type TreeDirection, type TreeCoordinateReservation } from './treeLayout.ts';
import { buildStageCoordinateReservations } from './stageCoordinates.ts';
import { categoryTextLayout, type CategoryTextMeasure } from './categoryTextLayout.ts';
import { treeInkObstacles, type TreeInkTextMeasure } from './treeInkGeometry.ts';
import type { PreparedTreeLabelRuns, TreeLabelMeasure } from './treeLabelRuns.ts';
import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import {
  applyVizIds, cloneSyntaxTree, indexHierarchyNodesByIdAndAliases,
  isDisplayTerminalSurface, isSyntheticWorkspaceRootNode, isUnderTriangulation,
  markTriangulatedNodes, resolveLeafSurface, type PlaybackStep
} from './replayCompiler.ts';
import { bindRelationPlanFrame, boundOverlayBounds, resolveUniqueDisplayTerminal,
  type OverlayBounds, type PlanPositionProvider } from './relations/geometryBinding.ts';
import { planItemRelationRefs, resolveDisplayedTrajectoryAttachments, type RelationRenderPlan } from './relations/renderPlanCompiler.ts';
import { sampleCubic, sampleQuadratic } from './relations/markGeometry.ts';
import { caseAssignmentSource, placeStagePlaques, prepareStagePlaqueRequests, nativeRelationPlaqueRects, plaqueIdentity, plaqueTreeObstacles, plaqueConnectorObstacles, plaqueCaseConnectorObstacles, plaqueCollectionConnectorObstacles, prepareCasePlaqueSpace, prepareCollectionPlaqueSpace, projectPlaqueLayout, projectPlaqueContent, uniquePlaqueObstacles, type PlaquePlacement } from './relations/plaquePlacement.ts';
import type { PlaqueTextMeasure } from './relations/plaqueTextLayout.ts';
import { translateObstacle, prepareImmutableObstacleTranslations } from './relations/plaqueObstacleIndex.ts';
import { bindingDomainEllipse, bindingDomainTreeRect, bindingEllipseBounds, bindingDomainPlaques } from './relations/bindingDomainGeometry.ts';

export type StageLayoutInput = {
  steps: PlaybackStep[]; stageIndex: number; completedCanvas: SyntaxNode;
  plan: RelationRenderPlan | null; width: number; height: number;
  direction?: TreeDirection;
  abstractionMode?: boolean; protectedNodeIds?: Set<string>;
  layoutGroups?: readonly (readonly number[])[];
  measurePlaqueText?: PlaqueTextMeasure;
  measureCategoryText?: CategoryTextMeasure;
  measureTreeInk?: TreeInkTextMeasure;
  treeLabelRuns?: PreparedTreeLabelRuns;
  measureTreeLabel?: TreeLabelMeasure;
};

export type StageCoordinateReservations = ReadonlyMap<SyntaxNode, TreeCoordinateReservation>;
export type MeasuredStageCoordinates = ReadonlyMap<number, StageCoordinateReservations>;
/** Internal handoff for measured worker jobs; supplied coordinates must match the input. */
type StageGeometry = {
  reservations?: StageCoordinateReservations;
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

/** Exact attachment changes delimit geometric lifetimes, independently of the
 * relation's name or drawing tier. A receiving head may move as a new sibling. */
function changedPlaqueAttachments(before: d3.HierarchyPointNode<SyntaxNode>[], after: d3.HierarchyPointNode<SyntaxNode>[],
  items: RelationRenderPlan['frames'][number]['items']) {
  const idOf = (node: d3.HierarchyPointNode<SyntaxNode>) => String((node as any).__vizId ?? node.data.id);
  const beforeNodes = new Set(before), afterNodes = new Set(after);
  const realParentId = (node: d3.HierarchyPointNode<SyntaxNode>, visibleNodes: Set<d3.HierarchyPointNode<SyntaxNode>>) => {
    // Future stage parents can be present in the canvas before their merge.
    // Only an available parent can change a plaque participant's attachment.
    const parent = node.ancestors().slice(1).find(ancestor => visibleNodes.has(ancestor)
      && !(ancestor.data as any).replayLayoutOnly && !isSyntheticWorkspaceRootNode(ancestor));
    return parent && idOf(parent);
  };
  const prior = indexHierarchyNodesByIdAndAliases(before), current = indexHierarchyNodesByIdAndAliases(after);
  const changed = new Set<string>();
  after.forEach(node => {
    const old = prior.get(idOf(node));
    if (old && Math.hypot(node.x - old.x, node.y - old.y) > 1e-8
      && realParentId(old, beforeNodes) !== realParentId(node, afterNodes)) {
      node.each(descendant => changed.add(idOf(descendant)));
    }
  });
  for (const request of prepareStagePlaqueRequests(items, after)) {
    if (!request.caseAssignment) continue;
    const old = prior.get(request.ids[0]), next = current.get(request.ids[0]);
    if (old && next && idOf(caseAssignmentSource(old)) !== idOf(caseAssignmentSource(next))) changed.add(request.ids[0]);
  }
  return changed;
}

function stageLayouts({ steps, stageIndex, completedCanvas, plan, width, height, layoutGroups, direction = 'ltr',
  abstractionMode = false, protectedNodeIds = new Set<string>(), measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel }: StageLayoutInput, geometry?: StageGeometry) {
  const stageSize = stageTreeLayoutSize(steps, stageIndex, width, height, layoutGroups);
  const reservations = geometry?.reservations ?? (stageSize ? buildStageCoordinateReservations(steps, stageIndex, stageSize,
    index => stageTreeLayoutSize(steps, index, width, height, layoutGroups), direction, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel) : null);
  const hierarchy = (canvas: SyntaxNode) => {
    const root = d3.hierarchy(cloneSyntaxTree(canvas)!);
    applyVizIds(root);
    if (abstractionMode) markTriangulatedNodes(root, protectedNodeIds);
    return root;
  };
  const scenes: Array<{ currentTree: d3.HierarchyPointNode<SyntaxNode>;
    isRecord: boolean; visibleIds: Set<string> | null; playedRelations: Set<number>;
    phase: number; stepIndices: number[]; movedNodeIds: Set<string> }> = [];
  const seen = new Map<string, (typeof scenes)[number]>();
  let phase = 0;
  let preceding: { tree: d3.HierarchyPointNode<SyntaxNode>; visibleIds: Set<string> | null } | undefined;
  const nodeId = (node: d3.HierarchyPointNode<SyntaxNode>) => String((node as any).__vizId ?? node.data.id);
  const ordered = steps.map((step, index) => ({ step, index }))
    .filter(({ step }) => step.replayFrameIndex === stageIndex && step.replayCanvasData)
    .sort((a, b) => (a.step.replayStageStepIndex ?? a.index) - (b.step.replayStageStepIndex ?? b.index));
  for (const { step, index: stepIndex } of ordered) {
    const playedRelations = new Set((step.replayRelationLinks ?? []).flatMap(link => {
      const [stage, relation] = String('authoredRelationKey' in link ? link.authoredRelationKey : '').split(':').map(Number);
      return stage === stageIndex && Number.isInteger(relation) ? [relation] : [];
    }));
    const coordinates = reservations?.get(step.replayCanvasData!);
    const visibleIds = step.replayVisibleNodeIds ? new Set(step.replayVisibleNodeIds) : null;
    const partialForks: Array<[string, string[]]> = [];
    const visitForks = (node: SyntaxNode) => {
      const children = (node.children ?? []).filter(child => !(child as SyntaxNode & { replayLayoutOnly?: boolean }).replayLayoutOnly);
      if (visibleIds?.has(node.id ?? '') && children.some(child => !visibleIds.has(child.id ?? ''))) {
        partialForks.push([node.id ?? '', children.filter(child => visibleIds.has(child.id ?? '')).map(child => child.id ?? '')]);
      }
      node.children?.forEach(visitForks);
    };
    if (visibleIds) visitForks(step.replayCanvasData!);
    const root = hierarchy(step.replayCanvasData!);
    const currentTree = layoutSyntaxTree(root,
      stageSize ?? treeLayoutSize(root.descendants().length, root.height, width, height), direction,
      coordinates, visibleIds ?? undefined);
    const movedNodeIds = preceding && step.replayKind === 'relation'
      ? changedPlaqueAttachments(preceding.tree.descendants().filter(node => !preceding!.visibleIds || preceding!.visibleIds.has(nodeId(node))),
        currentTree.descendants().filter(node => !visibleIds || visibleIds.has(nodeId(node))), plan?.frames[stageIndex]?.items ?? [])
      : new Set<string>();
    if (movedNodeIds.size) phase++;
    preceding = { tree: currentTree, visibleIds };
    const key = JSON.stringify([step.replayCanvasData, Boolean(step.replayUsesFutureLayoutScaffold),
      coordinates ? [...coordinates] : null, partialForks, phase]);
    const existing = seen.get(key);
    if (existing) {
      existing.isRecord ||= step.replayKind === 'macro';
      existing.stepIndices.push(stepIndex);
      playedRelations.forEach(index => existing.playedRelations.add(index));
      step.replayVisibleNodeIds?.forEach(id => existing.visibleIds?.add(id));
      continue;
    }
    const scene = { currentTree, playedRelations: new Set(playedRelations), phase, stepIndices: [stepIndex], movedNodeIds,
      isRecord: step.replayKind === 'macro', visibleIds };
    scenes.push(scene);
    seen.set(key, scene);
  }
  const root = hierarchy(completedCanvas);
  const completedTree = layoutSyntaxTree(root,
    stageSize ?? treeLayoutSize(root.descendants().length, root.height, width, height), direction,
    reservations?.get(completedCanvas));
  return { scenes, completedTree };
}

export type ReplayPlaqueSchedule = {
  stages: Map<number, PlaquePlacement>[];
  steps: Map<number, Map<number, PlaquePlacement>>;
};

export function selectReplayPlaqueLayout(schedule: ReplayPlaqueSchedule, stageIndex: number, replayStepIndex?: number) {
  return (replayStepIndex === undefined ? undefined : schedule.steps.get(replayStepIndex))
    ?? schedule.stages[stageIndex] ?? new Map<number, PlaquePlacement>();
}

/** A pocket persists until one of its exact participants moves. Reserve all
 * compatible scenes; an authored relocation may revalidate the previous pocket. */
export function buildReplayPlaqueSchedule(input: StageLayoutInput, coordinates?: MeasuredStageCoordinates,
  stageReady?: (schedule: ReplayPlaqueSchedule, stageIndex: number) => void): ReplayPlaqueSchedule {
  const translateScene = prepareImmutableObstacleTranslations();
  const frames = input.plan?.frames ?? [];
  const spaces = frames.map((_, stageIndex) => measureStagePlaqueSpace({ ...input, stageIndex }, { reservations: coordinates?.get(stageIndex) }));
  const phases = spaces.flatMap((space, stageIndex) => {
    const groups = new Map<number, typeof space.scenes>();
    space.scenes.forEach(scene => groups.set(scene.phase, [...(groups.get(scene.phase) ?? []), scene]));
    return [...groups.values()].map(scenes => ({ stageIndex, scenes,
      nodes: scenes.at(-1)!.nodes, obstacles: scenes.flatMap(scene => scene.obstacles),
      movedNodeIds: new Set(scenes.flatMap(scene => [...scene.movedNodeIds])) }));
  });
  // A stage may begin with its first relation moment, without a preceding
  // structural frame. Include its exact attachment change across that boundary.
  phases.forEach((phase, index) => {
    const previous = phases[index - 1];
    if (!previous || previous.stageIndex === phase.stageIndex) return;
    // Equivalent canvases share a scene whose availability is a union. The
    // boundary must use its actual last/first Replay moments, not later reveals.
    const atStep = (nodes: typeof previous.nodes, stepIndex: number) => {
      const ids = input.steps[stepIndex]?.replayVisibleNodeIds;
      const visible = ids && new Set(ids);
      return visible ? nodes.filter(node => visible.has(String((node as any).__vizId ?? node.data.id))) : nodes;
    };
    changedPlaqueAttachments(atStep(previous.nodes, previous.scenes.at(-1)!.stepIndices.at(-1)!),
      atStep(phase.scenes[0].nodes, phase.scenes[0].stepIndices[0]), frames[phase.stageIndex].items)
      .forEach(id => phase.movedNodeIds.add(id));
  });
  const phaseRequests = phases.map(phase => prepareStagePlaqueRequests(frames[phase.stageIndex].items, phase.nodes, input.measurePlaqueText));
  const sizes = new Map<string, { width: number; height: number; collectionWidth: number }>();
  phases.forEach((phase, i) => phaseRequests[i].forEach(request => {
    const key = plaqueIdentity(frames[phase.stageIndex].items[request.index]), prior = sizes.get(key);
    sizes.set(key, { width: Math.max(prior?.width ?? 0, request.width), height: Math.max(prior?.height ?? 0, request.height),
      // A port must exist on the narrower shell too, before later rows widen it.
      collectionWidth: Math.min(prior?.collectionWidth ?? Infinity, request.width) });
  }));
  const participantIds = (request: typeof phaseRequests[number][number], phaseIndex: number) => {
    const ids = new Set([...request.ids, ...(request.collectionRows ?? []).map(row => row.sourceNodeId)]);
    if (request.caseAssignment) phases[phaseIndex].scenes.forEach(scene => {
      const anchor = indexHierarchyNodesByIdAndAliases(scene.nodes).get(request.ids[0]);
      if (anchor) { const source = caseAssignmentSource(anchor); ids.add(String((source as any).__vizId ?? source.data.id)); }
    });
    return ids;
  };
  const geometryBoundary = (phaseIndex: number, request: typeof phaseRequests[number][number], participants: Set<string>) => {
    const next = phases[phaseIndex], previous = phases[phaseIndex - 1];
    if (!previous || ![...next.movedNodeIds].some(id => participants.has(id))) return false;
    const left = indexHierarchyNodesByIdAndAliases(previous.scenes.at(-1)!.nodes);
    const right = indexHierarchyNodesByIdAndAliases(next.scenes[0].nodes);
    const oldAnchor = left.get(request.ids[0]), nextAnchor = right.get(request.ids[0]);
    if (!oldAnchor || !nextAnchor) return false;
    const pairs = [...participants].flatMap(id => {
      const old = left.get(id), node = right.get(id);
      return old && node ? [[old, node] as const] : [];
    });
    if (request.caseAssignment) {
      const old = caseAssignmentSource(oldAnchor), node = caseAssignmentSource(nextAnchor);
      if (String((old as any).__vizId ?? old.data.id) !== String((node as any).__vizId ?? node.data.id)) return true;
      pairs.push([old, node]);
    }
    return pairs.some(([old, node]) => Math.abs((old.x - oldAnchor.x) - (node.x - nextAnchor.x)) > 1e-8
      || Math.abs((old.y - oldAnchor.y) - (node.y - nextAnchor.y)) > 1e-8);
  };
  const remembered = new Map<string, PlaquePlacement>();
  const collectionReservations: Map<number, PlaquePlacement>[] = [];
  const allocate = (phaseIndex: number, collectionsOnly = false) => {
    const phase = phases[phaseIndex], stageIndex = phase.stageIndex, frame = frames[stageIndex];
    const { nodes, obstacles } = phase;
    if (!collectionsOnly) collectionReservations[phaseIndex]?.forEach((box, index) => {
      const key = plaqueIdentity(frame.items[index]);
      const request = phaseRequests[phaseIndex].find(request => request.index === index)!;
      // A reservation seeds new lifetimes; an accepted pocket owns continuity.
      if (!remembered.has(key) || geometryBoundary(phaseIndex, request, participantIds(request, phaseIndex))) {
        remembered.set(key, box);
      }
    });
    const reconsider = new Set(phaseRequests[phaseIndex].filter(request =>
      (collectionsOnly || !collectionReservations[phaseIndex]?.has(request.index))
      && geometryBoundary(phaseIndex, request, participantIds(request, phaseIndex)))
      .map(request => request.index));
    const layout = placeStagePlaques(frame.items, nodes, obstacles, remembered, input.measurePlaqueText, { sizes, collectionsOnly, reconsider,
      spaceFor: (index, anchor, allocated) => {
        const key = plaqueIdentity(frame.items[index]);
        const known = new Map(remembered);
        allocated.forEach((placement, itemIndex) => known.set(plaqueIdentity(frame.items[itemIndex]), placement));
        const request = phaseRequests[phaseIndex].find(request => request.index === index)!;
        const participants = participantIds(request, phaseIndex);
        let end = phaseIndex + 1;
        while (end < phases.length) {
          const nextRequest = phaseRequests[end].find(candidate =>
            plaqueIdentity(frames[phases[end].stageIndex].items[candidate.index]) === key);
          if (nextRequest) {
            participantIds(nextRequest, end).forEach(id => participants.add(id));
            if (geometryBoundary(end, nextRequest, participants)) break;
          }
          end++;
        }
        const futureScenes = phases.slice(phaseIndex, end).flatMap((space, offset) => {
          const items = frames[space.stageIndex].items;
          const futureIndex = items.findIndex(item => plaqueIdentity(item) === key);
          const futureRequest = phaseRequests[phaseIndex + offset].find(request => request.index === futureIndex);
          if (!futureRequest) return [];
          return space.scenes.flatMap(scene => {
            const byId = indexHierarchyNodesByIdAndAliases(scene.nodes);
            const futureAnchor = byId.get(String((anchor as any).__vizId ?? anchor.data.id));
            if (!futureAnchor) return [];
            const dx = anchor.x - futureAnchor.x, dy = anchor.y - futureAnchor.y;
            const otherPlacements = new Map(items.flatMap((item, index) => {
              const otherKey = plaqueIdentity(item);
              const reserved = collectionReservations[phaseIndex + offset]?.get(index);
              const placement = offset === 0 ? known.get(otherKey) ?? reserved : reserved ?? known.get(otherKey);
              const request = phaseRequests[phaseIndex + offset].find(request => request.index === index);
              return otherKey !== key && placement && request ? [[index, projectPlaqueContent(placement, request)] as const] : [];
            }));
            const projected = projectPlaqueLayout(otherPlacements, id => byId.get(id) ?? null);
            const plaques = [...projected.values()].map(box => ({ ...box, blocksConnectors: true }));
            const addedObstacles = [...plaques, ...plaqueCaseConnectorObstacles(items, scene.nodes, projected),
              ...plaqueCollectionConnectorObstacles(scene.nodes, projected)];
            const obstacles = [...scene.obstacles, ...addedObstacles];
            const visibleRows = new WeakMap<string[], boolean>();
            const rowVisible = (owners: string[] | undefined): boolean => {
              if (!scene.playedRelations || !owners) return true;
              let visible = visibleRows.get(owners);
              if (visible === undefined) {
                visible = owners.some(key => {
                  const [stage, relation] = key.split(':').map(Number);
                  return stage < space.stageIndex || (stage === space.stageIndex && scene.playedRelations!.has(relation));
                });
                visibleRows.set(owners, visible);
              }
              return visible;
            };
            let collectionSpace: ReturnType<typeof prepareCollectionPlaqueSpace> | undefined;
            let caseClears: ReturnType<typeof prepareCasePlaqueSpace> | undefined;
            return [{ anchor: futureAnchor, request: futureRequest,
              caseVisible: rowVisible(planItemRelationRefs(items[futureIndex]).map(ref => `${ref.stageIndex}:${ref.relationIndex}`)),
              get caseClears() { return caseClears ??= prepareCasePlaqueSpace(futureAnchor, obstacles); },
              get collectionSpace() { return collectionSpace ??= prepareCollectionPlaqueSpace(scene.nodes, obstacles); }, rowVisible, dx, dy,
              obstacles, staticObstacles: scene.obstacles, addedObstacles }];
          });
        });
        return {
          obstacles: uniquePlaqueObstacles(futureScenes.flatMap(scene => [
            ...translateScene(scene.staticObstacles, scene.dx, scene.dy),
            ...scene.addedObstacles.map(box => translateObstacle(box, scene.dx, scene.dy))])),
          connectorCandidateXs: box => futureScenes.flatMap(scene =>
            scene.collectionSpace.candidateXs({ ...box, x: box.x - scene.dx, y: box.y - scene.dy })
              .map(x => x + scene.dx)),
          connectorCandidateYs: box => futureScenes.flatMap(scene =>
            scene.collectionSpace.candidateYs({ ...box, x: box.x - scene.dx, y: box.y - scene.dy })
              .map(y => y + scene.dy)),
          acceptsConnector: box => (box.caseRowY === undefined && !box.collectionRows?.length) || futureScenes.every(scene => {
            const projected = projectPlaqueContent({ ...box, x: box.x - scene.dx, y: box.y - scene.dy }, scene.request);
            projected.collectionRows = projected.collectionRows?.filter(row => scene.rowVisible(row.ownerKeys));
            return (box.caseRowY === undefined || !scene.caseVisible || scene.caseClears(projected))
              && (!projected.collectionRows?.length || scene.collectionSpace.clears(projected));
          })
        };
      } });
    layout.forEach((placement, index) => remembered.set(plaqueIdentity(frame.items[index]), placement));
    return layout;
  };
  // D6 collection curves have fixed endpoints and control lanes. Reserve them
  // first so an earlier, freely placed grid cannot force a later detour.
  phases.forEach((_, phaseIndex) => { collectionReservations[phaseIndex] = allocate(phaseIndex, true); });
  remembered.clear();
  const schedule: ReplayPlaqueSchedule = { stages: [], steps: new Map() };
  phases.forEach((phase, phaseIndex) => {
    const layout = allocate(phaseIndex);
    schedule.stages[phase.stageIndex] = layout;
    phase.scenes.forEach(scene => scene.stepIndices.forEach(index => schedule.steps.set(index, layout)));
    if (phases[phaseIndex + 1]?.stageIndex !== phase.stageIndex) stageReady?.(schedule, phase.stageIndex);
  });
  return schedule;
}

/** Completed-stage layouts for callers without an active Replay moment. */
export function buildReplayPlaqueLayouts(input: StageLayoutInput): Map<number, PlaquePlacement>[] {
  return buildReplayPlaqueSchedule(input).stages;
}

export function buildStagePlaqueLayout(input: StageLayoutInput): Map<number, PlaquePlacement> {
  return buildReplayPlaqueLayouts(input)[input.stageIndex] ?? new Map();
}

/** Shared reservation for placement and verification, including unrevealed stage trajectories. */
export function measureStagePlaqueSpace(input: StageLayoutInput, geometry?: StageGeometry) {
  const { scenes, completedTree } = stageLayouts(input, geometry);
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
  const measured = (scenes.length ? scenes : [{ currentTree: completedTree, visibleIds: null, playedRelations: null,
    phase: 0, stepIndices: [], movedNodeIds: new Set<string>() }]).map(scene => {
    const timing = { phase: scene.phase, stepIndices: scene.stepIndices, movedNodeIds: scene.movedNodeIds };
    const currentNodes = visibleNodes(scene.currentTree, scene.visibleIds);
    const obstacles = [...plaqueTreeObstacles(currentNodes, input.measureCategoryText), ...plaqueConnectorObstacles(items, currentNodes)];
    // Use the trajectory binder's actual geometry in each frame's coordinates.
    if (!input.plan) return { nodes: currentNodes, obstacles, playedRelations: scene.playedRelations, ...timing };
    const byId = indexHierarchyNodesByIdAndAliases(visibleNodes(scene.currentTree, scene.visibleIds));
    const frame = input.plan.frames[input.stageIndex];
    const trajectories = (frame?.items ?? []).filter(item => item.kind === 'trajectory')
      .map(item => resolveDisplayedTrajectoryAttachments(item, id => byId.get(id)?.data,
        { stageIndex: input.stageIndex, playedRelationIndices: scene.playedRelations }));
    if (!trajectories.length) return { nodes: currentNodes, obstacles, playedRelations: scene.playedRelations, ...timing };
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
    return { nodes: currentNodes, obstacles, playedRelations: scene.playedRelations, ...timing };
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
  const completedCanvas = steps.find(step => step.replayFrameIndex === layoutStageIndex
    && step.replayKind === 'macro')?.replayCanvasData;
  const completesSingleTree = Boolean(completedCanvas && completedCanvas.replayOrigin?.kind !== 'workspace');
  let nodeCount = 0;
  let depth = 0;
  for (const step of steps) {
    if (step.replayFrameIndex !== layoutStageIndex || !step.replayCanvasData) continue;
    const root = d3.hierarchy(step.replayCanvasData);
    // An unfinished wrapper may temporarily split one authored tree into a
    // forest. Its synthetic container adds no syntax or layout level.
    const temporaryWorkspace = completesSingleTree && isSyntheticWorkspaceRootNode(root);
    nodeCount = Math.max(nodeCount, root.descendants().length - Number(temporaryWorkspace));
    depth = Math.max(depth, root.height - Number(temporaryWorkspace));
  }
  return nodeCount ? treeLayoutSize(nodeCount, depth, width, height) : null;
}

type StageCameraInput = StageLayoutInput & {
  /** Prepared off-thread; when supplied, camera fitting must not plan coordinates. */
  coordinates?: MeasuredStageCoordinates;
  /** A completed Replay fits its present drawing, without earlier source positions. */
  stepIndex?: number;
  includeOverlays?: boolean; includePlaques?: boolean; includeBindingDomains?: boolean; plaqueLayout?: Map<number, PlaquePlacement>; plaqueSchedule?: ReplayPlaqueSchedule
};

/** Reserved by every stage camera, including retained fits. */
export const STAGE_CAMERA_PADDING = { x: 220, y: 160 } as const;

/** Reserve upcoming content before reveal, using one fit for a compatible layout group. */
export function buildStageCameraBounds(input: StageCameraInput): OverlayBounds | null {
  const stageIndices = input.stepIndex === undefined
    ? input.layoutGroups?.find(group => group.includes(input.stageIndex)) ?? [input.stageIndex]
    : [input.stageIndex];
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
  includePlaques = includeOverlays, includeBindingDomains = false,
  plaqueLayout, plaqueSchedule, coordinates, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel, measurePlaqueText, stepIndex }: StageCameraInput): OverlayBounds | null {
  let bounds: OverlayBounds | null = null;
  const include = (next: OverlayBounds | null) => {
    if (!next) return;
    bounds = bounds ? {
      minX: Math.min(bounds.minX, next.minX), minY: Math.min(bounds.minY, next.minY),
      maxX: Math.max(bounds.maxX, next.maxX), maxY: Math.max(bounds.maxY, next.maxY)
    } : { ...next };
  };
  const input = { steps, stageIndex, completedCanvas, plan, width, height, direction, abstractionMode, protectedNodeIds, layoutGroups, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel };
  const schedule = includePlaques ? plaqueSchedule ?? (plaqueLayout ? undefined : buildReplayPlaqueSchedule(input, coordinates)) : undefined;
  const fallbackPlacements = includePlaques ? plaqueLayout ?? schedule?.stages[stageIndex] ?? new Map() : new Map();
  if (coordinates && !coordinates.has(stageIndex) && steps.some(step => step.replayFrameIndex === stageIndex && step.replayCanvasData))
    throw new Error('Missing prepared Replay coordinates.');
  for (const { currentTree, visibleIds, stepIndices } of stageLayouts(input,
    coordinates ? { reservations: coordinates.get(stageIndex) ?? new Map() } : undefined).scenes) {
    if (stepIndex !== undefined && !stepIndices.includes(stepIndex)) continue;
    const placements = includePlaques && schedule ? selectReplayPlaqueLayout(schedule, stageIndex, stepIndices[0]) : fallbackPlacements;
    // Future syntax reserves layout coordinates, not camera space. Union the
    // actually revealed syntax across the stage to keep its microsteps stable.
    const fitNodes = currentTree.descendants().filter(node =>
      !isUnderTriangulation(node) && !isSyntheticWorkspaceRootNode(node)
      && (!visibleIds || visibleIds.has(String((node as any).__vizId ?? node.data.id ?? ''))));
    const byId = indexHierarchyNodesByIdAndAliases(fitNodes);
    // A hidden anchor's provisional coordinates are not a plaque position.
    // Later scenes reserve its real placement in the same stage-wide fit.
    const projectedPlaques = projectPlaqueLayout(placements, id => byId.get(id) ?? null);
    projectedPlaques.forEach(rect => include({
      minX: rect.x - 24, maxX: rect.x + rect.width + 24, minY: rect.y - 24, maxY: rect.y + rect.height + 24
    }));
    for (const node of fitNodes) {
      const label = categoryTextLayout(node.data.label || '', measureCategoryText);
      include({ minX: node.x, maxX: node.x, minY: node.y,
        maxY: node.y + (node.children?.length ? 0 : 130) });
      if (label.lines.length > 1) include({ minX: node.x + label.x, maxX: node.x - label.x,
        minY: node.y + label.y, maxY: node.y });
    }
    // The renderer already adds the shared margin around these bounds. Extend
    // it only where a painted label exceeds that margin, preserving short-label fits.
    const labels = treeLabelRuns?.get(steps[stepIndices[0]].replayCanvasData!);
    for (const rect of treeInkObstacles(fitNodes, measureCategoryText, measureTreeInk, false, labels, measureTreeLabel)) {
      if (!rect.connectorAttachment) continue;
      include({ minX: rect.x + STAGE_CAMERA_PADDING.x, maxX: rect.x + rect.width - STAGE_CAMERA_PADDING.x,
        minY: rect.y + STAGE_CAMERA_PADDING.y, maxY: rect.y + rect.height - STAGE_CAMERA_PADDING.y });
    }
    if (includeBindingDomains && plan) {
      const visible = new Set(fitNodes);
      for (const item of plan.frames[stageIndex]?.items ?? []) {
        if (item.kind !== 'binding-domain') continue;
        const domain = byId.get(item.domainNodeId);
        const rect = domain && bindingDomainTreeRect(domain.descendants().filter(node => visible.has(node)), measureCategoryText);
        if (rect && domain) {
          const members = new Set(domain.descendants());
          const boxes = (nodes: typeof fitNodes) => nodes.flatMap(node => {
            const box = bindingDomainTreeRect([node], measureCategoryText);
            return box ? [box] : [];
          });
          include(bindingEllipseBounds(bindingDomainEllipse(rect,
            bindingDomainPlaques(domain.descendants().map(node => String((node as any).__vizId ?? node.data.id)),
              plan.frames[stageIndex]?.items ?? [], projectedPlaques),
            boxes(fitNodes.filter(node => members.has(node))), boxes(fitNodes.filter(node => !members.has(node))))));
        }
      }
    }
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
      nativeRelationPlaqueRects(plan.frames[stageIndex]?.items ?? [], rectFor, measurePlaqueText).forEach(rect => include({
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
