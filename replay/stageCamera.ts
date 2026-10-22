import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { categoryTextLayout, type CategoryTextMeasure } from './categoryTextLayout.ts';
import { applyVizIds } from './displayIdentity.ts';
import {
  bindingDomainEllipse,
  bindingDomainPlaques,
  bindingDomainTreeRect,
  bindingEllipseBounds
} from './relations/bindingDomainGeometry.ts';
import { bindRelationPlanFrame } from './relations/geometryBinding.ts';
import { boundOverlayBounds, type OverlayBounds } from './relations/geometryBounds.ts';
import { resolveUniqueDisplayTerminal } from './relations/trajectoryAttachment.ts';
import { type PlanPositionProvider } from './relations/boundGeometry.ts';
import { sampleCubic, sampleQuadratic } from './relations/markGeometry.ts';
import { predicationPlaqueObstacles } from './relations/predicationPlaqueSpace.ts';
import { nativePlaqueFootprints, nativePlaqueObstacles } from './relations/nativePlaqueSpace.ts';
import { prepareLifetimePlaqueSpaces, type LifetimeScene } from './relations/plaqueLifetimeSpace.ts';
import {
  caseAssignmentSource,
  measuredCaseSourceRect,
  beyondNearbyReach,
  DETACHED_PLAQUE_GAP,
  MIN_RELOCATION_GAIN,
  plaqueAnchorPoint,
  placeStagePlaques,
  plaqueCaseConnectorObstacles,
  plaqueCollectionConnectorObstacles,
  plaqueConnectorObstacles,
  plaqueIdentity,
  plaquesOverlap,
  plaqueTreeObstacles,
  prepareCurveObstacleRects,
  prepareStagePlaqueRequests,
  projectPlaqueContent,
  projectPlaqueLayout,
  type CaseSourceRects,
  type PlaquePlacement,
  type PlaqueRect
} from './relations/plaquePlacement.ts';
import type { PlaqueTextMeasure } from './relations/plaqueTextLayout.ts';
import {
  planItemRelationRefs,
  resolveDisplayedTrajectoryAttachments,
  type RelationRenderPlan
} from './relations/renderPlan.ts';
import { cloneSyntaxTree } from './syntaxForest.ts';
import { indexHierarchyNodesByIdAndAliases, isSyntheticWorkspaceRootNode } from './replayCanvas.ts';
import { isUnderTriangulation, markTriangulatedNodes } from './triangulation.ts';
import { isDisplayTerminalNode, resolveLeafSurface } from './replaySurfaceNotation.ts';
import {
  LEAF_INK_EXTENT_Y, PLAQUE_FIT_MARGIN, RELATION_BINDING_METRICS, RELATION_LANES_BELOW_DEEPEST_NODE,
  SHELL_ATTACHMENT_CLEARANCE, TERMINAL_ATTACHMENT_Y, TRAJECTORY_ROUTES
} from './rendererMetrics.ts';
import { buildStageCoordinateReservations } from './stageCoordinates.ts';
import { treeInkObstacles, type TreeInkTextMeasure } from './treeInkGeometry.ts';
import type { PreparedTreeLabelRuns, TreeLabelMeasure, TreeLabelRuns } from './treeLabelRuns.ts';
import { layoutSyntaxTree, type TreeCoordinateReservation, type TreeDirection } from './treeLayout.ts';
import { TREE_ROW_HEIGHT } from './treeSpacing.ts';
import { type PlaybackStep } from './types.ts';

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
        n => isDisplayTerminalNode(n.data));
      return terminal ? { x: terminal.x, y: terminal.y + TERMINAL_ATTACHMENT_Y } : null;
    }
    return { x: node.x, y: node.y + (attachment === 'shell-bottom' ? SHELL_ATTACHMENT_CLEARANCE.bottom
      : attachment === 'shell-top' ? -SHELL_ATTACHMENT_CLEARANCE.top : 0) };
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
      stageSize ?? treeLayoutSize(root.descendants().length, root.height), direction,
      coordinates, visibleIds ?? undefined);
    const movedNodeIds = preceding && step.replayKind === 'relation'
      ? changedPlaqueAttachments(preceding.tree.descendants().filter(node => !preceding!.visibleIds || preceding!.visibleIds.has(nodeId(node))),
        currentTree.descendants().filter(node => !visibleIds || visibleIds.has(nodeId(node))), plan?.frames[stageIndex]?.items ?? [])
      : new Set<string>();
    // Replacing an occurrence changes its plaque attachment even when the
    // lower witness occupies exactly the old coordinates.
    for (const item of plan?.frames[stageIndex]?.items ?? []) for (const transfer of item.occurrenceTransfers ?? []) {
      if (step.replayRelationIdentity?.stageIndex === transfer.stageIndex
        && step.replayRelationIdentity.relationIndex === transfer.relationIndex) {
        movedNodeIds.add(transfer.fromNodeId);
        movedNodeIds.add(transfer.toNodeId);
      }
    }
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
    stageSize ?? treeLayoutSize(root.descendants().length, root.height), direction,
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

