import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { categoryTextLayout, type CategoryTextMeasure } from './categoryTextLayout.ts';
import { applyVizIds } from './displayIdentity.ts';
import { paintedShift, type PaintedNodes } from './cameraCarry.ts';
import { bindingEllipseBounds, sceneBindingDomainEllipse } from './relations/bindingDomainGeometry.ts';
import { bindRelationPlanFrame } from './relations/geometryBinding.ts';
import { boundOverlayBounds, type OverlayBounds } from './relations/geometryBounds.ts';
import { resolveUniqueDisplayTerminal } from './relations/trajectoryAttachment.ts';
import { type PlanPositionProvider } from './relations/boundGeometry.ts';
import { sampleCubic, sampleQuadratic } from './relations/markGeometry.ts';
import { controlPlaqueObstacles } from './relations/controlPlaqueSpace.ts';
import { predicationPlaqueObstacles } from './relations/predicationPlaqueSpace.ts';
import { nativePlaqueFootprints, nativePlaqueObstacles } from './relations/nativePlaqueSpace.ts';
import { prepareLifetimePlaqueSpaces, type LifetimeScene } from './relations/plaqueLifetimeSpace.ts';
import {
  caseAssignmentSource,
  claimIdentity,
  measuredCaseSourceRect,
  beyondNearbyReach,
  blocksCarriedPocket,
  DETACHED_PLAQUE_GAP,
  ellipseOutlineObstacles,
  nearbyPlaqueReach,
  MIN_RELOCATION_GAIN,
  plaqueAnchorPoint,
  placeStagePlaques,
  prepareCollectionPlaqueSpace,
  plaqueRouteObstacles,
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
  reflectPlaquePlacement,
  type CaseSourceRects,
  type PlaquePlacement,
  type PlaqueRect,
  type PlaqueSpace
} from './relations/plaquePlacement.ts';
import { foreseenPocketBlocker, newPocketBlocker, ownOccupant, ownRoutesChanged, returnsWithinReach, type AheadStep, type HeldPocket,
  type PocketOccupant } from './relations/pocketHold.ts';
