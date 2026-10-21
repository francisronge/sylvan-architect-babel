import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { attachmentShapeChanges } from './attachmentShapeChanges.ts';
import { categoryMetricKey } from './categoryMetricKey.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { rigidMovementHosts } from './movementHostContinuity.ts';
import { cubicIntersectsRect } from './relations/curveClearance.ts';
import { stageVerticalGeometry } from './stageVerticalGeometry.ts';
import { treeInkObstacles, type TreeInkTextMeasure } from './treeInkGeometry.ts';
import { treeInkMetricKey } from './treeInkMetricKey.ts';
import { treeLabelMetricKey } from './treeLabelMetricKey.ts';
import type { PreparedTreeLabelRuns, TreeLabelMeasure, TreeLabelRuns } from './treeLabelRuns.ts';
import { layoutSyntaxTree, type TreeCoordinateReservation, type TreeDirection } from './treeLayout.ts';
import type { PlaybackStep } from './types.ts';
import { extentOverlap, obstacleExtent, verticalObstacleIndex } from './verticalObstacleIndex.ts';
import { visibleChildIds, visibleComponentNodes, visibleParentId } from './visibleComponent.ts';
import { reserveAttachmentLifetimes, type WorkspaceAttachmentPolicy, type WorkspaceAttachmentScene } from './workspaceAttachmentPlan.ts';
import { planCoherentWorkspace, type CoherentWorkspaceDiagnostic } from './workspaceCoherentPlan.ts';
import {
  prepareComponentLifetimeReservations,
  retainUnchangedComponentLifetime,
  sceneTreeInk,
  workspaceComponentIsStationary,
  workspaceComponentLifetimeSeeds,
  type ComponentLifetimeOptions
} from './workspaceComponentLifetime.ts';

type LifetimeAttempt = { kind: 'reserve'; options?: ComponentLifetimeOptions } | { kind: 'retain' };
// Keep established successful plans first; later policies handle progressively
// broader source lifetimes under the same motion, clearance, and shape guards.
const lifetimeAttempts: readonly LifetimeAttempt[] = [
  { kind: 'reserve' },
  { kind: 'reserve', options: { throughRelations: true } },
  { kind: 'reserve', options: { throughRelations: true, reserveSourceProjections: true } },
  { kind: 'retain' },
  { kind: 'reserve', options: { throughRelations: true, carryUntilMovement: true } },
  { kind: 'reserve', options: { throughRelations: true, clearPriorSources: true } },
  { kind: 'reserve', options: { throughRelations: true, reserveSourceProjections: true,
    carryUntilMovement: true, clearPriorSources: true } }
];

type Node = d3.HierarchyPointNode<SyntaxNode>;
type Reservations = ReadonlyMap<SyntaxNode, TreeCoordinateReservation>;
type Scene = WorkspaceAttachmentScene & {
  measureCategoryText?: CategoryTextMeasure;
  measureTreeInk?: TreeInkTextMeasure;
  treeLabelRuns?: ReadonlyMap<string, readonly TreeLabelRuns[]>;
  measureTreeLabel?: TreeLabelMeasure;
  currentRowHeight: number;
};

const cache = new WeakMap<readonly PlaybackStep[], Map<string, Map<string, Reservations>>>();
const coherentDiagnostics = new WeakMap<readonly PlaybackStep[], Map<string, CoherentWorkspaceDiagnostic & { direction: TreeDirection }>>();
export const getCoherentWorkspaceDiagnostics = (steps: readonly PlaybackStep[]) => [...(coherentDiagnostics.get(steps)?.values() ?? [])];
/** Reserve a component whose first attachment preserves its child lists.
 * Ordinary construction reserves the attachment layout before the component
 * appears. If that cannot fit its earlier source, retain the component shape
 * through its first attachment stage. A relation keeps the source in its old parent;
 * the source's old place belongs only to its exact lower witness.
 * No syntax, branch ranks, pronunciation or relation timing is added here. */