/** Each plaque keeps one anchor-relative pocket for a lifetime that ends where its
 * participants' relative geometry changes, and its pocket stays clear in every scene
 * of that lifetime. A plaque without a connector whose one pocket would be remote
 * instead takes a pocket for each position an authored movement carries its anchor
 * to. Plaques are placed in one pass, so each avoids the pockets actually shown.
 * A plaque without a connector still remote afterwards gets one second look per run
 * of phases at one pocket (`bringNear`), which moves no other plaque. */
export function buildReplayPlaqueSchedule(input: StageLayoutInput, coordinates?: MeasuredStageCoordinates,
  stageReady?: (schedule: ReplayPlaqueSchedule, stageIndex: number) => void): ReplayPlaqueSchedule {
  const curveRects = prepareCurveObstacleRects();
  const frames = input.plan?.frames ?? [];
  const spaces = frames.map((_, stageIndex) => measureStagePlaqueSpace({ ...input, stageIndex }, { reservations: coordinates?.get(stageIndex) }));
  // A Case arrow leaves its source label as its own scene paints it.
  const sceneLabels = new WeakMap<d3.HierarchyPointNode<SyntaxNode>, ReadonlyMap<string, readonly TreeLabelRuns[]>>();
  spaces.forEach(space => space.scenes.forEach(scene => scene.nodes.forEach(node => sceneLabels.set(node, scene.labels))));
  const measuredSources = new WeakMap<d3.HierarchyPointNode<SyntaxNode>, PlaqueRect>();
  const caseSources: CaseSourceRects = source => {
    let rect = measuredSources.get(source);
    if (!rect) measuredSources.set(source, rect = measuredCaseSourceRect(source,
      sceneLabels.get(source)?.get(String((source as any).__vizId ?? source.data.id)), input.measureTreeLabel, input.measureCategoryText));
    return rect;
  };
  const lifetimeSpaceOf = prepareLifetimePlaqueSpaces(caseSources);
  const phases = spaces.flatMap((space, stageIndex) => {
    const groups = new Map<number, typeof space.scenes>();
    space.scenes.forEach(scene => groups.set(scene.phase, [...(groups.get(scene.phase) ?? []), scene]));
    return [...groups.values()].map(scenes => {
      const last = scenes.at(-1)!, byId = indexHierarchyNodesByIdAndAliases(last.nodes);
      const items = frames[stageIndex].items.map(item => resolveDisplayedTrajectoryAttachments(item,
        id => byId.get(id)?.data, { stageIndex, playedRelationIndices: last.playedRelations }));
      return { stageIndex, scenes, items,
        nodes: last.nodes, obstacles: scenes.flatMap(scene => scene.obstacles),
        movedNodeIds: new Set(scenes.flatMap(scene => [...scene.movedNodeIds])) };
    });
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
      atStep(phase.scenes[0].nodes, phase.scenes[0].stepIndices[0]), phase.items)
      .forEach(id => phase.movedNodeIds.add(id));
  });
  const phaseRequests = phases.map(phase => prepareStagePlaqueRequests(phase.items, phase.nodes, input.measurePlaqueText));
  // Scene nodes and requests stay fixed while the schedule allocates.
  const requestIndexes: Map<number, Request>[] = [];
  const requestsByIndex = (phaseIndex: number) => requestIndexes[phaseIndex] ??= phaseRequests[phaseIndex].reduce(
    (byIndex, request) => byIndex.has(request.index) ? byIndex : byIndex.set(request.index, request), new Map<number, Request>());
  const nodeIndexes = new WeakMap<object, Map<string, d3.HierarchyPointNode<SyntaxNode>>>();
  const sceneNodes = (scene: { nodes: d3.HierarchyPointNode<SyntaxNode>[] }) => {
    let byId = nodeIndexes.get(scene.nodes);
    if (!byId) nodeIndexes.set(scene.nodes, byId = indexHierarchyNodesByIdAndAliases(scene.nodes));
    return byId;
  };
  const sizes = new Map<string, { width: number; height: number; collectionWidth: number }>();
  phases.forEach((phase, i) => phaseRequests[i].forEach(request => {
    const key = plaqueIdentity(phase.items[request.index]), prior = sizes.get(key);
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
  /** The phase opens on an authored movement that carries the anchor to a new
   * position: inside the moved phrase or the complex head it forms. Reflow, merges
   * and other phrases' movement do not relocate it. */
  const movedAnchors = new Map<number, (id: string) => boolean>();
  const anchorMoved = (phaseIndex: number, id: string) => {
    let moved = movedAnchors.get(phaseIndex);
    if (!moved) {
      const phase = phases[phaseIndex], scene = phase.scenes[0], previous = phases[phaseIndex - 1]?.scenes.at(-1);
      const played = input.steps[scene.stepIndices[0]]?.replayRelationIdentity;
      const landings = new Set(played && previous ? frames[phase.stageIndex].items.flatMap(item => item.kind === 'trajectory'
        && item.relationRef.stageIndex === played.stageIndex && item.relationRef.relationIndex === played.relationIndex
        ? [item.targetNodeId, ...item.headLandingSite ? [item.headLandingSite.nodeId] : []] : []) : []);
      const byId = landings.size ? indexHierarchyNodesByIdAndAliases(scene.nodes) : new Map();
      const before = landings.size ? indexHierarchyNodesByIdAndAliases(previous!.nodes) : new Map();
      moved = id => {
        const node = byId.get(id), old = before.get(id);
        return Boolean(node && old && Math.hypot(node.x - old.x, node.y - old.y) > 1e-8
          && node.ancestors().some(ancestor => landings.has(String((ancestor as any).__vizId ?? ancestor.data.id))));
      };
      movedAnchors.set(phaseIndex, moved);
    }
    return moved(id);
  };
  type Request = typeof phaseRequests[number][number];
  /** A pocket chosen in this phase stays clear until `end`, where the participants'
   * relative geometry changes. `movement` is the first earlier phase whose authored
   * movement carries the anchor. */
  const extents = new Map<string, { end: number; movement?: number }>();
  const lifetimeExtent = (phaseIndex: number, request: Request) => {
    const key = plaqueIdentity(phases[phaseIndex].items[request.index]), memo = `${phaseIndex}:${key}`;
    let extent = extents.get(memo);
    if (extent) return extent;
    const participants = participantIds(request, phaseIndex);
    let end = phaseIndex + 1, movement: number | undefined;
    for (; end < phases.length; end++) {
      const next = phaseRequests[end].find(candidate => plaqueIdentity(phases[end].items[candidate.index]) === key);
      if (!next) continue;
      participantIds(next, end).forEach(id => participants.add(id));
      if (geometryBoundary(end, next, participants)) break;
      if (movement === undefined && anchorMoved(end, next.ids[0])) movement = end;
    }
    extents.set(memo, extent = { end, movement });
    return extent;
  };
  // Case arrows and collectors join their plaques to syntax; other plaques show
  // their owner only by proximity.
  const proximityOnly = (request: Request) => !request.caseAssignment && !request.collectionRows?.length;
  const anchorDistance = (anchor: d3.HierarchyPointNode<SyntaxNode>, box: PlaqueRect) => {
    const point = plaqueAnchorPoint(anchor);
    return Math.hypot(box.x + box.width / 2 - point.x, box.y + box.height / 2 - point.y);
  };
  const reachOf = (box: PlaqueRect, request: Request) => ({ width: box.width, height: box.height, thetaGrid: request.thetaGrid });
  const remote = (anchor: d3.HierarchyPointNode<SyntaxNode>, box: PlaqueRect, request: Request) =>
    beyondNearbyReach(anchorDistance(anchor, box), reachOf(box, request));
  /** Every scene of these phases that shows the plaque `key`, carried to `anchor`,
   * with the other pockets `othersAt` places in that phase and their connectors. */
  const pocketScenes = (key: string, anchor: d3.HierarchyPointNode<SyntaxNode>, phaseIndices: readonly number[],
    othersAt: (phaseIndex: number) => ReadonlyMap<number, PlaquePlacement>): LifetimeScene[] => {
    const anchorId = String((anchor as any).__vizId ?? anchor.data.id);
    return phaseIndices.flatMap(phaseIndex => {
      const space = phases[phaseIndex], items = space.items, requests = requestsByIndex(phaseIndex);
      const futureIndex = items.findIndex(item => plaqueIdentity(item) === key);
      const futureRequest = requests.get(futureIndex);
      if (!futureRequest) return [];
      // Every scene of the phase shows the same other pockets at its own anchors.
      const otherPlacements = new Map([...othersAt(phaseIndex)].flatMap(([index, placement]) => {
        const request = requests.get(index);
        return plaqueIdentity(items[index]) !== key && request ? [[index, projectPlaqueContent(placement, request)] as const] : [];
      }));
      const caseOwners = planItemRelationRefs(items[futureIndex]).map(ref => `${ref.stageIndex}:${ref.relationIndex}`);
      // Revealing syntax rarely moves the other pockets. An unchanged scene keeps
      // the previous scene's obstacle objects, so its lifetime can skip them.
      const blockingPlaques = new Map<number, PlaquePlacement>();
      let previousAdded: PlaqueRect[] | undefined;
      return space.scenes.flatMap(scene => {
        const byId = sceneNodes(scene);
        const futureAnchor = byId.get(anchorId);
        if (!futureAnchor) return [];
        const projected = projectPlaqueLayout(otherPlacements, id => byId.get(id) ?? null);
        const plaques = [...projected].map(([index, box]) => {
          const prior = blockingPlaques.get(index);
          if (prior && Object.is(prior.x, box.x) && Object.is(prior.y, box.y)) return prior;
          const blocking = { ...box, blocksConnectors: true };
          blockingPlaques.set(index, blocking);
          return blocking;
        });
        let added: PlaqueRect[] = [...plaques, ...plaqueCaseConnectorObstacles(items, scene.nodes, projected, curveRects, caseSources),
          ...plaqueCollectionConnectorObstacles(scene.nodes, projected, curveRects)];
        if (previousAdded?.length === added.length && previousAdded.every((box, i) => box === added[i])) added = previousAdded;
        previousAdded = added;
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
        return [{ nodes: scene.nodes, obstacles: scene.obstacles, anchor: futureAnchor, request: futureRequest,
          dx: anchor.x - futureAnchor.x, dy: anchor.y - futureAnchor.y, caseVisible: rowVisible(caseOwners), rowVisible, added }];
      });
    });
  };
  const remembered = new Map<string, PlaquePlacement>();
  const collectionReservations: Map<number, PlaquePlacement>[] = [];
  // Claims placed one anchor position at a time: from the phase where their one
  // lifetime pocket would be remote, each lifetime ends at the anchor's next movement.
  const relocatedKeys = new Set<string>();
  type AllocationMode = 'collections' | 'ordinary';
  const allocate = (phaseIndex: number, mode: AllocationMode) => {
    const phase = phases[phaseIndex], frame = { ...frames[phase.stageIndex], items: phase.items };
    const { nodes, obstacles } = phase;
    const collectionsOnly = mode === 'collections';
    const keyOf = (index: number) => plaqueIdentity(frame.items[index]);
    if (mode === 'ordinary') collectionReservations[phaseIndex]?.forEach((box, index) => {
      const key = plaqueIdentity(frame.items[index]);
      const request = phaseRequests[phaseIndex].find(request => request.index === index)!;
      // A reservation seeds new lifetimes; an accepted pocket owns continuity.
      if (!remembered.has(key) || geometryBoundary(phaseIndex, request, participantIds(request, phaseIndex))) {
        remembered.set(key, box);
      }
    });
    // An old pocket blocked by current syntax or a fixed collection must move.
    // Remove it before allocating neighbours so its abandoned position cannot
    // force them into remote pockets. Accepted pockets still own continuity.
    if (!collectionsOnly) phaseRequests[phaseIndex].forEach(request => {
      if (collectionReservations[phaseIndex]?.has(request.index)) return;
      const key = plaqueIdentity(frame.items[request.index]), prior = remembered.get(key);
      if (!prior) return;
      const invalid = phase.scenes.some(scene => {
        const byId = indexHierarchyNodesByIdAndAliases(scene.nodes);
        const pocket = projectPlaqueLayout(new Map([[request.index, projectPlaqueContent(prior, request)]]), id => byId.get(id)).get(request.index);
        if (!pocket) return false;
        const collections = projectPlaqueLayout(collectionReservations[phaseIndex] ?? new Map(), id => byId.get(id));
        return [...scene.obstacles, ...collections.values()].some(obstacle => plaquesOverlap(pocket, obstacle));
      });
      if (invalid) remembered.delete(key);
    });
    // A relocated plaque starts a new lifetime when an authored movement carries its
    // anchor; its old pocket becomes its incumbent. That pocket stays reserved like any
    // other until the plaque itself is placed, so whichever plaque is allocated first
    // cannot take it before its owner decides whether to leave it.
    const relocating = new Set(phaseRequests[phaseIndex].filter(request => relocatedKeys.has(keyOf(request.index))
      && anchorMoved(phaseIndex, request.ids[0])).map(request => request.index));
    const reconsider = new Set(phaseRequests[phaseIndex].filter(request =>
      (collectionsOnly || !collectionReservations[phaseIndex]?.has(request.index))
      && (geometryBoundary(phaseIndex, request, participantIds(request, phaseIndex)) || relocating.has(request.index)))
      .map(request => request.index));
    const lifetimeSpace = (index: number, anchor: d3.HierarchyPointNode<SyntaxNode>, allocated: Map<number, PlaquePlacement>,
      untilMovement: boolean) => {
      const key = keyOf(index);
      const known = new Map(remembered);
      allocated.forEach((placement, itemIndex) => known.set(keyOf(itemIndex), placement));
      const extent = lifetimeExtent(phaseIndex, phaseRequests[phaseIndex].find(request => request.index === index)!);
      const end = untilMovement ? extent.movement ?? extent.end : extent.end;
      return lifetimeSpaceOf(pocketScenes(key, anchor, Array.from({ length: end - phaseIndex }, (_, offset) => phaseIndex + offset),
        future => new Map(phases[future].items.flatMap((item, index) => {
          const otherKey = plaqueIdentity(item), reserved = collectionReservations[future]?.get(index);
          const placement = future === phaseIndex ? known.get(otherKey) ?? reserved : reserved ?? known.get(otherKey);
          return placement ? [[index, placement] as const] : [];
        }))));
    };
    const layout = placeStagePlaques(phase.items, nodes, obstacles, remembered, input.measurePlaqueText, {
      sizes, collectionsOnly, reconsider, relocating, caseSources,
      spaceFor: (index, anchor, allocated) => lifetimeSpace(index, anchor, allocated, relocatedKeys.has(keyOf(index))),
      relocate: (index, anchor, allocated, box) => {
        const request = phaseRequests[phaseIndex].find(request => request.index === index)!;
        if (relocatedKeys.has(keyOf(index)) || !proximityOnly(request)
          || lifetimeExtent(phaseIndex, request).movement === undefined || !remote(anchor, box, request)) return undefined;
        relocatedKeys.add(keyOf(index));
        return lifetimeSpace(index, anchor, allocated, true);
      } });
    layout.forEach((placement, index) => remembered.set(keyOf(index), placement));
    return layout;
  };
  // D6 collection curves have fixed endpoints and control lanes. Reserve them
  // first so an earlier, freely placed grid cannot force a later detour.
  phases.forEach((_, phaseIndex) => { collectionReservations[phaseIndex] = allocate(phaseIndex, 'collections'); });
  remembered.clear();
  const schedule: ReplayPlaqueSchedule = { stages: [], steps: new Map() };
  const layouts: Map<number, PlaquePlacement>[] = [];
  /** One plaque's consecutive phases at one anchor-relative pocket. */
  type Run = { key: string; phases: number[]; indices: number[]; remote: boolean };
  const openRuns = new Map<string, Run>();
  const placementAt = (run: Run, position: number) => layouts[run.phases[position]].get(run.indices[position])!;
  const samePocket = (a: PlaquePlacement, b: PlaquePlacement) => a.attachmentNodeId === b.attachmentNodeId
    && a.width === b.width && a.height === b.height
    && Math.abs(a.x - a.attachmentX - (b.x - b.attachmentX)) < 1e-6 && Math.abs(a.y - a.attachmentY - (b.y - b.attachmentY)) < 1e-6;
  const previousRuns = new Map<string, Run>();
  /** How far a plaque moves from `before`, at the end of one phase, to `after` in the next. */
  const shift = (before: PlaquePlacement, after: PlaquePlacement, phaseIndex: number) => {
    const node = sceneNodes(phases[phaseIndex]).get(before.attachmentNodeId);
    return node ? Math.hypot(before.x - before.attachmentX + node.x - after.x, before.y - before.attachmentY + node.y - after.y) : 0;
  };
  /** Move a remote run to the nearest pocket that, in every scene of the run, keeps
   * DETACHED_PLAQUE_GAP from syntax and connectors and the full gap from trajectories
   * and every other plaque's allocated pocket, when that pocket is nearby and a quarter nearer. */
  const bringNear = (run: Run) => {
    const first = run.phases[0], placement = placementAt(run, 0);
    const anchor = sceneNodes(phases[first]).get(placement.attachmentNodeId), request = requestsByIndex(first).get(run.indices[0]);
    if (!anchor || !request) return;
    const space = lifetimeSpaceOf(pocketScenes(run.key, anchor, run.phases, phaseIndex => layouts[phaseIndex]));
    const near = placeStagePlaques(phases[first].items, phases[first].nodes, phases[first].obstacles, new Map(), input.measurePlaqueText, {
      sizes, includes: index => index === run.indices[0], syntaxGap: DETACHED_PLAQUE_GAP, spaceFor: () => space, caseSources }).get(run.indices[0]);
    if (near?.location !== 'local') return;
    const fresh = anchorDistance(anchor, near);
    if (fresh > MIN_RELOCATION_GAIN * anchorDistance(anchor, placement) || beyondNearbyReach(fresh, reachOf(placement, request))) return;
    const moved = (position: number): PlaquePlacement => {
      const own = placementAt(run, position);
      return { ...own, x: own.attachmentX + near.x - near.attachmentX, y: own.attachmentY + near.y - near.attachmentY, location: 'local' };
    };
    // Where the plaque already changes pocket, the new pocket must not lengthen that change.
    const before = previousRuns.get(run.key), last = run.phases.length - 1;
    if (before && before.phases.at(-1) === first - 1
      && shift(placementAt(before, before.phases.length - 1), moved(0), first) > shift(placementAt(before, before.phases.length - 1), placement, first) + 1e-6) return;
    const after = openRuns.get(run.key);
    if (after && after !== run && after.phases[0] === run.phases[last] + 1
      && shift(moved(last), placementAt(after, 0), after.phases[0]) > shift(placementAt(run, last), placementAt(after, 0), after.phases[0]) + 1e-6) return;
    run.phases.forEach((phaseIndex, position) => layouts[phaseIndex].set(run.indices[position], moved(position)));
  };
  const close = (runs: Run[]) => runs.sort((a, b) => a.phases[0] - b.phases[0] || a.indices[0] - b.indices[0]).forEach(run => {
    if (run.remote) bringNear(run);
    previousRuns.set(run.key, run);
  });
  let released = 0;
  /** Enter allocated phases into the schedule once no undecided remote run can still
   * change them, and publish each completed stage. */
  const release = (allocated: number) => {
    const pending = Math.min(allocated, ...[...openRuns.values()].filter(run => run.remote).map(run => run.phases[0] - 1));
    for (; released <= pending; released++) {
      const phase = phases[released], layout = layouts[released];
      schedule.stages[phase.stageIndex] = layout;
      phase.scenes.forEach(scene => scene.stepIndices.forEach(index => schedule.steps.set(index, layout)));
      if (phases[released + 1]?.stageIndex !== phase.stageIndex) stageReady?.(schedule, phase.stageIndex);
    }
  };
  phases.forEach((phase, phaseIndex) => {
    const layout = layouts[phaseIndex] = allocate(phaseIndex, 'ordinary');
    const closed: Run[] = [], present = new Set<string>();
    layout.forEach((placement, index) => {
      const key = plaqueIdentity(phase.items[index]), run = openRuns.get(key);
      // Two claims drawn as one identity have no single pocket to move.
      if (present.has(key)) { if (run) run.remote = false; return; }
      present.add(key);
      if (run && run.phases.at(-1) === phaseIndex - 1 && samePocket(placementAt(run, run.phases.length - 1), placement)) {
        run.phases.push(phaseIndex); run.indices.push(index);
        return;
      }
      const request = requestsByIndex(phaseIndex).get(index), anchor = sceneNodes(phase).get(placement.attachmentNodeId);
      if (run) closed.push(run);
      openRuns.set(key, { key, phases: [phaseIndex], indices: [index],
        remote: Boolean(request && anchor && proximityOnly(request) && remote(anchor, placement, request)) });
    });
    openRuns.forEach((run, key) => { if (!present.has(key)) { closed.push(run); openRuns.delete(key); } });
    close(closed);
    release(phaseIndex);
  });
  const remaining = [...openRuns.values()];
  openRuns.clear();
  close(remaining);
  release(phases.length - 1);
  return schedule;
}

/** Completed-stage layouts for callers without an active Replay moment. */
export function buildReplayPlaqueLayouts(input: StageLayoutInput): Map<number, PlaquePlacement>[] {
  return buildReplayPlaqueSchedule(input).stages;
}

export function buildStagePlaqueLayout(input: StageLayoutInput): Map<number, PlaquePlacement> {
  return buildReplayPlaqueLayouts(input)[input.stageIndex] ?? new Map();
}

/** Every label variant a scene paints. Equal forests can share a scene while later
 * relation moments add indices; prepared labels are keyed by canvas identity, so
 * retain every canvas's map. */
function sceneLabelRuns({ steps, completedCanvas, treeLabelRuns }: Pick<StageLayoutInput, 'steps' | 'completedCanvas' | 'treeLabelRuns'>,
  stepIndices: readonly number[]) {
  const labels = new Map<string, TreeLabelRuns[]>();
  if (!treeLabelRuns) return labels;
  const canvases = new Set<SyntaxNode>(stepIndices.map(index => steps[index].replayCanvasData ?? completedCanvas));
  if (!canvases.size) canvases.add(completedCanvas);
  for (const canvas of canvases) for (const [id, variants] of treeLabelRuns.get(canvas) ?? []) {
    labels.set(id, [...(labels.get(id) ?? []), ...variants]);
  }
  return labels;
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
  const authoredItems = input.plan?.frames[input.stageIndex]?.items ?? [];
  const measured = (scenes.length ? scenes : [{ currentTree: completedTree, visibleIds: null, playedRelations: null,
    phase: 0, stepIndices: [], movedNodeIds: new Set<string>() }]).map(scene => {
    const timing = { phase: scene.phase, stepIndices: scene.stepIndices, movedNodeIds: scene.movedNodeIds };
    const currentNodes = visibleNodes(scene.currentTree, scene.visibleIds);
    const byId = indexHierarchyNodesByIdAndAliases(currentNodes);
    const items = authoredItems.map(item => resolveDisplayedTrajectoryAttachments(item,
      id => byId.get(id)?.data, { stageIndex: input.stageIndex, playedRelationIndices: scene.playedRelations }));
    const labels = input.treeLabelRuns && items.some(item => item.kind === 'undirected-link'
      && ['predication', 'feature-sharing'].includes(item.linkStyle)
      || item.kind === 'directed-path' && ['dependent-case', 'case-assignment'].includes(item.pathStyle))
      ? sceneLabelRuns(input, scene.stepIndices) : new Map<string, TreeLabelRuns[]>();
    const obstacles: PlaqueRect[] = [...plaqueTreeObstacles(currentNodes, input.measureCategoryText), ...plaqueConnectorObstacles(items, currentNodes),
      ...predicationPlaqueObstacles(items, currentNodes, {
        measureCategoryText: input.measureCategoryText, measureTreeInk: input.measureTreeInk,
        labels,
        measureTreeLabel: input.measureTreeLabel
      }),
      ...nativePlaqueObstacles(items, currentNodes, {
        measureCategoryText: input.measureCategoryText, measureTreeInk: input.measureTreeInk,
        labels, measureTreeLabel: input.measureTreeLabel, measurePlaqueText: input.measurePlaqueText
      })];
    // Use the trajectory binder's actual geometry in each frame's coordinates.
    if (!input.plan) return { nodes: currentNodes, obstacles, labels, playedRelations: scene.playedRelations, ...timing };
    const trajectories = items.filter(item => item.kind === 'trajectory');
    if (!trajectories.length) return { nodes: currentNodes, obstacles, labels, playedRelations: scene.playedRelations, ...timing };
    const plan = { ...input.plan, frames: input.plan.frames.map((frame, index) =>
      index === input.stageIndex ? { ...frame, items: trajectories } : frame) };
    const bound = bindRelationPlanFrame(plan, input.stageIndex, stagePositionProvider(byId), {
      trajectoryCeilingY: (d3.min([...byId.values()], node => node.y) ?? 0) - TRAJECTORY_ROUTES.ceilingAboveTopNode,
      trajectoryFloorY: (d3.max([...byId.values()], node => node.y) ?? 0) + RELATION_LANES_BELOW_DEEPEST_NODE.trajectoryFloor
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
        width: Math.abs(point.x - points[i].x) + 10, height: Math.abs(point.y - points[i].y) + 10, trajectory: true
      }));
    }
    return { nodes: currentNodes, obstacles, labels, playedRelations: scene.playedRelations, ...timing };
  });
  return { nodes, obstacles: measured.flatMap(scene => scene.obstacles), scenes: measured };
}