import { prepareCasePlaqueRows, type PlaqueTextMeasure } from './relations/plaqueTextLayout.ts';
import { caseFeatureComposition, presentCaseRows } from './relations/featureComposition.ts';
import {
  isPlanItemRevealed,
  planItemDependencyNodeIds,
  planItemRelationRefs,
  resolveDisplayedTrajectoryAttachments,
  type RelationPlanItem,
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
import { buildStageCoordinateReservations, leftToRightReservations, rightToLeftAxis } from './stageCoordinates.ts';
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
 * relation's name or drawing tier. A receiving head may move as a new sibling.
 * Outside relation moments (`construction`), syntax attaches where the stage
 * reserved it, so there only a changed Case source, which moves the plaque's own
 * arrow, ends a lifetime: a bare head's arrow leaves its label, the head complex
 * it becomes sends it from its one word. */
function changedPlaqueAttachments(before: d3.HierarchyPointNode<SyntaxNode>[], after: d3.HierarchyPointNode<SyntaxNode>[],
  items: RelationRenderPlan['frames'][number]['items'], construction = false) {
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
  if (!construction) after.forEach(node => {
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
    const movedNodeIds = preceding
      ? changedPlaqueAttachments(preceding.tree.descendants().filter(node => !preceding!.visibleIds || preceding!.visibleIds.has(nodeId(node))),
        currentTree.descendants().filter(node => !visibleIds || visibleIds.has(nodeId(node))), plan?.frames[stageIndex]?.items ?? [],
        step.replayKind !== 'relation')
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
 * to; failing that, a clearly nearer pocket at the second look's narrower gap from
 * syntax for its whole lifetime; failing that, a nearby pocket until the first phase
 * that blocks every nearby pocket, where the syntax, marks and other pockets known
 * then leave it another. One carried beyond its nearby reach looks again in every
 * phase. Such a nearer pocket must not leave the phase's plaques farther beyond their
 * reach in all, Case and collector plaques included (`joinedReserve`). Plaques are
 * placed in one pass, so each avoids the pockets actually shown. A plaque without a
 * connector still remote afterwards gets one second look per run of phases at one
 * pocket (`bringNear`), which moves no other plaque. */
type PocketRecord = { occupants: () => PocketOccupant[]; owner: (index: number) => string; pocket: (index: number) => HeldPocket | undefined };
const pocketRecords = new WeakMap<ReplayPlaqueSchedule, ReadonlyMap<number, PocketRecord>>();
/** What the hold pass of a schedule built with `pocketOccupants` saw at one Replay
 * step: the step's pocket occupants (pocketHold.ts) with its final placements, the
 * plaque identity that owns each item's occupants, and each item's pocket. The
 * offline visual audit judges plaque moves with these. */
export function replayPocketOccupants(schedule: ReplayPlaqueSchedule, stepIndex: number) {
  return pocketRecords.get(schedule)?.get(stepIndex);
}

export function buildReplayPlaqueSchedule(input: StageLayoutInput, coordinates?: MeasuredStageCoordinates,
  stageReady?: (schedule: ReplayPlaqueSchedule, stageIndex: number) => void,
  { pocketOccupants = false }: { pocketOccupants?: boolean } = {}): ReplayPlaqueSchedule {
  if (input.direction === 'rtl') return reflectedPlaqueSchedule(input, coordinates, stageReady, pocketOccupants);
  const recorded = pocketOccupants ? new Map<number, PocketRecord>() : undefined;
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
  /** The largest size `item`'s plaque takes in its lifetime. Sizes are kept by the
   * identity allocation keeps lifetimes by (plaqueIdentity), which ends where a claim
   * moves to a lower occurrence; the hold pass keeps pockets by claimIdentity. */
  const allocatedSize = (item: RelationPlanItem) => sizes.get(plaqueIdentity(item));
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
  const reachOf = (box: Pick<PlaqueRect, 'width' | 'height'>, request: Request) => ({ width: box.width, height: box.height, thetaGrid: request.thetaGrid,
    realizedForm: request.realizedForm });
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
        return [{ nodes: scene.nodes, obstacles: scene.obstacles, anchor: futureAnchor, request: futureRequest, owner: key,
          dx: anchor.x - futureAnchor.x, dy: anchor.y - futureAnchor.y, caseVisible: rowVisible(caseOwners), rowVisible, added }];
      });
    });
  };
  const remembered = new Map<string, PlaquePlacement>();
  const collectionReservations: Map<number, PlaquePlacement>[] = [];
  // Claims placed one anchor position at a time: from the phase where their one
  // lifetime pocket would be remote, each lifetime ends at the anchor's next movement.
  const relocatedKeys = new Set<string>();
  /** A proximity plaque whose every nearby pocket is blocked somewhere in its
   * lifetime keeps a nearby pocket until the first phase that blocks them all
   * (`end`), and there chooses again. `from` is the phase that chose the pocket. */
  const nearbyEnds = new Map<string, { from: number; end: number }>();
  type AllocationMode = 'collections' | 'ordinary';
  const sameOffset = (a: PlaquePlacement, b: PlaquePlacement) => a.attachmentNodeId === b.attachmentNodeId
    && Math.abs(a.x - a.attachmentX - (b.x - b.attachmentX)) < 1e-6 && Math.abs(a.y - a.attachmentY - (b.y - b.attachmentY)) < 1e-6;
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
        return [...scene.obstacles, ...collections.values()].some(obstacle => !obstacle.enclosedPlaques?.has(key)
          && plaquesOverlap(pocket, obstacle));
      });
      if (invalid) remembered.delete(key);
    });
    /** The phases from this one where a pocket chosen here must stay clear. */
    const lifetimeEnd = (index: number, untilMovement: boolean) => {
      const extent = lifetimeExtent(phaseIndex, phaseRequests[phaseIndex].find(request => request.index === index)!);
      const nearby = nearbyEnds.get(keyOf(index));
      return Math.min(untilMovement ? extent.movement ?? extent.end : extent.end, nearby && nearby.end > phaseIndex ? nearby.end : Infinity);
    };
    // Plaques a Case arrow or collector joins to syntax choose after proximity plaques,
    // so a proximity plaque leaving its one lifetime pocket for a nearer one can take
    // the pocket such a plaque holds when it stays (`joinedReserve`: those pockets,
    // chosen in this phase without the proximity plaques' new pockets). When the
    // phase's plaques then stand farther beyond their nearby reach in all than before
    // those moves, the phase is allocated again with the joined pockets reserved while
    // proximity plaques look, and keeps whichever allocation leaves less beyond reach.
    let reserving = false;
    let joinedPockets: Map<string, PlaquePlacement> | undefined;
    const joinedReserve = () => joinedPockets ??= (() => {
      const joined = new Set(phaseRequests[phaseIndex].filter(request => !proximityOnly(request)
        && !collectionReservations[phaseIndex]?.has(request.index)).map(request => request.index));
      if (collectionsOnly || !joined.size) return new Map<string, PlaquePlacement>();
      const reconsidered = new Set([...joined].filter(index => {
        const request = requestsByIndex(phaseIndex).get(index)!;
        return geometryBoundary(phaseIndex, request, participantIds(request, phaseIndex));
      }));
      const layout = placeStagePlaques(phase.items, nodes, obstacles, remembered, input.measurePlaqueText, {
        sizes, reconsider: reconsidered, caseSources, includes: index => joined.has(index),
        spaceFor: (index, anchor, allocated) => lifetimeSpace(index, anchor, allocated, relocatedKeys.has(keyOf(index))) });
      return new Map([...layout].map(([index, placement]) => [keyOf(index), placement] as const));
    })();
    const lifetimeSpace = (index: number, anchor: d3.HierarchyPointNode<SyntaxNode>, allocated: Map<number, PlaquePlacement>,
      untilMovement: boolean, end = lifetimeEnd(index, untilMovement), start = phaseIndex, reserveJoined = false) => {
      const key = keyOf(index);
      const known = new Map(remembered);
      if (reserveJoined && reserving) joinedReserve().forEach((placement, joinedKey) => known.set(joinedKey, placement));
      allocated.forEach((placement, itemIndex) => known.set(keyOf(itemIndex), placement));
      return lifetimeSpaceOf(pocketScenes(key, anchor, Array.from({ length: end - start }, (_, offset) => start + offset),
        future => new Map(phases[future].items.flatMap((item, index) => {
          const otherKey = plaqueIdentity(item), reserved = collectionReservations[future]?.get(index);
          const placement = future === phaseIndex ? known.get(otherKey) ?? reserved : reserved ?? known.get(otherKey);
          return placement ? [[index, placement] as const] : [];
        }))));
    };
    /** The nearby pocket `space` holds for the claim at `index`, at `syntaxGap`, if any. */
    const nearbyIn = (index: number, anchor: d3.HierarchyPointNode<SyntaxNode>, request: Request, space: PlaqueSpace,
      syntaxGap?: number) => {
      const size = allocatedSize(phase.items[index]) ?? request, reach = nearbyPlaqueReach(reachOf(size, request));
      const near = placeStagePlaques(phase.items, nodes, obstacles, new Map(), input.measurePlaqueText, {
        sizes, includes: other => other === index, spaceFor: () => space, caseSources, syntaxGap, searchWithin: reach + 1e-6 }).get(index);
      return near?.location === 'local' && !remote(anchor, near, request) ? near : undefined;
    };
    // A proximity plaque carried beyond its nearby reach looks again in every phase
    // whose own syntax, marks and pockets leave it a nearby pocket, keeping its pocket
    // unless one is clear for its lifetime (the Replay step hold below moves it only
    // where the pocket-hold contract allows).
    const remoteCarried = (request: Request) => {
      const prior = !collectionsOnly && proximityOnly(request) && remembered.get(keyOf(request.index));
      const anchor = prior && sceneNodes(phase).get(prior.attachmentNodeId);
      return Boolean(anchor && remote(anchor, projectPlaqueLayout(new Map([[0, prior]]), () => anchor).get(0)!, request)
        && nearbyIn(request.index, anchor, request, lifetimeSpace(request.index, anchor, new Map(),
          relocatedKeys.has(keyOf(request.index)), phaseIndex + 1, phaseIndex, true), DETACHED_PLAQUE_GAP));
    };
    /** How far beyond its nearby reach a pocket stands, as a fraction of that reach. */
    const excess = (anchor: d3.HierarchyPointNode<SyntaxNode>, box: PlaqueRect, request: Request) =>
      Math.max(0, anchorDistance(anchor, box) / nearbyPlaqueReach(reachOf(box, request)) - 1);
    /** Proximity plaques a pass gave a nearer pocket, with the excess of the pocket they left. */
    let left = new Map<number, number>();
    const pass = () => {
      left = new Map();
      // A relocated plaque starts a new lifetime when an authored movement carries its
      // anchor; its old pocket becomes its incumbent. That pocket stays reserved like any
      // other until the plaque itself is placed, so whichever plaque is allocated first
      // cannot take it before its owner decides whether to leave it. So does the remote
      // pocket of a plaque carried beyond reach that looks again.
      const carriedAgain = new Set<number>();
      const relocating = new Set(phaseRequests[phaseIndex].filter(request => relocatedKeys.has(keyOf(request.index))
        && anchorMoved(phaseIndex, request.ids[0]) || remoteCarried(request) && carriedAgain.add(request.index)).map(request => request.index));
      const reconsider = new Set(phaseRequests[phaseIndex].filter(request =>
        (collectionsOnly || !collectionReservations[phaseIndex]?.has(request.index))
        && (geometryBoundary(phaseIndex, request, participantIds(request, phaseIndex)) || relocating.has(request.index)))
        .map(request => request.index));
      const layout = placeStagePlaques(phase.items, nodes, obstacles, remembered, input.measurePlaqueText, {
        sizes, collectionsOnly, reconsider, relocating, caseSources,
        spaceFor: (index, anchor, allocated) => lifetimeSpace(index, anchor, allocated, relocatedKeys.has(keyOf(index)),
          undefined, phaseIndex, carriedAgain.has(index)),
        relocate: (index, anchor, allocated, box) => {
          const request = phaseRequests[phaseIndex].find(request => request.index === index)!, key = keyOf(index);
          if (!proximityOnly(request) || !remote(anchor, box, request)) return undefined;
          const relocated = relocatedKeys.has(key);
          let untilMovement = relocated, end = lifetimeEnd(index, untilMovement);
          if (!untilMovement && lifetimeExtent(phaseIndex, request).movement !== undefined) {
            relocatedKeys.add(key);
            untilMovement = true; end = lifetimeEnd(index, true);
            const space = lifetimeSpace(index, anchor, allocated, true, end, phaseIndex, true);
            if (nearbyIn(index, anchor, request, space)) { left.set(index, excess(anchor, box, request)); return { space }; }
          }
          let wholeSpace: PlaqueSpace | undefined, reservedSpace: PlaqueSpace | undefined;
          const whole = () => wholeSpace ??= lifetimeSpace(index, anchor, allocated, untilMovement, end);
          const reservedWhole = () => reservedSpace ??= lifetimeSpace(index, anchor, allocated, untilMovement, end, phaseIndex, true);
          const unchanged = () => untilMovement && !relocated ? { space: whole() } : undefined;
          // Each choice below needs a nearby pocket in this phase, at least at the
          // second look's narrower gap from syntax.
          const first = lifetimeSpace(index, anchor, allocated, untilMovement, phaseIndex + 1, phaseIndex, true);
          if (!nearbyIn(index, anchor, request, first, DETACHED_PLAQUE_GAP)) return unchanged();
          // A clearly nearer pocket at that gap, as the second look allows (bringNear),
          // serves the whole lifetime.
          const detached = nearbyIn(index, anchor, request, reservedWhole(), DETACHED_PLAQUE_GAP);
          if (detached && anchorDistance(anchor, detached) <= MIN_RELOCATION_GAIN * anchorDistance(anchor, box)) {
            left.set(index, excess(anchor, box, request));
            return { space: reservedWhole(), syntaxGap: DETACHED_PLAQUE_GAP };
          }
          // No nearby pocket serves the whole lifetime: the longest run of phases from
          // this one that some nearby pocket does serve ends where they are all blocked.
          // The plaque changes pocket there only where syntax and marks leave it a nearby
          // pocket, at most as near them as the second look allows; otherwise it keeps
          // the one pocket that serves its whole lifetime.
          if (phaseIndex + 1 >= end || !nearbyIn(index, anchor, request, first)) return unchanged();
          let served = { space: first, end: phaseIndex + 1 }, low = phaseIndex + 2, high = end - 1;
          while (low <= high) {
            const middle = (low + high) >> 1, space = lifetimeSpace(index, anchor, allocated, untilMovement, middle, phaseIndex, true);
            if (nearbyIn(index, anchor, request, space)) { served = { space, end: middle }; low = middle + 1; }
            else high = middle - 1;
          }
          // What the syntax, marks, fixed collections and the other plaques' pockets known now leave there.
          const after = lifetimeSpace(index, anchor, allocated, untilMovement, served.end + 1, served.end, true);
          if (!nearbyIn(index, anchor, request, after) && !nearbyIn(index, anchor, request, after, DETACHED_PLAQUE_GAP)) return unchanged();
          nearbyEnds.set(key, { from: phaseIndex, end: served.end });
          left.set(index, excess(anchor, box, request));
          return { space: served.space };
        } });
      carriedAgain.forEach(index => {
        const prior = remembered.get(keyOf(index)), anchor = prior && sceneNodes(phase).get(prior.attachmentNodeId);
        const request = requestsByIndex(phaseIndex).get(index);
        if (anchor && request && !left.has(index))
          left.set(index, excess(anchor, projectPlaqueLayout(new Map([[0, prior]]), () => anchor).get(0)!, request));
      });
      return layout;
    };
    const state = () => ({ relocated: new Set(relocatedKeys), nearby: new Map(nearbyEnds) });
    const restore = ({ relocated, nearby }: ReturnType<typeof state>) => {
      relocatedKeys.clear(); relocated.forEach(key => relocatedKeys.add(key));
      nearbyEnds.clear(); nearby.forEach((value, key) => nearbyEnds.set(key, value));
    };
    const initial = state();
    let layout = pass();
    /** The excess of the joined plaques and of the proximity plaques given nearer
     * pockets, summed: as `placements` stand, or, with `held`, before those moves. */
    const beyondReach = (placements: ReadonlyMap<number, PlaquePlacement>, moved: ReadonlyMap<number, number>, held = false) =>
      [...placements].reduce((sum, [index, placement]) => {
        const request = requestsByIndex(phaseIndex).get(index), anchor = sceneNodes(phase).get(placement.attachmentNodeId);
        if (!request || !anchor) return sum;
        if (moved.has(index)) return sum + (held ? moved.get(index)! : excess(anchor, placement, request));
        const before = !proximityOnly(request) && joinedReserve().get(keyOf(index));
        return before ? sum + excess(anchor, held ? before : placement, request) : sum;
      }, 0);
    if (!collectionsOnly && left.size && beyondReach(layout, left) > beyondReach(layout, left, true) + 1e-6) {
      const first = { layout, state: state() }, moved = new Map(left);
      restore(initial);
      reserving = true;
      const again = pass();
      left.forEach((value, index) => { if (!moved.has(index)) moved.set(index, value); });
      if (beyondReach(again, moved) < beyondReach(first.layout, moved) - 1e-6) layout = again;
      else restore(first.state);
    }
    layout.forEach((placement, index) => {
      const key = keyOf(index), prior = remembered.get(key), nearby = nearbyEnds.get(key);
      // A shortened lifetime belongs to its pocket.
      if (nearby && nearby.from < phaseIndex && !(prior && sameOffset(prior, placement))) nearbyEnds.delete(key);
      remembered.set(key, placement);
    });
    return layout;
  };
  // D6 collection curves have fixed endpoints and control lanes. Reserve them
  // first so an earlier, freely placed grid cannot force a later detour.
  phases.forEach((_, phaseIndex) => { collectionReservations[phaseIndex] = allocate(phaseIndex, 'collections'); });
  remembered.clear();
  nearbyEnds.clear();
  const schedule: ReplayPlaqueSchedule = { stages: [], steps: new Map() };
  if (recorded) pocketRecords.set(schedule, recorded);
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
      return { ...own, x: own.attachmentX + near.x - near.attachmentX, y: own.attachmentY + near.y - near.attachmentY, location: 'local',
        syntaxGap: DETACHED_PLAQUE_GAP };
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
  /** What the previous Replay step showed: each plaque's placement and, when needed,
   * which plaques it painted, by identity, and its pocket occupants (pocketHold.ts). */
  let shownBefore: { stageIndex: number; byId: Map<string, d3.HierarchyPointNode<SyntaxNode>>; painted: () => PaintedNodes;
    placements: Map<string, PlaquePlacement>; shown: () => Set<string>; occupants: () => PocketOccupant[] } | undefined;
  let playedStage = -1, played = new Set<number>();
  /** A pocket a plaque took early, where it was free to move, because a later step of
   * its stage takes the one it had (foreseenPocketBlocker): the stage it took it in, its
   * offset from the anchor, its distance from the anchor, and each step of the hold as a
   * lifetime scene, with the first step's own state for judging a nearer pocket. */
  type Hold = { key: string; stage: number; offset: string; distance: number; scenes: LifetimeScene[];
    start: { phaseIndex: number; scene: Scene; stepIndex: number; index: number; occupants: readonly PocketOccupant[];
      rowVisible: RowVisible; revealed: number[] } };
  /** The pass being entered (release): the holds still open (`openHolds`), by claimIdentity; the holds
   * that ended with the plaque still in the pocket it took (`ended`); the holds the plaque
   * left beside a still anchor (`jumped`, as barKey); each plaque's moves beside a still
   * anchor, counted and summed (`moves`); and the early pockets the pass may not take
   * (`barred`, as barKey), because an earlier pass over the same span showed they break
   * the trade Francis accepted (27 October 2026): a farther pocket instead of a jump. */
  let openHolds = new Map<string, Hold>(), ended: Hold[] = [], jumped = new Set<string>(), barred = new Set<string>();
  let moves = new Map<string, { count: number; distance: number }>();
  /** The nearer pocket an earlier pass over the span found clear through a whole hold, by
   * barKey, with the step the hold began at: the plaque takes it there instead. */
  let preferred = new Map<string, { stepIndex: number; placement: PlaquePlacement }>();
  const barKey = (key: string, stageIndex: number) => `${stageIndex}\u0000${key}`;
  /** Whether `key` may not take a pocket early in `stageIndex`; -1 bars every stage. */
  const isBarred = (key: string, stageIndex: number) => barred.has(barKey(key, stageIndex)) || barred.has(barKey(key, -1));
  const offsetOf = (placement: PlaquePlacement) => `${Math.round(placement.x - placement.attachmentX)},${Math.round(placement.y - placement.attachmentY)}`;
  /** The offline audit's least plaque shift that counts as a move (visualRules, motionUnits). */
  const MOVE_UNITS = 4;
  // A claim keeps its pocket across the movement that transfers it to a lower occurrence.
  const identityOf = claimIdentity;
  type Scene = (typeof phases)[number]['scenes'][number];
  type RowVisible = (owners: string[] | undefined) => boolean;
  /** Whether a row owned by these relations shows at a moment of `stageIndex` that has played `playedNow`. */
  const rowVisibleAt = (stageIndex: number, playedNow: ReadonlySet<number>): RowVisible => owners => !owners || owners.some(key => {
    const [stage, relation] = key.split(':').map(Number);
    return stage < stageIndex || stage === stageIndex && playedNow.has(relation);
  });
  const collectionSpaces = new WeakMap<object, ReturnType<typeof prepareCollectionPlaqueSpace>>();
  /** `placement` of the Case plaque `index` once its stage has played `played`: when
   * rows leave it, its shell, Case row and collector rows fit the rows that remain, in
   * its pocket, as the painter draws them (caseFeatureDrawing.ts); allocation still
   * reserves the stage's largest shell. Any other plaque's placement is unchanged. */
  const presentShell = (phaseIndex: number, index: number, placement: PlaquePlacement, played: ReadonlySet<number>): PlaquePlacement => {
    const items = phases[phaseIndex].items, composition = requestsByIndex(phaseIndex).get(index)?.caseAssignment && caseFeatureComposition(items, index);
    if (!composition) return placement;
    const present = presentCaseRows(items, composition.rows, phases[phaseIndex].stageIndex, played);
    if (present.length === composition.rows.length) return placement;
    const drawn = prepareCasePlaqueRows(present), rowY = (owner: number | undefined) => {
      const row = owner === undefined ? -1 : present.findIndex(candidate => candidate.ownerIndices.includes(owner));
      return row < 0 ? undefined : drawn.rows[row].y;
    };
    const caseRowY = rowY(index);
    return { ...placement, drawnWidth: drawn.width, drawnHeight: drawn.height, ...caseRowY === undefined ? {} : { caseRowY },
      ...placement.collectionRows ? { collectionRows: placement.collectionRows.map(row => {
        const y = rowY(row.lane === undefined ? undefined : composition.collections[row.lane]?.index);
        return y === undefined ? row : { ...row, y };
      }) } : {} };
  };
  /** What one step paints, as allocation reserves it (pocketHold.ts, PocketOccupant):
   * its visible syntax and revealed marks, then the plaques of `layout` it shows with
   * their Case arrows and their collectors of shown rows. */
  const occupantsAt = (phaseIndex: number, scene: Scene, stepIndex: number, layout: ReadonlyMap<number, PlaquePlacement>,
    shown: ReadonlySet<number>, revealed: number[], rowVisible: RowVisible, played: ReadonlySet<number>): PocketOccupant[] => {
    const items = phases[phaseIndex].items, requests = requestsByIndex(phaseIndex);
    const { nodes, obstacles } = scene.paintedSpace(input.steps[stepIndex].replayVisibleNodeIds, revealed), byId = sceneNodes({ nodes });
    let collection = collectionSpaces.get(nodes);
    if (!collection) collectionSpaces.set(nodes, collection = prepareCollectionPlaqueSpace(nodes));
    const occupants: PocketOccupant[] = [...obstacles];
    for (const [index, placement] of layout) {
      const request = requests.get(index);
      if (!shown.has(index) || !request) continue;
      const box = projectPlaqueLayout(new Map([[index, presentShell(phaseIndex, index, projectPlaqueContent(placement, request), played)]]),
        id => byId.get(id) ?? null).get(index);
      if (!box) continue;
      const owner = identityOf(items[index]);
      occupants.push({ ...box, blocksConnectors: true, owner });
      const rows = box.collectionRows?.filter(row => rowVisible(row.ownerKeys));
      for (const piece of plaqueRouteObstacles(items[index], nodes, { ...box, collectionRows: rows }, collection, curveRects, caseSources))
        occupants.push({ ...piece, owner });
    }
    return occupants;
  };
  /** `candidate` attached at its own pocket where `space` accepts it, or undefined. */
  const attachAt = (phaseIndex: number, index: number, candidate: PlaquePlacement, nodes: d3.HierarchyPointNode<SyntaxNode>[],
    obstacles: PlaqueRect[], space: PlaqueSpace) => {
    const items = phases[phaseIndex].items;
    const kept = placeStagePlaques(items, nodes, obstacles, new Map([[plaqueIdentity(items[index]), candidate]]), input.measurePlaqueText,
      { sizes, includes: other => other === index, spaceFor: () => space, caseSources, syntaxGap: candidate.syntaxGap }).get(index);
    return kept && Math.abs(kept.x - candidate.x) < 1e-6 && Math.abs(kept.y - candidate.y) < 1e-6 ? kept : undefined;
  };
  const unblocked: PlaqueSpace = { obstacles: [], acceptsConnector: () => true };
  /** The pocket allocation chooses for the plaque `index` among everything this step
   * paints and the syntax, marks and scheduled plaques of the later steps `ahead`
   * (aheadOf, scheduledPlaquesAt), carried with its anchor, accepted where every
   * allocation rule accepts it now. */
  const clearThrough = (phaseIndex: number, scene: Scene, stepIndex: number, index: number, anchor: d3.HierarchyPointNode<SyntaxNode>,
    occupants: readonly PocketOccupant[], rowVisible: RowVisible, revealed: number[],
    ahead: readonly { phaseIndex: number; scene: Scene; stepIndex: number; revealed: number[]; played: ReadonlySet<number>;
      anchor: d3.HierarchyPointNode<SyntaxNode> }[], reach: number) => {
    const items = phases[phaseIndex].items, request = requestsByIndex(phaseIndex).get(index), key = identityOf(items[index]);
    const { nodes, obstacles } = scene.paintedSpace(input.steps[stepIndex].replayVisibleNodeIds, revealed);
    if (!request) return undefined;
    const caseOwners = planItemRelationRefs(items[index]).map(ref => `${ref.stageIndex}:${ref.relationIndex}`);
    const owner = plaqueIdentity(items[index]);
    const stageIndex = phases[phaseIndex].stageIndex, scenes: LifetimeScene[] = [{ nodes, obstacles, anchor, request, owner, dx: 0, dy: 0,
      caseVisible: rowVisible(caseOwners), rowVisible, added: occupants.slice(obstacles.length).filter(occupant => occupant.owner !== key) }];
    for (const later of ahead) {
      const laterRequest = requestsByIndex(later.phaseIndex).get(index);
      if (!laterRequest) return undefined;
      const painted = later.scene.paintedSpace(input.steps[later.stepIndex].replayVisibleNodeIds, later.revealed);
      const visible = rowVisibleAt(stageIndex, later.played);
      scenes.push({ nodes: painted.nodes, obstacles: painted.obstacles, anchor: later.anchor, request: laterRequest, owner,
        dx: anchor.x - later.anchor.x, dy: anchor.y - later.anchor.y, caseVisible: visible(caseOwners), rowVisible: visible,
        added: scheduledPlaquesAt(later).filter(occupant => occupant.owner !== key) });
    }
    const space = lifetimeSpaceOf(scenes);
    const found = placeStagePlaques(items, nodes, obstacles, new Map(), input.measurePlaqueText,
      { sizes, includes: other => other === index, spaceFor: () => space, caseSources, searchWithin: reach }).get(index);
    return found && found.location === 'local' ? clearAt(phaseIndex, scene, stepIndex, index, found, occupants, rowVisible, revealed) : undefined;
  };
  /** `candidate` where every allocation rule accepts it among everything the step
   * paints: for a plaque whose own Case arrow or collectors change at this step. */
  const clearAt = (phaseIndex: number, scene: Scene, stepIndex: number, index: number, candidate: PlaquePlacement,
    occupants: readonly PocketOccupant[], rowVisible: RowVisible, revealed: number[]) => {
    const items = phases[phaseIndex].items, request = requestsByIndex(phaseIndex).get(index), key = identityOf(items[index]);
    const { nodes, obstacles } = scene.paintedSpace(input.steps[stepIndex].replayVisibleNodeIds, revealed);
    const anchor = sceneNodes({ nodes }).get(candidate.attachmentNodeId);
    if (!request || !anchor) return undefined;
    const space = lifetimeSpaceOf([{ nodes, obstacles, anchor, request, owner: plaqueIdentity(items[index]), dx: 0, dy: 0,
      caseVisible: rowVisible(planItemRelationRefs(items[index]).map(ref => `${ref.stageIndex}:${ref.relationIndex}`)), rowVisible,
      added: occupants.slice(obstacles.length).filter(occupant => occupant.owner !== key) }]);
    return attachAt(phaseIndex, index, candidate, nodes, obstacles, space);
  };
  /** The plan items whose marks step `stepIndex` of this phase and scene draws, once it
   * has played `playedNow`: a mark draws where each of its nodes, or a descendant, is
   * visible (relationScene.ts). */
  const revealedAt = (phaseIndex: number, scene: Scene, stepIndex: number, playedNow: ReadonlySet<number>, active: number | null) => {
    const phase = phases[phaseIndex], byId = sceneNodes(scene), step = input.steps[stepIndex];
    const visibleIds = step.replayVisibleNodeIds && new Set(step.replayVisibleNodeIds);
    const drawable = (id: string) => byId.get(id)?.descendants().some(node => !visibleIds || visibleIds.has(String((node as any).__vizId ?? node.data.id)));
    return phase.items.flatMap((item, index) => isPlanItemRevealed(item, phase.stageIndex, playedNow, active)
      && planItemDependencyNodeIds(item).every(drawable) ? [index] : []);
  };
  /** Where each Replay step of a stage stands in the schedule, in step order. */
  const stageSteps = new Map<number, { stepIndex: number; phaseIndex: number; scene: Scene }[]>();
  phases.forEach((phase, phaseIndex) => phase.scenes.forEach(scene => scene.stepIndices.forEach(stepIndex => {
    if (!stageSteps.has(phase.stageIndex)) stageSteps.set(phase.stageIndex, []);
    stageSteps.get(phase.stageIndex)!.push({ stepIndex, phaseIndex, scene });
  })));
  stageSteps.forEach(list => list.sort((a, b) => a.stepIndex - b.stepIndex));
  /** The later steps of the stage of `stepIndex` while the plaque `index` stays shown
   * there with its anchor `anchorId` within a unit of `anchor`, each with what it
   * paints apart from plaques and the anchor's move since `old` (pocketHold.ts,
   * AheadStep). `played` holds the stage's relations played by `stepIndex`. */
  const aheadOf = (stageIndex: number, stepIndex: number, index: number, anchorId: string, anchor: { x: number; y: number },
    old: { x: number; y: number }, played: ReadonlySet<number>) => {
    type Ahead = AheadStep & { phaseIndex: number; scene: Scene; stepIndex: number; revealed: number[]; played: ReadonlySet<number>;
      anchor: d3.HierarchyPointNode<SyntaxNode> };
    const list = stageSteps.get(stageIndex) ?? [], ahead: Ahead[] = [];
    let playedNow: ReadonlySet<number> = played;
    for (const { stepIndex: later, phaseIndex, scene } of list) {
      if (later <= stepIndex) continue;
      const painted = paintedAt(later, phaseIndex, scene, playedNow);
      playedNow = painted.played;
      const node = sceneNodes(scene).get(anchorId);
      if (!node || Math.hypot(node.x - anchor.x, node.y - anchor.y) > 1 || layouts[phaseIndex].get(index)?.attachmentNodeId !== anchorId
        || !painted.revealed.includes(index)) break;
      ahead.push({ ...painted, move: { x: node.x - old.x, y: node.y - old.y }, phaseIndex, scene, stepIndex: later, anchor: node });
    }
    return ahead;
  };
  /** What step `stepIndex` reveals and paints apart from plaques, once its stage has
   * played `before` by the step before it; the same for every plaque that looks ahead. */
  const paintedSteps = new Map<number, { revealed: number[]; played: ReadonlySet<number>; occupants: readonly PocketOccupant[] }>();
  const paintedAt = (stepIndex: number, phaseIndex: number, scene: Scene, before: ReadonlySet<number>) => {
    let painted = paintedSteps.get(stepIndex);
    if (!painted) {
      const step = input.steps[stepIndex], identity = step.replayRelationIdentity, stageIndex = phases[phaseIndex].stageIndex;
      const active = step.replayKind === 'relation' && identity?.stageIndex === stageIndex ? identity.relationIndex : null;
      const played = active === null || before.has(active) ? before : new Set([...before, active]);
      const revealed = revealedAt(phaseIndex, scene, stepIndex, played, active);
      paintedSteps.set(stepIndex, painted = { revealed, played, occupants: scene.paintedSpace(step.replayVisibleNodeIds, revealed).obstacles });
    }
    return painted;
  };
  /** The plaques step `stepIndex` shows where allocation places them, with their Case
   * arrows and collectors (occupantsAt): what a plaque leaving its pocket early must
   * also keep clear of through its stage. */
  const scheduledPlaques = new Map<number, readonly PocketOccupant[]>();
  const scheduledPlaquesAt = ({ phaseIndex, scene, stepIndex, revealed, played }: { phaseIndex: number; scene: Scene; stepIndex: number;
    revealed: number[]; played: ReadonlySet<number> }) => {
    let found = scheduledPlaques.get(stepIndex);
    if (!found) {
      const layout = layouts[phaseIndex], shown = new Set(revealed.filter(index => layout.has(index)));
      const { obstacles } = scene.paintedSpace(input.steps[stepIndex].replayVisibleNodeIds, revealed);
      scheduledPlaques.set(stepIndex, found = occupantsAt(phaseIndex, scene, stepIndex, layout, shown, revealed,
        rowVisibleAt(phases[phaseIndex].stageIndex, played), played).slice(obstacles.length));
    }
    return found;
  };
  /** A plaque shown at consecutive steps keeps its pocket, carried with its anchor,
   * while that anchor stays still against the tree and the step paints nothing new in
   * its way (pocketHold.ts). The schedule may have moved it at a phase boundary because
   * the pocket is blocked later in the phase, or because a nearer one opened; it then
   * moves at the step that blocks its pocket, or when its anchor moves, unless syntax
   * or a mark of its stage will take that pocket while it is still shown beside a still
   * anchor: then it leaves where its stage begins (foreseenPocketBlocker), unless
   * `barred`. A plaque that leaves early does not return within reach while it holds
   * the pocket it took (`openHolds`). */
  const holdPockets = (phaseIndex: number, stepIndex: number) => {
    const phase = phases[phaseIndex], scheduled = layouts[phaseIndex], items = phase.items;
    const scene = phase.scenes.find(candidate => candidate.stepIndices.includes(stepIndex))!, byId = sceneNodes(scene);
    const step = input.steps[stepIndex], identity = step.replayRelationIdentity;
    if (playedStage !== phase.stageIndex) { playedStage = phase.stageIndex; played = new Set(); }
    if (step.replayKind === 'relation' && identity?.stageIndex === phase.stageIndex) played.add(identity.relationIndex);
    const active = step.replayKind === 'relation' && identity?.stageIndex === phase.stageIndex ? identity.relationIndex : null;
    const playedNow = new Set(played), rowVisible = rowVisibleAt(phase.stageIndex, playedNow);
    let revealedItems: number[] | undefined, shownItems: Set<number> | undefined;
    const revealed = () => revealedItems ??= revealedAt(phaseIndex, scene, stepIndex, playedNow, active);
    const shown = () => shownItems ??= new Set(revealed().filter(index => scheduled.has(index)));
    let paintedNodes: PaintedNodes | undefined;
    const painted = () => paintedNodes ??= (() => {
      const visibleIds = step.replayVisibleNodeIds && new Set(step.replayVisibleNodeIds), nodes = new Map<string, { x: number; y: number; parentId: string | null }>();
      const idOf = (node: d3.HierarchyPointNode<SyntaxNode>) => String((node as any).__vizId ?? node.data.id);
      for (const node of scene.nodes) if (!visibleIds || visibleIds.has(idOf(node)))
        nodes.set(idOf(node), { x: node.x, y: node.y, parentId: node.parent ? idOf(node.parent) : null });
      return nodes;
    })();
    const layout = new Map(scheduled), held = new Set<number>(), left = new Set<number>();
    const before = shownBefore;
    const moved = before ? [...scheduled].filter(([index, placement]) => {
      const prior = before.placements.get(identityOf(items[index]));
      return prior && prior.attachmentNodeId === placement.attachmentNodeId && prior.width === placement.width
        && prior.height === placement.height && !samePocket(prior, placement);
    }) : [];
    if (before && moved.length) {
      // One camera fit serves a stage; across a stage boundary the camera carries
      // the syntax the crossing leaves in place (carryCamera).
      const crossing = before.stageIndex !== phase.stageIndex;
      const shift = !crossing ? { x: 0, y: 0 } : paintedShift(before.painted(), painted());
      const shownThen = before.shown(), candidates = new Map<number, { pocket: PlaquePlacement; move: { x: number; y: number } }>();
      left.clear();
      let later: PocketOccupant[] | undefined;
      const occupants = () => later ??= occupantsAt(phaseIndex, scene, stepIndex, layout, shown(), revealed(), rowVisible, playedNow);
      for (const [index, placement] of moved) {
        const key = identityOf(items[index]), prior = before.placements.get(key)!;
        if (!shown().has(index) || !shownThen.has(key)) continue;
        const old = before.byId.get(placement.attachmentNodeId), anchor = byId.get(placement.attachmentNodeId);
        if (!old || !anchor || Math.hypot(anchor.x - old.x - shift.x, anchor.y - old.y - shift.y) > 1) continue;
        const move = { x: anchor.x - old.x, y: anchor.y - old.y }, request = requestsByIndex(phaseIndex).get(index);
        const pocket = { ...prior, x: prior.x - prior.attachmentX + anchor.x, y: prior.y - prior.attachmentY + anchor.y,
          attachmentX: anchor.x, attachmentY: anchor.y };
        // A proximity plaque left beyond its nearby reach comes back within it as soon
        // as what the previous step painted in that nearer pocket has gone, unless it
        // took that pocket early to stay clear of its stage: it keeps that one.
        const point = plaqueAnchorPoint(anchor);
        if (!openHolds.has(key) && request && proximityOnly(request) && returnsWithinReach({ before: { pocket, anchor: point }, after: { pocket: placement, anchor: point },
          owner: key, move, thetaGrid: request.thetaGrid, realizedForm: request.realizedForm }, before.occupants(), occupants())) continue;
        // Where a stage begins, it does not keep a pocket that syntax or a mark of the
        // stage will take while it is still shown beside a still anchor.
        if (crossing && !isBarred(key, phase.stageIndex) && foreseenPocketBlocker({ pocket, owner: key, move }, before.occupants(),
          aheadOf(phase.stageIndex, stepIndex, index, placement.attachmentNodeId, anchor, old, playedNow))) { left.add(index); continue; }
        candidates.set(index, { pocket, move });
      }
      /** The candidate pocket of `index`, attached, if nothing this step newly paints is in its way. */
      const holds = (index: number) => {
        const { pocket, move } = candidates.get(index)!, key = identityOf(items[index]), earlier = before.occupants(), now = occupants();
        if (ownRoutesChanged(key, move, earlier, now)) return clearAt(phaseIndex, scene, stepIndex, index, pocket, now, rowVisible, revealed());
        if (newPocketBlocker({ pocket, owner: key, move }, earlier, now)) return undefined;
        const { nodes, obstacles } = scene.paintedSpace(step.replayVisibleNodeIds, revealed());
        return attachAt(phaseIndex, index, pocket, nodes, obstacles, unblocked);
      };
      // Each plaque was first checked against the scheduled pockets of plaques not yet
      // kept. A plaque kept in its old pocket paints nothing new there, so others may
      // then keep theirs; one kept against everything the step paints can lose its
      // pocket to another kept plaque, and then takes its scheduled pocket for good.
      const lost = new Set<number>();
      for (let changed = true; changed;) {
        changed = false;
        for (const index of candidates.keys()) if (!held.has(index) && !lost.has(index)) {
          const kept = holds(index);
          if (kept) { layout.set(index, kept); held.add(index); later = undefined; changed = true; }
        }
        for (const index of held) if (!holds(index)) {
          layout.set(index, scheduled.get(index)!); held.delete(index); lost.add(index); later = undefined; changed = true;
        }
      }
    }
    // Nor does a plaque free to move take a pocket that syntax or a mark of this stage
    // will take while it is still shown beside a still anchor: it takes the first pocket
    // the schedule gives it later in that stretch that every allocation rule accepts now
    // and that stays clear (pocketHold.ts, foreseenPocketBlocker). It is free to move
    // where its stage begins, where it appears and where its anchor moves; elsewhere it
    // keeps its pocket as the hold above decides.
    let current: PocketOccupant[] | undefined;
    const crossing = !before || before.stageIndex !== phase.stageIndex, chosen = new Set<number>();
    for (const index of shown()) {
      const placement = layout.get(index)!, anchor = byId.get(placement.attachmentNodeId), key = identityOf(items[index]);
      if (!anchor || isBarred(key, phase.stageIndex)) continue;
      const prior = before?.placements.get(key), old = prior && before!.byId.get(placement.attachmentNodeId);
      if (!crossing && before!.shown().has(key) && prior?.attachmentNodeId === placement.attachmentNodeId && old
        && Math.hypot(anchor.x - old.x, anchor.y - old.y) <= 1) continue;
      const at = (box: PlaquePlacement): PlaquePlacement => ({ ...box, x: box.x - box.attachmentX + anchor.x, y: box.y - box.attachmentY + anchor.y,
        attachmentX: anchor.x, attachmentY: anchor.y });
      const now = () => current ??= occupantsAt(phaseIndex, scene, stepIndex, layout, shown(), revealed(), rowVisible, playedNow);
      const preference = preferred.get(barKey(key, phase.stageIndex));
      if (preference?.stepIndex === stepIndex) {
        const box = clearAt(phaseIndex, scene, stepIndex, index, at(preference.placement), now(), rowVisible, revealed());
        if (box) { layout.set(index, box); held.add(index); chosen.add(index); current = undefined; continue; }
      }
      const ahead = aheadOf(phase.stageIndex, stepIndex, index, placement.attachmentNodeId, anchor, anchor, playedNow);
      if (!ahead.length) continue;
      // Only syntax and marks count ahead, so what this step paints of them says what is new later.
      const { obstacles: here } = scene.paintedSpace(step.replayVisibleNodeIds, revealed());
      const owner = identityOf(items[index]), still = { x: 0, y: 0 };
      const foreseen = (box: PlaquePlacement) => foreseenPocketBlocker({ pocket: at(box), owner, move: still }, here, ahead);
      // The pocket it takes also stays clear of the plaques its stage shows later.
      const clear = (box: PlaquePlacement) => !foreseen(box) && !ahead.some(entry => {
        const carried = { ...at(box), x: at(box).x + entry.move.x, y: at(box).y + entry.move.y };
        return scheduledPlaquesAt(entry).some(occupant => !ownOccupant(owner, occupant) && blocksCarriedPocket(carried, occupant, box.syntaxGap));
      });
      const request = requestsByIndex(phaseIndex).get(index), size = allocatedSize(items[index]) ?? request;
      const nearby = request && size ? FORESEEN_REACH * nearbyPlaqueReach(reachOf(size, request)) : 0;
      if (!foreseen(placement)) {
        // One that left its pocket for this stretch need not stand farther than nearby.
        if (!left.has(index) || clear(placement) && anchorDistance(anchor, at(placement)) <= nearby + 1e-6) continue;
        const kept = clearThrough(phaseIndex, scene, stepIndex, index, anchor, now(), rowVisible, revealed(), ahead, nearby + 1e-6);
        if (kept && anchorDistance(anchor, kept) <= nearby + 1e-6 && clear(kept)) { layout.set(index, kept); held.add(index); chosen.add(index); current = undefined; continue; }
        if (clear(placement)) continue;
      }
      const later = new Map<string, PlaquePlacement>();
      for (const { phaseIndex: future } of (stageSteps.get(phase.stageIndex) ?? []).filter(entry => entry.stepIndex > stepIndex).slice(0, ahead.length)) {
        const box = layouts[future].get(index);
        if (box && !samePocket(box, placement)) later.set(`${box.x - box.attachmentX},${box.y - box.attachmentY}`, box);
      }
      // The new pocket stands within a tenth beyond the plaque's nearby reach, or no
      // farther than the old one.
      const reach = Math.max(nearby, anchorDistance(anchor, at(placement))) + 1e-6;
      const near = (box: PlaquePlacement | undefined) => box && anchorDistance(anchor, box) <= reach ? box : undefined;
      // It takes the nearest of the pockets the schedule gives it later in the stretch and
      // the pocket clear at this step and through the stretch.
      const nearest = (boxes: (PlaquePlacement | undefined)[]) => boxes.filter((box): box is PlaquePlacement => Boolean(box) && clear(box!))
        .sort((a, b) => anchorDistance(anchor, a) - anchorDistance(anchor, b))[0];
      let kept = nearest([...[...later.values()].filter(clear).map(box => near(clearAt(phaseIndex, scene, stepIndex, index, at(box), now(), rowVisible, revealed()))),
        near(clearThrough(phaseIndex, scene, stepIndex, index, anchor, now(), rowVisible, revealed(), ahead, reach))]);
      // Failing those, it stands farther rather than jump later (Francis, 27 October
      // 2026): the nearest pocket clear through the stretch at any distance.
      if (!kept) {
        kept = nearest([...[...later.values()].filter(clear).map(box => clearAt(phaseIndex, scene, stepIndex, index, at(box), now(), rowVisible, revealed())),
          clearThrough(phaseIndex, scene, stepIndex, index, anchor, now(), rowVisible, revealed(), ahead, Infinity)]);
      }
      if (kept) { layout.set(index, kept); held.add(index); chosen.add(index); current = undefined; }
    }
    // When rows leave a Case plaque, its shell fits the rows that remain at that step,
    // in its pocket (presentShell).
    for (const [index, placement] of layout) {
      const shell = presentShell(phaseIndex, index, placement, playedNow);
      if (shell !== placement) { layout.set(index, shell); held.add(index); }
    }
    let final: PocketOccupant[] | undefined;
    const occupants = () => final ??= occupantsAt(phaseIndex, scene, stepIndex, layout, shown(), revealed(), rowVisible, playedNow);
    /** This step as one scene of the lifetime of the plaque `index` (LifetimeScene). */
    const lifetimeSceneAt = (index: number): LifetimeScene[] => {
      const placement = layout.get(index)!, anchor = byId.get(placement.attachmentNodeId), request = requestsByIndex(phaseIndex).get(index);
      if (!anchor || !request) return [];
      const { nodes, obstacles } = scene.paintedSpace(step.replayVisibleNodeIds, revealed()), key = identityOf(items[index]);
      return [{ nodes, obstacles, anchor, request, owner: plaqueIdentity(items[index]), dx: 0, dy: 0,
        caseVisible: rowVisible(planItemRelationRefs(items[index]).map(ref => `${ref.stageIndex}:${ref.relationIndex}`)), rowVisible,
        added: occupants().slice(obstacles.length).filter(occupant => occupant.owner !== key) }];
    };
    // A plaque that took a pocket early keeps it, across stage boundaries too, while its
    // anchor stays still and it stays shown; a plaque that leaves it beside a still anchor
    // breaks the hold (`jumped`), and release enters the span again without that early
    // pocket. Each plaque's moves beside a still anchor are counted for that comparison.
    if (before) {
      const carry = crossing ? paintedShift(before.painted(), painted()) : { x: 0, y: 0 }, shownThen = before.shown();
      const stillAt = (index: number) => {
        const placement = layout.get(index)!, key = identityOf(items[index]), prior = before.placements.get(key);
        const anchor = byId.get(placement.attachmentNodeId), old = before.byId.get(placement.attachmentNodeId);
        return shown().has(index) && shownThen.has(key) && prior && prior.attachmentNodeId === placement.attachmentNodeId && anchor && old
          && Math.hypot(anchor.x - old.x - carry.x, anchor.y - old.y - carry.y) <= 1 ? prior : undefined;
      };
      for (const [index, placement] of layout) {
        const prior = stillAt(index), key = identityOf(items[index]);
        if (!prior) continue;
        const shift = Math.hypot(placement.x - placement.attachmentX - prior.x + prior.attachmentX, placement.y - placement.attachmentY - prior.y + prior.attachmentY);
        if (shift <= MOVE_UNITS) continue;
        const count = moves.get(key) ?? { count: 0, distance: 0 };
        moves.set(key, { count: count.count + 1, distance: count.distance + shift });
      }
      for (const [key, hold] of openHolds) {
        const index = items.findIndex(item => identityOf(item) === key);
        if (index < 0 || !layout.has(index) || !stillAt(index)) { ended.push(hold); openHolds.delete(key); }
        else if (offsetOf(layout.get(index)!) !== hold.offset) { jumped.add(barKey(key, hold.stage)); openHolds.delete(key); }
        else hold.scenes.push(...lifetimeSceneAt(index));
      }
    }
    for (const index of new Set([...left, ...chosen])) {
      const placement = layout.get(index)!, anchor = byId.get(placement.attachmentNodeId);
      if (!anchor) continue;
      const attached = { ...placement, x: placement.x - placement.attachmentX + anchor.x, y: placement.y - placement.attachmentY + anchor.y };
      openHolds.set(identityOf(items[index]), { key: identityOf(items[index]), stage: phase.stageIndex, offset: offsetOf(placement), distance: anchorDistance(anchor, attached),
        scenes: lifetimeSceneAt(index), start: { phaseIndex, scene, stepIndex, index, occupants: occupants(), rowVisible, revealed: revealed() } });
    }
    shownBefore = { stageIndex: phase.stageIndex, byId, painted, occupants,
      placements: new Map([...layout].map(([index, placement]) => [identityOf(items[index]), placement])),
      shown: () => new Set([...shown()].map(index => identityOf(items[index]))) };
    recorded?.set(stepIndex, { occupants, owner: index => identityOf(items[index]), pocket: index => {
      const placement = layout.get(index), anchor = placement && byId.get(placement.attachmentNodeId);
      return placement && anchor && { x: placement.x - placement.attachmentX + anchor.x, y: placement.y - placement.attachmentY + anchor.y,
        width: placement.width, height: placement.height, ...placement.syntaxGap === undefined ? {} : { syntaxGap: placement.syntaxGap } };
    } });
    return held.size ? layout : scheduled;
  };
  let released = 0;
  /** How far beyond its nearby reach, as a multiple of it, a plaque may stand to keep
   * clear of what its stage paints later; the offline audit's mark-distance margin. */
  const FORESEEN_REACH = 1.1;
  const phaseStages = phases.map(phase => phase.stageIndex);
  /** How much farther in all a plaque that takes a pocket early may move beside its still
   * anchor than it does without that pocket (PR #285 review, 29 October 2026). */
  const EARLY_DISTANCE_RATIO = 1.05;
  /** The stages entered but not yet published while a plaque holds a pocket it took
   * early: the first phase, the state the schedule entered it with, and the early pockets
   * barred there. */
  type Span = { first: number; saved: { shownBefore: typeof shownBefore; playedStage: number; played: Set<number> }; barred: Set<string>;
    preferred: Map<string, { stepIndex: number; placement: PlaquePlacement }> };
  let span: Span | undefined;
  const begin = ({ saved, barred: bars, preferred: preferences }: Span) => {
    ({ shownBefore, playedStage } = saved);
    played = new Set(saved.played);
    openHolds = new Map(); ended = []; jumped = new Set(); moves = new Map(); barred = bars; preferred = preferences;
  };
  /** Enter the phases `from` through `to` into the schedule, step by step. */
  const enter = (from: number, to: number) => {
    for (let phaseIndex = from; phaseIndex <= to; phaseIndex++) {
      schedule.stages[phases[phaseIndex].stageIndex] = layouts[phaseIndex];
      phases[phaseIndex].scenes.flatMap(scene => scene.stepIndices).sort((a, b) => a - b)
        .forEach(index => schedule.steps.set(index, holdPockets(phaseIndex, index)));
    }
  };
  /** The nearest pocket nearer than the one `hold` kept that stays clear, by every
   * allocation rule, through every step of the hold, or undefined. */
  const nearerThroughHold = (hold: Hold) => {
    const first = hold.scenes[0];
    if (!first) return undefined;
    const space = lifetimeSpaceOf(hold.scenes.map(scene => ({ ...scene, dx: first.anchor.x - scene.anchor.x, dy: first.anchor.y - scene.anchor.y })));
    const { phaseIndex, scene, stepIndex, index, occupants, rowVisible, revealed } = hold.start;
    const found = placeStagePlaques(phases[phaseIndex].items, first.nodes, first.obstacles, new Map(), input.measurePlaqueText,
      { sizes, includes: other => other === index, spaceFor: () => space, caseSources, searchWithin: hold.distance }).get(index);
    const nearer = found?.location === 'local' ? clearAt(phaseIndex, scene, stepIndex, index, found, occupants, rowVisible, revealed) : undefined;
    return nearer && anchorDistance(first.anchor, nearer) < hold.distance - 1 ? nearer : undefined;
  };
  /** The early pockets of the span entered through phase `to` that break the trade
   * Francis accepted on 27 October 2026, a farther pocket instead of a jump, as barKey:
   * a plaque leaves its early pocket beside its still anchor; a nearer pocket stays clear
   * through its whole hold, after it was given that pocket once (`preferred`, marked by an
   * empty key); or, against the same span without its early pocket, it moves beside its
   * still anchor more often, or more than EARLY_DISTANCE_RATIO as far in all. None while a
   * hold is still open; with none, the span stands as entered. */
  const broken = (current: Span, to: number) => {
    if (to === phases.length - 1) { ended.push(...openHolds.values()); openHolds.clear(); }
    if (jumped.size) return [...jumped];
    if (openHolds.size) return [];
    // A hold with a nearer pocket clear throughout takes that one on the next pass; a
    // hold that already did is barred.
    const far = ended.flatMap(hold => {
      const nearer = nearerThroughHold(hold), bar = barKey(hold.key, hold.stage);
      if (!nearer) return [];
      if (current.preferred.has(bar)) return [bar];
      current.preferred.set(bar, { stepIndex: hold.start.stepIndex, placement: nearer });
      return [''];
    });
    if (far.length) return far;
    if (!ended.length) return [];
    const kept = ended, early = moves;
    // The comparison bars every early pocket of these plaques in the span.
    begin({ ...current, barred: new Set([...current.barred, ...kept.map(hold => barKey(hold.key, -1))]) });
    enter(current.first, to);
    const without = moves, none = { count: 0, distance: 0 };
    const worse = kept.filter(hold => {
      const own = early.get(hold.key) ?? none, other = without.get(hold.key) ?? none;
      return own.count > other.count || own.distance > EARLY_DISTANCE_RATIO * other.distance + 1e-6;
    });
    if (worse.length) return worse.map(hold => barKey(hold.key, hold.stage));
    begin(current);
    enter(current.first, to);
    return [];
  };
  /** Enter allocated phases into the schedule as releasablePhase allows, whole stages at
   * a time, and publish each completed stage. While a plaque holds a pocket it took early
   * (holdPockets), the stages entered since it took it wait: if the hold breaks the trade
   * (`broken`), the span is entered again with that early pocket barred, so that plaque
   * does what it does without the foresight. */
  const release = (allocated: number) => {
    const pending = releasablePhase(phaseStages, allocated, [...openRuns.values()].filter(run => run.remote).map(run => run.phases[0]));
    if (released > pending) return;
    if (!span) begin(span = { first: released, saved: { shownBefore, playedStage, played: new Set(played) }, barred: new Set(), preferred: new Map() });
    const current = span;
    for (let from = released; ; from = current.first) {
      enter(from, pending);
      const bars = broken(current, pending);
      if (!bars.length) break;
      bars.forEach(bar => { if (bar) current.barred.add(bar); });
      begin(current);
    }
    released = pending + 1;
    if (openHolds.size) return;
    span = undefined;
    [...new Set(phaseStages.slice(current.first, released))].forEach(stageIndex => stageReady?.(schedule, stageIndex));
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

/** The last phase whose Replay steps the plaque schedule may enter once the phases
 * through `allocated` are allocated, `stageOf` giving each phase's stage: every phase of
 * its stage is allocated, since a step's hold reads the later steps of its stage
 * (aheadOf), and no remote run still open may move a pocket of its stage (bringNear),
 * `remoteStarts` being the first phase of each such run. */
export function releasablePhase(stageOf: readonly number[], allocated: number, remoteStarts: readonly number[]): number {
  const firstOfStage = (phase: number) => {
    let first = phase;
    while (first > 0 && stageOf[first - 1] === stageOf[phase]) first--;
    return first;
  };
  const complete = allocated >= 0 && stageOf[allocated + 1] === stageOf[allocated] ? firstOfStage(allocated) - 1 : allocated;
  return Math.min(complete, ...remoteStarts.map(start => firstOfStage(start) - 1));
}

/** Completed-stage layouts for callers without an active Replay moment. */
/** Right to left, plaques take the reflection of their left-to-right pockets:
 * the schedule is made on the left-to-right layout, which right-to-left Replay
 * reflects about one axis (stageCoordinates.ts, `rightToLeftAxis`), and every
 * placement is reflected about that axis. Pocket order, column scans and ports
 * then prefer the reading-direction side exactly as left to right does. */
function reflectedPlaqueSchedule(input: StageLayoutInput, coordinates?: MeasuredStageCoordinates,
  stageReady?: (schedule: ReplayPlaqueSchedule, stageIndex: number) => void, pocketOccupants = false): ReplayPlaqueSchedule {
  const sizeFor = (stage: number) => stageTreeLayoutSize(input.steps, stage, input.width, input.height, input.layoutGroups);
  const axes = new Map<number, number>();
  const axisFor = (stage: number | undefined) => {
    if (stage === undefined) return undefined;
    if (!axes.has(stage)) { const size = sizeFor(stage); if (size) axes.set(stage, rightToLeftAxis(input.steps, size, sizeFor)); }
    return axes.get(stage);
  };
  const reflectLayout = (layout: Map<number, PlaquePlacement>, axis: number | undefined) => axis === undefined ? layout
    : new Map([...layout].map(([index, placement]) => [index, reflectPlaquePlacement(placement, axis)] as const));
  const reflect = (schedule: ReplayPlaqueSchedule): ReplayPlaqueSchedule => ({
    stages: schedule.stages.map((layout, stage) => reflectLayout(layout, axisFor(stage))),
    steps: new Map([...schedule.steps].map(([step, layout]) => [step, reflectLayout(layout, axisFor(input.steps[step]?.replayFrameIndex))]))
  });
  const leftToRight = coordinates && new Map([...coordinates].map(([stage, frames]) => {
    const size = sizeFor(stage);
    return [stage, size ? leftToRightReservations(input.steps, frames, size, sizeFor) : frames] as const;
  }));
  const leftToRightSchedule = buildReplayPlaqueSchedule({ ...input, direction: 'ltr' }, leftToRight,
    stageReady && ((schedule, stageIndex) => stageReady(reflect(schedule), stageIndex)), { pocketOccupants });
  const reflected = reflect(leftToRightSchedule), records = pocketRecords.get(leftToRightSchedule);
  if (records) pocketRecords.set(reflected, new Map([...records].map(([step, record]) => {
    const axis = axisFor(input.steps[step]?.replayFrameIndex);
    return [step, axis === undefined ? record : { ...record, occupants: () => record.occupants().map(occupant => reflectOccupant(occupant, axis)),
      pocket: (index: number) => { const pocket = record.pocket(index); return pocket && { ...pocket, x: axis - pocket.x - pocket.width }; } }];
  })));
  return reflected;
}

/** A pocket occupant reflected as reflectPlaquePlacement reflects a placement: x to `axis` - x. */
function reflectOccupant(occupant: PocketOccupant, axis: number): PocketOccupant {
  const point = (p: { x: number; y: number }) => ({ ...p, x: axis - p.x });
  const { curve, connectorInk, route } = occupant;
  return { ...occupant, x: axis - occupant.x - occupant.width,
    ...curve ? { curve: { source: point(curve.source), control1: point(curve.control1), control2: point(curve.control2), target: point(curve.target) } } : {},
    ...connectorInk ? { connectorInk: { ...connectorInk, x: axis - connectorInk.x - connectorInk.width } } : {},
    ...route ? { route: { ...route, far: point(route.far) } } : {} };
}

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
    /** The obstacles of these items' marks, with this syntax. */
    const obstaclesOf = (marks: typeof items, currentNodes: d3.HierarchyPointNode<SyntaxNode>[],
      treeObstacles = plaqueTreeObstacles(currentNodes, input.measureCategoryText)): PlaqueRect[] => {
      const obstacles: PlaqueRect[] = [...treeObstacles, ...plaqueConnectorObstacles(marks, currentNodes),
        ...predicationPlaqueObstacles(marks, currentNodes, {
          measureCategoryText: input.measureCategoryText, measureTreeInk: input.measureTreeInk,
          labels,
          measureTreeLabel: input.measureTreeLabel
        }),
        ...nativePlaqueObstacles(marks, currentNodes, {
          measureCategoryText: input.measureCategoryText, measureTreeInk: input.measureTreeInk,
          labels, measureTreeLabel: input.measureTreeLabel, measurePlaqueText: input.measurePlaqueText
        }),
        // A control dependency is reserved only in the scenes that paint it.
        ...controlPlaqueObstacles(marks.filter(item => item.familyId === 'control.dependency'
          && isPlanItemRevealed(item, input.stageIndex, scene.playedRelations)), currentNodes, {
          measureCategoryText: input.measureCategoryText, measureTreeInk: input.measureTreeInk
        })];
      // A binding domain's ellipse spans the syntax it is painted over, so it is reserved
      // only in the scenes that paint it.
      obstacles.push(...regionPlaqueObstacles(input.plan, input.stageIndex, marks.filter(item => item.kind !== 'binding-domain'
        || isPlanItemRevealed(item, input.stageIndex, scene.playedRelations)), items, byId, currentNodes, input.measureCategoryText));
      // Use the trajectory binder's actual geometry in each frame's coordinates.
      const trajectories = marks.filter(item => item.kind === 'trajectory');
      if (!input.plan || !trajectories.length) return obstacles;
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
      return obstacles;
    };
    // Every stage mark and every node the scene shows at any of its steps reserves its
    // space; `painted` keeps only the syntax and marks one step shows.
    const painted = new Map<string, { nodes: typeof currentNodes; obstacles: PlaqueRect[] }>();
    const paintedSpace = (visibleIds: readonly string[] | undefined, shown: readonly number[]) => {
      const visible = visibleIds && new Set(visibleIds);
      const nodes = visible ? currentNodes.filter(node => visible.has(String((node as any).__vizId ?? node.data.id ?? ''))) : currentNodes;
      const key = `${nodes.length === currentNodes.length ? '' : nodes.map(node => String((node as any).__vizId ?? node.data.id)).join(',')}|${shown.join(',')}`;
      let space = painted.get(key);
      if (!space) painted.set(key, space = { nodes, obstacles: obstaclesOf(shown.map(index => items[index]), nodes) });
      return space;
    };
    // A method, not data: measured scenes compare as plain geometry.
    return Object.defineProperty({ nodes: currentNodes, obstacles: obstaclesOf(items, currentNodes), labels,
      playedRelations: scene.playedRelations, ...timing }, 'paintedSpace', { value: paintedSpace }) as {
        nodes: typeof currentNodes; obstacles: PlaqueRect[]; labels: typeof labels; playedRelations: typeof scene.playedRelations;
        paintedSpace: typeof paintedSpace } & typeof timing;
  });
  return { nodes, obstacles: measured.flatMap(scene => scene.obstacles), scenes: measured };
}