export function reserveWorkspaceAttachments({
  steps, sizes, direction, coordinatesForStage, measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel, minimumSiblingGap = 0,
  orderedContours = false, alignedStages = false
}: {
  steps: readonly PlaybackStep[];
  sizes: ReadonlyMap<number, [number, number]>;
  direction: TreeDirection;
  coordinatesForStage: (stage: number, size: [number, number]) => Reservations;
  measureCategoryText?: CategoryTextMeasure;
  measureTreeInk?: TreeInkTextMeasure;
  treeLabelRuns?: PreparedTreeLabelRuns;
  measureTreeLabel?: TreeLabelMeasure;
  minimumSiblingGap?: number;
  /** End each attachment lifetime before its members interleave a sister subtree. */
  orderedContours?: boolean;
  /** Distinguishes plans over translated stage frames in the plan cache. */
  alignedStages?: boolean;
}): Reservations {
  const stageSizes = [...sizes].sort(([a], [b]) => a - b);
  const key = JSON.stringify([direction, stageSizes, minimumSiblingGap, orderedContours, alignedStages]);
  let measurements = cache.get(steps);
  if (!measurements) cache.set(steps, measurements = new Map());
  const metricKey = JSON.stringify([categoryMetricKey(steps, measureCategoryText),
    treeInkMetricKey(steps, measureCategoryText, measureTreeInk),
    treeLabelMetricKey(steps, treeLabelRuns, measureTreeLabel)]);
  let plans = measurements.get(metricKey);
  if (!plans) measurements.set(metricKey, plans = new Map());
  const cached = plans.get(key);
  if (cached) return cached;

  const originals = new Map(stageSizes.map(([stage, size]) => [stage, coordinatesForStage(stage, size)]));
  const orderedSteps = [...steps].sort((a, b) => (a.replayFrameIndex! - b.replayFrameIndex!)
    || ((a.replayStageStepIndex ?? (a.replayKind === 'macro' ? Infinity : 0))
      - (b.replayStageStepIndex ?? (b.replayKind === 'macro' ? Infinity : 0))));
  const stageRows = new Map(stageSizes.map(([stage]) => [stage,
    stageVerticalGeometry(orderedSteps.filter(step => step.replayFrameIndex === stage)).rowHeight]));
  const scenes: Scene[] = orderedSteps.flatMap(step => {
    const canvas = step.replayCanvasData, size = sizes.get(step.replayFrameIndex!);
    if (!canvas || !size) return [];
    const coordinates = originals.get(step.replayFrameIndex!)!.get(canvas)!;
    const root = d3.hierarchy(canvas); applyVizIds(root);
    const visible = new Set(step.replayVisibleNodeIds);
    const tree = layoutSyntaxTree(root, size, direction, coordinates, visible);
    const nodes = new Map<string, Node>(tree.descendants().filter(node => visible.has(getNodeId(node)))
      .map(node => [getNodeId(node), node] as const));
    return [{ step, canvas, size, currentRowHeight: stageRows.get(step.replayFrameIndex!)!, nodes, coordinates, measureCategoryText, measureTreeInk,
      treeLabelRuns: treeLabelRuns?.get(canvas), measureTreeLabel }];
  });

  // Construction can resize a stage even before its first merge. Reserve each
  // unchanged waiting component at its eventual attachment coordinates.
  const ordinaryRoots = new Set<string>();
  const stableRoots = new Set<string>();
  for (let index = 1; index < scenes.length; index++) {
    const prior = scenes[index - 1], next = scenes[index];
    if (prior.step.replayFrameIndex === next.step.replayFrameIndex || next.step.replayKind !== 'micro') continue;
    const roots = (scene: Scene) => [...scene.nodes.values()].filter(node => !visibleParentId(node, scene.nodes));
    const earlier = roots(prior), later = roots(next);
    // A new parent must not relayout an already complete daughter. Its whole
    // component qualifies, including a clause whose root attaches at this step.
    earlier.filter(node => {
      const attached = next.nodes.get(getNodeId(node));
      return attached && visibleParentId(attached, next.nodes);
    }).forEach(node => ordinaryRoots.add(getNodeId(node)));
    const common = earlier.filter(node => later.some(other => getNodeId(other) === getNodeId(node)
      && JSON.stringify(node.data) === JSON.stringify(other.data)));
    common.forEach(node => ordinaryRoots.add(getNodeId(node)));
    const earlierOrder = [...common].sort((a, b) => a.x - b.x).map(getNodeId);
    const laterOrder = [...common].sort((a, b) => next.nodes.get(getNodeId(a))!.x - next.nodes.get(getNodeId(b))!.x).map(getNodeId);
    if (JSON.stringify(earlierOrder) !== JSON.stringify(laterOrder)) {
      common.forEach(node => stableRoots.add(getNodeId(node)));
      earlier.filter(node => !visibleChildIds(node, prior.nodes).length && visibleParentId(next.nodes.get(getNodeId(node)) ?? node, next.nodes))
        .forEach(node => stableRoots.add(getNodeId(node)));
    }
  }
  // The established side-switch reservation remains the fallback. Complete
  // attachment histories additionally compose each earlier scene backwards,
  // so a prior movement cannot become the new location of the same jump.
  const compute = (policy: WorkspaceAttachmentPolicy, base?: Reservations) =>
    reserveAttachmentLifetimes({ scenes, direction, ordinaryRoots, stableRoots, base, orderedContours, policy });
  const relationAttachments = compute({ allowOrdinary: false });
  const inkCaches = [new WeakMap<Scene, WeakMap<TreeCoordinateReservation, Map<string, number> | null>>(),
    new WeakMap<Scene, WeakMap<TreeCoordinateReservation, Map<string, number> | null>>()];
  let baseline: Reservations = compute({ allowOrdinary: true }, relationAttachments);
  let candidate: Reservations = compute({ allowOrdinary: true, progressive: true, preserveShape: false }, baseline);
  const renderCache = new WeakMap<Scene, WeakMap<TreeCoordinateReservation, Node[]>>();
  const rendered = (scene: Scene, reservation: TreeCoordinateReservation): Node[] => {
    let sceneCache = renderCache.get(scene);
    if (!sceneCache) renderCache.set(scene, sceneCache = new WeakMap());
    const cached = sceneCache.get(reservation);
    if (cached) return cached;
    const root = d3.hierarchy(scene.canvas); applyVizIds(root);
    const visible = new Set(scene.nodes.keys());
    const nodes = layoutSyntaxTree(root, scene.size, direction, reservation, visible).descendants()
      .filter(node => visible.has(getNodeId(node)));
    sceneCache.set(reservation, nodes);
    return nodes;
  };
  const attachmentsSafe = (proposed: Reservations, accepted: Reservations) => scenes.every((scene, index) => {
    if (!index) return true;
    const previous = scenes[index - 1];
    const nodes = (frame: Scene, plan: Reservations) => new Map(rendered(frame, plan.get(frame.canvas)!)
      .map(node => [getNodeId(node), node]));
    const before = attachmentShapeChanges(nodes(previous, accepted), nodes(scene, accepted));
    const after = attachmentShapeChanges(nodes(previous, proposed), nodes(scene, proposed));
    return [...after].every(([pair, change]) => change <= (before.get(pair) ?? 0) + 1e-6);
  });
  if (!finalShapesUnchanged(baseline, relationAttachments) || !attachmentsSafe(baseline, relationAttachments) || !scenes.every(scene => {
    const after = ink(scene, baseline.get(scene.canvas)!), before = ink(scene, relationAttachments.get(scene.canvas)!);
    return after && before && [...after].every(([pair, area]) => area <= (before.get(pair) ?? 0) + 1e-6);
  })) {
    baseline = relationAttachments;
    candidate = compute({ allowOrdinary: true, progressive: true, preserveShape: false }, baseline);
  }
  // A lifetime can end when its topology changes. Reject a reservation that
  // merely moves a discontinuity to that boundary or to another component.
  const activeLowerWitnesses = new WeakMap<Scene, Set<string>>();
  const movementParticipants = (before: Scene, scene: Scene): Set<string> => {
    const cached = activeLowerWitnesses.get(scene);
    if (cached) return cached;
    const participants = new Set<string>();
    activeLowerWitnesses.set(scene, participants);
    const identity = scene.step.replayRelationIdentity;
    if (scene.step.replayKind !== 'relation' || !identity) return participants;
    const key = `${identity.stageIndex}:${identity.relationIndex}`;
    for (const link of scene.step.replayRelationLinks ?? []) {
      if (link.authoredRelationKey !== key || link.renderFamily !== 'trajectory'
        || !link.priorSourceNodeId || !link.witnessNodeId || !link.targetNodeId
        || link.targetNodeId === link.witnessNodeId || !scene.nodes.has(link.targetNodeId)) continue;
      const source = before.nodes.get(link.priorSourceNodeId), witness = scene.nodes.get(link.witnessNodeId);
      if (!source || !witness || visibleParentId(source, before.nodes) !== visibleParentId(witness, scene.nodes)) continue;
      const priorMembers = new Set(visibleComponentNodes(source, before.nodes).map(getNodeId));
      for (const member of visibleComponentNodes(witness, scene.nodes)) {
        const id = getNodeId(member);
        if (priorMembers.has(id)) participants.add(id);
      }
    }
    return participants;
  };
  const visibleAncestors = (node: Node, nodes: ReadonlyMap<string, Node>) => {
    const ancestors: Node[] = [];
    for (let current = node.parent; current && nodes.has(getNodeId(current)); current = current.parent) ancestors.push(current);
    return ancestors;
  };
  type PlanCheck = {
    candidate: Reservations;
    baseline: Reservations;
    mode: 'attachment' | 'lifetime';
  };
  // Exemptions from the motion guard that depend only on the two scenes'
  // current topology and material, never on a plan's coordinates.
  type Exemption = { topology: boolean; mergeParticipant: boolean; regrown: boolean };
  const exemptions = new WeakMap<Scene, Map<string, Exemption>>();
  const exemption = (before: Scene, scene: Scene, id: string): Exemption => {
    let byId = exemptions.get(scene);
    if (!byId) exemptions.set(scene, byId = new Map());
    let value = byId.get(id);
    if (value) return value;
    const original = scene.nodes.get(id)!, prior = before.nodes.get(id);
    let currentAncestors: Set<string> | undefined;
    const topology = !prior || visibleParentId(original, scene.nodes) !== visibleParentId(prior, before.nodes)
      || JSON.stringify(visibleChildIds(original, scene.nodes)) !== JSON.stringify(visibleChildIds(prior, before.nodes))
      || scene.step.replayKind === 'relation' && visibleAncestors(prior, before.nodes).some(ancestor =>
        before.nodes.has(getNodeId(ancestor)) && ancestor.data.replayOrigin?.kind !== 'workspace'
        && !(currentAncestors ??= new Set(visibleAncestors(original, scene.nodes).map(getNodeId))).has(getNodeId(ancestor)));
    // The merge participants can translate when they join. Unrelated
    // components and relation-only scenes still obey the motion guard.
    const mergeParticipant = scene.step.replayKind === 'micro' && scene.step.operation === 'ExternalMerge'
      && visibleAncestors(original, scene.nodes).some(ancestor => getNodeId(ancestor) === scene.step.targetNodeId);
    // A branch centers over its actual daughters after internal growth.
    // Its unchanged descendants remain independently constrained below.
    const regrown = !topology && visibleChildIds(original, scene.nodes).length > 0 && grownBelow(before, scene, original);
    byId.set(id, value = { topology, mergeParticipant, regrown });
    return value;
  };
  // Whether any member of a node's visible component, itself included, is new or
  // changed its material or visible children since the preceding scene.
  const grown = new WeakMap<Scene, Map<Node, boolean>>();
  const grownBelow = (before: Scene, scene: Scene, node: Node): boolean => {
    let byNode = grown.get(scene);
    if (!byNode) grown.set(scene, byNode = new Map());
    let value = byNode.get(node);
    if (value === undefined) {
      const old = before.nodes.get(getNodeId(node));
      value = !old || node.data.label !== old.data.label || node.data.word !== old.data.word
        || node.data.silent !== old.data.silent || JSON.stringify(visibleChildIds(node, scene.nodes)) !== JSON.stringify(visibleChildIds(old, before.nodes))
        || (node.children ?? []).some(child => scene.nodes.has(getNodeId(child)) && grownBelow(before, scene, child));
      byNode.set(node, value);
    }
    return value;
  };
  // Painted maps and their attachment changes, once per rendered reservation.
  const paintedMaps = new WeakMap<Node[], Map<string, Node>>();
  const painted = (scene: Scene, reservation: TreeCoordinateReservation) => {
    const nodes = rendered(scene, reservation);
    let map = paintedMaps.get(nodes);
    if (!map) paintedMaps.set(nodes, map = new Map(nodes.map(node => [getNodeId(node), node] as const)));
    return map;
  };
  const shapeChanges = new WeakMap<ReadonlyMap<string, Node>, WeakMap<ReadonlyMap<string, Node>, Map<string, number>>>();
  const attachmentChanges = (before: ReadonlyMap<string, Node>, after: ReadonlyMap<string, Node>) => {
    let byAfter = shapeChanges.get(before);
    if (!byAfter) shapeChanges.set(before, byAfter = new WeakMap());
    let changes = byAfter.get(after);
    if (!changes) byAfter.set(after, changes = attachmentShapeChanges(before, after));
    return changes;
  };
  const stableMotion = ({ candidate, baseline, mode }: PlanCheck, includeRelationReflow = false) => scenes.every((scene, index) => {
    if (!index) return true;
    const before = scenes[index - 1];
    const previous = painted(before, candidate.get(before.canvas)!);
    const baselineBefore = painted(before, baseline.get(before.canvas)!);
    const baselineAfter = painted(scene, baseline.get(scene.canvas)!);
    const currentPositions = painted(scene, candidate.get(scene.canvas)!);
    const priorAttachments = attachmentChanges(baselineBefore, baselineAfter);
    const currentAttachments = attachmentChanges(previous, currentPositions);
    if ([...currentAttachments].some(([pair, change]) => change > (priorAttachments.get(pair) ?? 0) + 1e-6)) return false;
    const lowerWitnesses = movementParticipants(before, scene);
    const joiningHosts = mode === 'lifetime' ? rigidMovementHosts(scene.step, before.nodes, scene.nodes, previous, currentPositions) : new Set<string>();
    return [...currentPositions.values()].every(node => {
      const id = getNodeId(node), moved = previous.get(id);
      if (!moved) return true;
      const { topology, mergeParticipant, regrown } = exemption(before, scene, id);
      if (topology) return true;
      if (mode === 'lifetime') {
        // The exact lower occurrence participates in its movement moment even
        // when it remains pronounced. Earlier trajectories grant no exception.
        if (lowerWitnesses.has(id) || joiningHosts.has(id) || mergeParticipant) return true;
        if (regrown && Math.abs(node.y - moved.y) < 1e-6) return true;
      }
      const priorMotion = Math.hypot(baselineAfter.get(id)!.x - baselineBefore.get(id)!.x,
        baselineAfter.get(id)!.y - baselineBefore.get(id)!.y);
      return !includeRelationReflow && scene.step.replayKind === 'relation' && priorMotion > 1e-6
        || Math.hypot(node.x - moved.x, node.y - moved.y) <= priorMotion + 1e-6;
    });
  });
  // Validate the assembled cohort, including labels, words and native branches.
  // An individually valid component can still collide with another reservation.
  function ink(scene: Scene, reservation: TreeCoordinateReservation, includeSiblings = false) {
    const cache = inkCaches[Number(includeSiblings)];
    let reservations = cache.get(scene);
    if (!reservations) cache.set(scene, reservations = new WeakMap());
    if (reservations.has(reservation)) return reservations.get(reservation)!;
    const result = calculateInk(scene, reservation, includeSiblings);
    reservations.set(reservation, result);
    return result;
  }
  function calculateInk(scene: Scene, reservation: TreeCoordinateReservation, includeSiblings = false) {
    const nodes = rendered(scene, reservation);
    const included = new Set(nodes), positions = new Set<string>();
    for (const node of nodes) {
      const key = `${node.x.toFixed(6)},${node.y.toFixed(6)}`;
      if (positions.has(key) || (included.has(node.parent!) && node.y <= node.parent!.y)) return null;
      positions.add(key);
      const children = (node.children ?? []).filter(child => included.has(child));
      if (children.slice(1).some((child, index) => direction === 'rtl'
        ? children[index].x <= child.x : children[index].x >= child.x)) return null;
    }
    const visibleNodes = new Map(nodes.map(node => [getNodeId(node), node]));
    const rectangles = new Map<string, ReturnType<typeof treeInkObstacles>>();
    const rects = (node: Node) => {
      const id = getNodeId(node);
      let cached = rectangles.get(id);
      if (!cached) rectangles.set(id, cached = sceneTreeInk(scene).obstacles(visibleComponentNodes(node, visibleNodes), includeSiblings));
      return cached;
    };
    const indexes = new Map<Node, ReturnType<typeof verticalObstacleIndex<ReturnType<typeof treeInkObstacles>[number]>>>();
    const indexFor = (node: Node) => {
      let index = indexes.get(node);
      if (!index) indexes.set(node, index = verticalObstacleIndex(rects(node), { overlapOnly: true }));
      return index;
    };
    const groups = [nodes.filter(node => !included.has(node.parent!))];
    if (includeSiblings) for (const node of nodes) {
      const children = (node.children ?? []).filter(child => included.has(child));
      if (children.length > 1) groups.push(children);
    }
    const overlaps = new Map<string, number>();
    for (const components of groups) for (let i = 0; i < components.length; i++) for (let j = i + 1; j < components.length; j++) {
      // Only pairs overlapping on both axes add area.
      const extent = extentOverlap(obstacleExtent(rects(components[i])), obstacleExtent(rects(components[j])));
      if (extent.x <= 0 || extent.y <= 0) continue;
      let area = 0;
      const query = indexFor(components[j]);
      for (const a of rects(components[i])) query(a, b => {
        const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (h <= 0) return false;
        const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        if (w > 0 && (!a.curve || cubicIntersectsRect(a.curve, b, a.curvePadding!))
          && (!b.curve || cubicIntersectsRect(b.curve, a, b.curvePadding!))) area += w * h;
        return false;
      });
      if (area) overlaps.set(JSON.stringify([getNodeId(components[i]), getNodeId(components[j])].sort()), area);
    }
    return overlaps;
  }
  function finalShapesUnchanged(proposed: Reservations, accepted: Reservations) {
    const scene = scenes.at(-1)!;
    const before = new Map(rendered(scene, accepted.get(scene.canvas)!).map(node => [getNodeId(node), node]));
    const after = new Map(rendered(scene, proposed.get(scene.canvas)!).map(node => [getNodeId(node), node]));
    return [...after.values()].filter(node => !visibleParentId(node, after)).every(root => {
      const oldRoot = before.get(getNodeId(root))!;
      return visibleComponentNodes(root, after).every(node => {
        const old = before.get(getNodeId(node))!;
        return Math.hypot(node.x - root.x - (old.x - oldRoot.x), node.y - root.y - (old.y - oldRoot.y)) <= 1e-6;
      });
    });
  };
  const completedRootsDoNotWiden = (proposed: Reservations, accepted: Reservations) => scenes.every(scene => {
    if (scene.step.replayKind !== 'macro') return true;
    const before = new Map(rendered(scene, accepted.get(scene.canvas)!).map(node => [getNodeId(node), node]));
    const after = new Map(rendered(scene, proposed.get(scene.canvas)!).map(node => [getNodeId(node), node]));
    const width = (nodes: readonly Node[]) => Math.max(...nodes.map(node => node.x)) - Math.min(...nodes.map(node => node.x));
    return [...before.values()].filter(node => !visibleParentId(node, before)).every(root => {
      const members = visibleComponentNodes(root, before);
      return width(members.map(node => after.get(getNodeId(node))!)) <= width(members) + 1e-6;
    });
  });
  const safe = ({ candidate, baseline, mode }: PlanCheck) => finalShapesUnchanged(candidate, baseline)
    && stableMotion({ candidate, baseline, mode }) && scenes.every(scene => {
    const next = candidate.get(scene.canvas)!, prior = baseline.get(scene.canvas)!;
    if ([...next].every(([id, p]) => p.x === prior.get(id)?.x && p.y === prior.get(id)?.y)) return true;
    if (mode === 'lifetime') {
      const beforeNodes = new Map(rendered(scene, prior).map(node => [getNodeId(node), node]));
      const afterNodes = new Map(rendered(scene, next).map(node => [getNodeId(node), node]));
      for (const node of afterNodes.values()) {
        const children = visibleChildIds(node, afterNodes);
        if (children.length < 2) continue;
        const span = (nodes: ReadonlyMap<string, Node>) => {
          const rows = children.map(id => nodes.get(id)!.y);
          return Math.max(...rows) - Math.min(...rows);
        };
        if (span(afterNodes) > span(beforeNodes) + 1e-6) return false;
      }
    }
    const after = ink(scene, next, mode === 'lifetime'), before = ink(scene, prior, mode === 'lifetime');
    return after && before && [...after].every(([pair, area]) => area <= (before.get(pair) ?? 0) + 1e-6);
  });
  if (!safe({ candidate, baseline, mode: 'attachment' })) {
    // A compact lower copy can leave too little room for its earlier full form.
    // In that case reserve the existing component shape instead.
    candidate = compute({ allowOrdinary: true, progressive: true }, baseline);
    if (!safe({ candidate, baseline, mode: 'attachment' })) {
      // A later movement changes the parent's center and the sister's width.
      // Reserve the earlier full source by its current sister clearance only
      // when neither established plan can preserve the workspace safely.
      candidate = compute({ allowOrdinary: true, progressive: true, preserveShape: false, preserveSourceClearance: true }, baseline);
      if (!stableMotion({ candidate, baseline, mode: 'attachment' }, true) || !safe({ candidate, baseline, mode: 'attachment' })) candidate = baseline;
    }
  }
  const rememberCoherent = (coherent: ReturnType<typeof planCoherentWorkspace>) => {
    let diagnostics = coherentDiagnostics.get(steps);
    if (!diagnostics) coherentDiagnostics.set(steps, diagnostics = new Map());
    diagnostics.set(JSON.stringify([metricKey, key]), { ...coherent.diagnostic, direction });
    plans.set(key, coherent.coordinates);
    return coherent.coordinates;
  };
  // The coherent solve preserves current contours and motion ownership. Merge
  // participants may still exchange sides, so check their construction order
  // before accepting a resolved plan.
  const directInput = candidate;
  const direct = planCoherentWorkspace({ scenes, baseline: directInput, direction, render: rendered, minimumSiblingGap, metrics: {
    measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel,
  } });
  const seeds = workspaceComponentLifetimeSeeds(scenes, direct.coordinates, rendered,
    direct.diagnostic.status === 'resolved' ? 'merge-order' : 'all');
  if (direct.diagnostic.status === 'resolved' && !seeds.some(seed => seed.attachment === 'order')) return rememberCoherent(direct);

  // The attachment strategies above do not cover components that stay loose,
  // or a stage opened by selection before a relation performs the attachment.
  // Only reserve a component lifetime when the already accepted plan actually
  // reflows a complete unchanged component.
  baseline = candidate = direct.coordinates;
  for (const seed of seeds) {
    const before = scenes[seed.index - 1], after = scenes[seed.index];
    const earlier = new Map(rendered(before, baseline.get(before.canvas)!).map(node => [getNodeId(node), node]));
    const later = new Map(rendered(after, baseline.get(after.canvas)!).map(node => [getNodeId(node), node]));
    const resolved = (before: ReadonlyMap<string, Node>, after: ReadonlyMap<string, Node>) => {
      if (seed.attachment === 'order') {
        const wrapper = after.get(seed.rootId)!;
        return (wrapper.children ?? []).filter(child => before.has(getNodeId(child))).every(child =>
          visibleComponentNodes(before.get(getNodeId(child))!, before).every(member =>
            Math.abs(after.get(getNodeId(member))!.x - member.x) <= 1e-6));
      }
      if (seed.attachment !== 'shape') return workspaceComponentIsStationary(before, after, seed.rootId);
      const old = before.get(seed.rootId)!, current = after.get(seed.rootId)!;
      return visibleComponentNodes(old, before).every(member => {
        const next = after.get(getNodeId(member))!;
        return Math.hypot(next.x - current.x - (member.x - old.x), next.y - current.y - (member.y - old.y)) <= 1e-6;
      });
    };
    if (resolved(earlier, later)) continue;
    const reserveLifetime = prepareComponentLifetimeReservations(scenes, baseline, direction, seed.index, seed.rootId, rendered);
    for (const attempt of lifetimeAttempts) {
      // An order seed is the new complete join; it has no earlier shape to retain.
      if (seed.attachment === 'order' && attempt.kind === 'retain') continue;
      candidate = attempt.kind === 'retain'
        ? retainUnchangedComponentLifetime(scenes, baseline, direction, seed.index, seed.rootId, rendered)
        : reserveLifetime(attempt.options);
      const reservedBefore = new Map(rendered(before, candidate.get(before.canvas)!).map(node => [getNodeId(node), node]));
      const reservedAfter = new Map(rendered(after, candidate.get(after.canvas)!).map(node => [getNodeId(node), node]));
      if (resolved(reservedBefore, reservedAfter)
        && (seed.attachment !== 'order' || completedRootsDoNotWiden(candidate, baseline))
        && stableMotion({ candidate, baseline, mode: 'lifetime' }, true) && safe({ candidate, baseline, mode: 'lifetime' })) {
        baseline = candidate;
        break;
      }
      candidate = baseline;
    }
  }
  const coherent = candidate === direct.coordinates ? direct : planCoherentWorkspace({ scenes, baseline: candidate, direction, render: rendered, minimumSiblingGap, metrics: {
    measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel,
  } });
  return rememberCoherent(coherent);
}