/** Layout reads no window size. Every canvas lays out at this reference canvas,
 * so an analysis draws the same tree in every window and on every device; only
 * the camera fits the actual canvas. */
export const LAYOUT_REFERENCE_CANVAS = { width: 1600, height: 948 } as const;

export function treeLayoutSize(nodeCount: number, depth: number) {
  return [Math.max(LAYOUT_REFERENCE_CANVAS.width * 1.5, nodeCount * 180) - 600,
    Math.max(LAYOUT_REFERENCE_CANVAS.height, (depth + 2) * TREE_ROW_HEIGHT) - 520] as [number, number];
}

/** Compatible continuations retain the original stage's dimensions; new content still expands fit bounds.
 * The viewport arguments do not select layout (see LAYOUT_REFERENCE_CANVAS); they remain because
 * the corpus harness passes them to this checkout and to older baselines alike. */
export function stageTreeLayoutSize(steps: PlaybackStep[], stageIndex: number, _viewportWidth: number, _viewportHeight: number,
  layoutGroups?: StageLayoutInput['layoutGroups']) {
  const layoutStageIndex = layoutGroups?.find(group => group.includes(stageIndex))?.[0] ?? stageIndex;
  let extents = stageTreeExtents.get(steps);
  if (!extents) stageTreeExtents.set(steps, extents = new Map());
  let extent = extents.get(layoutStageIndex);
  if (extent === undefined) extents.set(layoutStageIndex, extent = stageTreeExtent(steps, layoutStageIndex));
  return extent && treeLayoutSize(extent.nodeCount, extent.depth);
}