/** The boxes plaques keep clear of a stage's region marks: an enclosure's whole shaded
 * box, and the outline of a domain box or ellipse, which a plaque may stand inside or
 * outside but not across. Enclosures and domain marks are bound as the painter binds
 * them; a binding domain's ellipse is the one it paints over `nodes`
 * (sceneBindingDomainEllipse) before it grows around the plaques of `items` attached
 * inside its domain (bindingDomainPlaques), which it does not block. */
function regionPlaqueObstacles(plan: StageLayoutInput['plan'], stageIndex: number, marks: readonly RelationPlanItem[],
  items: readonly RelationPlanItem[], byId: Map<string, d3.HierarchyPointNode<SyntaxNode>>,
  nodes: readonly d3.HierarchyPointNode<SyntaxNode>[], measureCategoryText?: CategoryTextMeasure): PlaqueRect[] {
  const regions = marks.filter(item => item.kind === 'enclosure' || item.kind === 'domain-mark');
  const stroke = 4, edge = (x: number, y: number, width: number, height: number): PlaqueRect =>
    ({ x: x - stroke, y: y - stroke, width: width + 2 * stroke, height: height + 2 * stroke });
  const outline = (ellipse: { cx: number; cy: number; rx: number; ry: number }) => ellipseOutlineObstacles(ellipse, stroke);
  const domains = marks.flatMap(item => {
    const domain = item.kind === 'binding-domain' && byId.get(item.domainNodeId);
    const ellipse = domain && sceneBindingDomainEllipse(item.domainNodeId, byId, nodes, [], new Map(), measureCategoryText);
    if (!domain || !ellipse) return [];
    const members = new Set(domain.descendants().map(node => String((node as any).__vizId ?? node.data.id)));
    const enclosedPlaques = new Set(items.flatMap(other => other.kind === 'node-plaque' && other.anchorNodeIds.length
      && other.anchorNodeIds.every(id => members.has(id)) ? [plaqueIdentity(other), claimIdentity(other)] : []));
    return outline(ellipse).map(box => enclosedPlaques.size ? { ...box, enclosedPlaques } : box);
  });
  if (!plan || !regions.length) return domains;
  const bound = bindRelationPlanFrame({ ...plan, frames: plan.frames.map((frame, index) => index === stageIndex ? { ...frame, items: regions } : frame) },
    stageIndex, stagePositionProvider(byId), { ...RELATION_BINDING_METRICS, markerScale: 1 });
  return [...domains, ...bound.primitives.flatMap((primitive): PlaqueRect[] => {
    if (primitive.type === 'enclosure') return [edge(primitive.x, primitive.y, primitive.width, primitive.height)];
    if (primitive.type === 'domain-region') {
      const { x, y, width, height } = primitive;
      return [edge(x, y, width, 0), edge(x, y + height, width, 0), edge(x, y, 0, height), edge(x + width, y, 0, height)];
    }
    return primitive.type === 'domain-ellipse' ? outline(primitive) : [];
  })];
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
    // A plaque that keeps its pocket for some steps of a scene has a layout of its own there.
    const stepLayouts = includePlaques && schedule ? new Set(stepIndices.map(index => selectReplayPlaqueLayout(schedule, stageIndex, index))) : new Set([placements]);
    stepLayouts.delete(placements);
    [projectedPlaques, ...[...stepLayouts].map(layout => projectPlaqueLayout(layout, id => byId.get(id) ?? null))]
      .forEach(layout => layout.forEach(rect => include({
        minX: rect.x - PLAQUE_FIT_MARGIN, maxX: rect.x + rect.width + PLAQUE_FIT_MARGIN,
        minY: rect.y - PLAQUE_FIT_MARGIN, maxY: rect.y + rect.height + PLAQUE_FIT_MARGIN
      })));
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
      for (const item of plan.frames[stageIndex]?.items ?? []) {
        if (item.kind !== 'binding-domain') continue;
        const ellipse = sceneBindingDomainEllipse(item.domainNodeId, byId, fitNodes, plan.frames[stageIndex]?.items ?? [],
          projectedPlaques, measureCategoryText);
        if (ellipse) include(bindingEllipseBounds(ellipse));
      }
    }
    const items = plan?.frames[stageIndex]?.items ?? [];
    if (includePlaques && items.some(item => item.kind === 'undirected-link' && item.linkStyle === 'feature-sharing'
      || item.kind === 'directed-path' && item.pathStyle === 'dependent-case')) {
      // Fixed native plaques: the measured footprint allocation reserves for them.
      nativePlaqueFootprints(items, fitNodes, { measureCategoryText, measureTreeInk,
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
      railBaseY: maxY + RELATION_LANES_BELOW_DEEPEST_NODE.railBase, direction,
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