/** Prepared steps and their canvases are immutable, and each per-stage plan asks
 * for the size of every stage. Each call still returns its own size tuple. */
const stageTreeExtents = new WeakMap<readonly PlaybackStep[], Map<number, { nodeCount: number; depth: number } | null>>();
function stageTreeExtent(steps: readonly PlaybackStep[], layoutStageIndex: number) {
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
  return nodeCount ? { nodeCount, depth } : null;
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

/** Families whose accepted composition fits the tree first: their stage camera
 * omits relation overlays and contains their plaques separately. */
export const TREE_FIRST_FAMILIES: ReadonlySet<string> = new Set(['copy.multiple-pronunciation', 'copy.partial-deletion',
  'multidominance.shared-node', 'argument-sharing.domains', 'pf.phrasal-spellout', 'pf.correspondence', 'pf.fission',
  'pf.impoverishment', 'pf.local-dislocation', 'pf.cyclic-linearization', 'cooper-storage.ledger', 'scope.operator-variable',
  'accord.link', 'accord.strong-npi', 'focus.prominence', 'focus.f-projection', 'theta.grid']);

export const isTreeFirstComposition = (items: readonly { familyId?: string }[]) =>
  items.some(item => TREE_FIRST_FAMILIES.has(item.familyId ?? ''));

/** Every measure the painter reads must reach the camera. The keys are required,
 * so a caller cannot fit a camera from estimates the painter does not draw. */
type StageCameraMeasures = { [Key in 'measurePlaqueText' | 'measureCategoryText' | 'measureTreeInk' | 'treeLabelRuns' | 'measureTreeLabel']-?:
  StageLayoutInput[Key] | undefined };

export type StageCameraFitInput = Omit<StageCameraInput, 'includeOverlays' | 'includePlaques' | 'includeBindingDomains'
  | 'plaqueLayout' | 'completedCanvas' | keyof StageCameraMeasures> & StageCameraMeasures & {
  /** The active stage's renderable workspace; null for an empty workspace. */
  completedCanvas: SyntaxNode | null;
  plaqueSchedule: ReplayPlaqueSchedule;
};

export type StageCameraFit = { bounds: OverlayBounds | null; containment: OverlayBounds | null };

/** The stage camera Replay fits: its bounds, plus the plaque containment that
 * tree-first compositions and binding domains add. TreeVisualizer and the offline
 * camera audit both call this, so the audit checks the camera the app fits.
 * Normalization accepts an empty workspace before the final stage; it has no
 * syntax to frame, so it contributes no bounds and the ordinary fit applies. */
export function buildStageCameraFit({ completedCanvas, ...rest }: StageCameraFitInput): StageCameraFit {
  if (!completedCanvas) return { bounds: null, containment: null };
  const input = { ...rest, completedCanvas };
  const items = input.plan?.frames[input.stageIndex]?.items ?? [];
  const treeFirst = isTreeFirstComposition(items);
  const common = { ...input, plaqueLayout: selectReplayPlaqueLayout(input.plaqueSchedule, input.stageIndex) };
  const bounds = buildStageCameraBounds({ ...common, includeOverlays: !treeFirst });
  const containment = bounds && (treeFirst || items.some(item => item.kind === 'binding-domain'))
    ? buildStageCameraBounds({ ...common, includeOverlays: false, includePlaques: true, includeBindingDomains: true })
    : null;
  return { bounds, containment };
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
      minX: rect.x - PLAQUE_FIT_MARGIN, maxX: rect.x + rect.width + PLAQUE_FIT_MARGIN,
      minY: rect.y - PLAQUE_FIT_MARGIN, maxY: rect.y + rect.height + PLAQUE_FIT_MARGIN
    }));
    for (const node of fitNodes) {
      const label = categoryTextLayout(node.data.label || '', measureCategoryText);
      include({ minX: node.x, maxX: node.x, minY: node.y,
        maxY: node.y + (node.children?.length ? 0 : LEAF_INK_EXTENT_Y) });
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
      // Fixed native plaques: the measured footprint allocation reserves for them.
      nativePlaqueFootprints(plan.frames[stageIndex]?.items ?? [], fitNodes, { measureCategoryText, measureTreeInk,
        labels: sceneLabelRuns({ steps, completedCanvas, treeLabelRuns }, stepIndices), measureTreeLabel, measurePlaqueText }).forEach(rect => include({
        minX: rect.x - PLAQUE_FIT_MARGIN, maxX: rect.x + rect.width + PLAQUE_FIT_MARGIN,
        minY: rect.y - PLAQUE_FIT_MARGIN, maxY: rect.y + rect.height + PLAQUE_FIT_MARGIN
      }));
    }
    if (!includeOverlays || !plan) continue;
    const positionFor = stagePositionProvider(byId);
    const maxY = d3.max(fitNodes, node => node.y) ?? 0;
    // Bounds reserve all stage marks at nominal scale, never reading the live DOM or camera.
    const bound = bindRelationPlanFrame(plan, stageIndex, positionFor, {
      ...RELATION_BINDING_METRICS, markerScale: 1,
      trajectoryCeilingY: (d3.min(fitNodes, node => node.y) ?? 0) - TRAJECTORY_ROUTES.ceilingAboveTopNode,
      trajectoryFloorY: maxY + RELATION_LANES_BELOW_DEEPEST_NODE.trajectoryFloor,
      connectorBaselineY: maxY + RELATION_LANES_BELOW_DEEPEST_NODE.connectorBaseline,
      railBaseY: maxY + RELATION_LANES_BELOW_DEEPEST_NODE.railBase,
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
