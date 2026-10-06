import { verticalObstacleIndex } from './verticalObstacleIndex.ts';
import { stageVerticalGeometry } from './stageVerticalGeometry.ts';
import { planCoherentWorkspace, type CoherentWorkspaceDiagnostic } from './workspaceCoherentPlan.ts';
import { attachmentShapeChanges } from './attachmentShapeChanges.ts';
import { treeLabelMetricKey } from './treeLabelMetricKey.ts';
import type { PreparedTreeLabelRuns, TreeLabelRuns, TreeLabelMeasure } from './treeLabelRuns.ts';
import { categoryMetricKey } from './categoryMetricKey.ts';
import { treeInkMetricKey } from './treeInkMetricKey.ts';
import { treeInkObstacles, type TreeInkTextMeasure } from './treeInkGeometry.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import { cubicIntersectsRect } from './relations/curveClearance.ts';
import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { PlaybackStep } from './replayCompiler.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { layoutSyntaxTree, type TreeCoordinateReservation, type TreeDirection } from './treeLayout.ts';
import { retainCurrentRootFork } from './currentRootFork.ts';
import { retainCurrentSiblingRanks } from './currentSiblingRanks.ts';
import { sourceSiblingTranslation, unchangedSourceRankOffsets } from './sourceSiblingTranslation.ts';
import { visibleComponentNodes } from './visibleComponent.ts';
import { rigidMovementHosts } from './movementHostContinuity.ts';
import { workspaceComponentIsStationary, workspaceComponentLifetimeSeeds, prepareComponentLifetimeReservations, retainUnchangedComponentLifetime, type ComponentLifetimeOptions } from './workspaceComponentLifetime.ts';

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
type Scene = {
  measureCategoryText?: CategoryTextMeasure;
  measureTreeInk?: TreeInkTextMeasure;
  treeLabelRuns?: ReadonlyMap<string, readonly TreeLabelRuns[]>;
  measureTreeLabel?: TreeLabelMeasure;
  step: PlaybackStep;
  canvas: SyntaxNode;
  size: [number, number];
  currentRowHeight: number;
  nodes: Map<string, Node>;
  coordinates: TreeCoordinateReservation;
};

const cache = new WeakMap<readonly PlaybackStep[], Map<string, Map<string, Reservations>>>();
const coherentDiagnostics = new WeakMap<readonly PlaybackStep[], Map<string, CoherentWorkspaceDiagnostic & { direction: TreeDirection }>>();
export const getCoherentWorkspaceDiagnostics = (steps: readonly PlaybackStep[]) => [...(coherentDiagnostics.get(steps)?.values() ?? [])];
const parentId = (node: Node, nodes: ReadonlyMap<string, Node>): string | undefined => {
  const parent = node.parent;
  return parent && nodes.has(getNodeId(parent)) && parent.data.replayOrigin?.kind !== 'workspace'
    && !parent.data.replayLayoutOnly ? getNodeId(parent) : undefined;
};
const childrenOf = (node: Node, nodes: ReadonlyMap<string, Node>) =>
  (node.children ?? []).filter(child => nodes.has(getNodeId(child))).map(getNodeId);

function lowerWitnesses(step: PlaybackStep): Map<string, string> | null {
  const witnesses = new Map<string, string>();
  for (const link of step.replayRelationLinks ?? []) {
    if (!String(link.authoredRelationKey ?? '').startsWith(`${step.replayFrameIndex}:`)) continue;
    if (!link.priorSourceNodeId || !link.witnessNodeId || link.priorSourceNodeId === link.witnessNodeId) continue;
    const old = witnesses.get(link.priorSourceNodeId);
    if (old && old !== link.witnessNodeId) return null;
    witnesses.set(link.priorSourceNodeId, link.witnessNodeId);
  }
  return witnesses;
}

/** Reserve a component whose first attachment preserves its child lists.
 * Ordinary construction reserves the attachment layout before the component
 * appears. If that cannot fit its earlier source, retain the component shape
 * through its first attachment stage. A relation keeps the source in its old parent;
 * the source's old place belongs only to its exact lower witness.
 * No syntax, branch ranks, pronunciation or relation timing is added here. */
export function reserveWorkspaceAttachments(
  steps: readonly PlaybackStep[], sizes: ReadonlyMap<number, [number, number]>, direction: TreeDirection,
  coordinatesForStage: (stage: number, size: [number, number]) => Reservations, measureCategoryText?: CategoryTextMeasure,
  measureTreeInk?: TreeInkTextMeasure, treeLabelRuns?: PreparedTreeLabelRuns,
  measureTreeLabel?: TreeLabelMeasure
): Reservations {
  const stageSizes = [...sizes].sort(([a], [b]) => a - b);
  const key = JSON.stringify([direction, stageSizes]);
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
  const stageRows = new Map(stageSizes.map(([stage, size]) => [stage,
    stageVerticalGeometry(orderedSteps.filter(step => step.replayFrameIndex === stage), size[1]).rowHeight]));
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
    const roots = (scene: Scene) => [...scene.nodes.values()].filter(node => !parentId(node, scene.nodes));
    const earlier = roots(prior), later = roots(next);
    // A new parent must not relayout an already complete daughter. Its whole
    // component qualifies, including a clause whose root attaches at this step.
    earlier.filter(node => {
      const attached = next.nodes.get(getNodeId(node));
      return attached && parentId(attached, next.nodes);
    }).forEach(node => ordinaryRoots.add(getNodeId(node)));
    const common = earlier.filter(node => later.some(other => getNodeId(other) === getNodeId(node)
      && JSON.stringify(node.data) === JSON.stringify(other.data)));
    common.forEach(node => ordinaryRoots.add(getNodeId(node)));
    const earlierOrder = [...common].sort((a, b) => a.x - b.x).map(getNodeId);
    const laterOrder = [...common].sort((a, b) => next.nodes.get(getNodeId(a))!.x - next.nodes.get(getNodeId(b))!.x).map(getNodeId);
    if (JSON.stringify(earlierOrder) !== JSON.stringify(laterOrder)) {
      common.forEach(node => stableRoots.add(getNodeId(node)));
      earlier.filter(node => !childrenOf(node, prior.nodes).length && parentId(next.nodes.get(getNodeId(node)) ?? node, next.nodes))
        .forEach(node => stableRoots.add(getNodeId(node)));
    }
  }
  // The established side-switch reservation remains the fallback. Complete
  // attachment histories additionally compose each earlier scene backwards,
  // so a prior movement cannot become the new location of the same jump.
  const compute = (allowOrdinary: boolean, base?: Reservations, progressive = false, preserveShape = true, preserveSourceClearance = false) => {
    const output = new Map(scenes.map(scene => [scene.canvas, new Map(base?.get(scene.canvas) ?? scene.coordinates)]));
    for (let boundary = 1; boundary < scenes.length; boundary++) {
      const before = scenes[boundary - 1], after = scenes[boundary];
      const positioned = (scene: Scene): Map<string, Node> => {
        const root = d3.hierarchy(scene.canvas); applyVizIds(root);
        const visible = new Set(scene.nodes.keys());
        return new Map<string, Node>(layoutSyntaxTree(root, scene.size, direction, output.get(scene.canvas), visible).descendants()
          .filter(node => visible.has(getNodeId(node))).map(node => [getNodeId(node), node] as const));
      };
      const beforeNodes = progressive ? positioned(before) : before.nodes;
      const afterNodes = progressive ? positioned(after) : after.nodes;
      const roots = [...beforeNodes.values()].filter(node => !parentId(node, beforeNodes));
      if (roots.length < 2) continue;
      const witnesses = lowerWitnesses(after.step);
      if (!witnesses) continue;

      for (const root of roots) {
        const rootId = getNodeId(root), attached = afterNodes.get(rootId);
        const legacy = !allowOrdinary && after.step.replayFrameIndex !== before.step.replayFrameIndex
          && after.step.replayKind === 'relation' && root.children?.length;
        const ordinary = allowOrdinary && (progressive ? ordinaryRoots : stableRoots).has(rootId) && after.step.replayKind === 'micro';
        if (!legacy && !ordinary) continue;
        if (witnesses.has(rootId) || !attached || !parentId(attached, after.nodes)) continue;
        const members: Node[] = root.descendants().filter(node => before.nodes.has(getNodeId(node)));
        const ids = new Set<string>(members.map(getNodeId));
        const mapped = (id: string) => witnesses.get(id) ?? id;
        const targetIds = new Set<string>(members.map(node => mapped(getNodeId(node))));
        if (targetIds.size !== ids.size) continue;
        const shapeMatches = members.every(node => {
          const other = after.nodes.get(mapped(getNodeId(node)));
          if (!other) return false;
          const children = childrenOf(node, before.nodes).map(mapped), next = childrenOf(other, after.nodes);
          return children.length === next.length && children.every((id, index) => id === next[index]);
        });
        if (!shapeMatches) continue;
        const dx = attached.x - root.x, dy = attached.y - root.y;
        if (legacy && !ordinary && Math.hypot(dx, dy) < 1e-7) continue;
        const positions: TreeCoordinateReservation = new Map(members.map(node => {
          const future = afterNodes.get(mapped(getNodeId(node)))!;
          return [getNodeId(node), preserveShape ? { x: node.x + dx, y: node.y + dy } : { x: future.x, y: future.y }];
        }));

        const applyLifetime = (start: number, increment: number, useWitnesses: boolean) => {
          const currentIds = new Map(members.map(node => [getNodeId(node), useWitnesses ? mapped(getNodeId(node)) : getNodeId(node)]));
          let lifetimePositions = new Map(positions), referenceNodes = after.nodes;
          for (let index = start; index >= 0 && index < scenes.length; index += increment) {
            const scene = scenes[index];
            if (ordinary && useWitnesses && scene.step.replayFrameIndex !== after.step.replayFrameIndex) break;
            if (progressive && ordinary && useWitnesses) {
              const nextWitnesses = lowerWitnesses(scene.step);
              if (!nextWitnesses) break;
              currentIds.forEach((id, original) => { const witness = nextWitnesses.get(id); if (witness) currentIds.set(original, witness); });
            }
            const memberIds = new Set(currentIds.values());
            const expectedParents = new Map(members.map(node => [currentIds.get(getNodeId(node))!,
              node === root ? (ordinary && useWitnesses ? parentId(attached, after.nodes) : undefined) : currentIds.get(getNodeId(node.parent!))]));
            const present = [...memberIds].filter(id => scene.nodes.has(id));
            if (!present.length) break;
            const compatible = present.every(id => {
              const node = scene.nodes.get(id)!, parent = parentId(node, scene.nodes);
              if (!progressive) return (ordinary && id === rootId ? parent === expectedParents.get(id) : (!parent || id === mapped(rootId) || parent === expectedParents.get(id)))
                && childrenOf(node, scene.nodes).every(child => memberIds.has(child));
              return ordinary && !useWitnesses
                ? (!parent || memberIds.has(parent))
                : (!parent || id === currentIds.get(rootId) || parent === expectedParents.get(id))
                  && (ordinary || childrenOf(node, scene.nodes).every(child => memberIds.has(child)));
            });
            if (!compatible) break;
            const coordinates = new Map(output.get(scene.canvas)!);
            const relocated = new Set<string>();
            if (progressive && ordinary && !useWitnesses) for (const id of present) {
              const node = scene.nodes.get(id)!, future = referenceNodes.get(id), parent = parentId(node, scene.nodes);
              if (parent && future && !future.ancestors().some(ancestor => getNodeId(ancestor) === parent)) {
                node.each(descendant => relocated.add(getNodeId(descendant)));
              }
            }
            for (const [oldId, position] of lifetimePositions) {
              const id = currentIds.get(oldId)!;
              if (!scene.nodes.has(id) || relocated.has(id)) continue;
              coordinates.set(id, { x: direction === 'rtl' ? scene.size[0] - position.x : position.x, y: position.y });
            }
            // A future landing must not pull a source out of its current parent.
            // Retain its current sister clearance; an identical complete source
            // may also share the reference occurrence's internal rank grid.
            const sourceTranslations = new Map<string, { x: number; y: number } | undefined>();
            const sourceRanks = new Map<string, ReadonlyMap<string, number> | undefined>();
            for (const id of relocated) {
              const node = scene.nodes.get(id);
              const anchor = node?.ancestors().slice(1).find(ancestor => lifetimePositions.has(getNodeId(ancestor)) && !relocated.has(getNodeId(ancestor)));
              const position = anchor && lifetimePositions.get(getNodeId(anchor));
              if (!node || !anchor || !position) continue;
              const movedRoot = node.ancestors().find(current => current.parent === anchor);
              const futureRoot = movedRoot && referenceNodes.get(getNodeId(movedRoot));
              const futureParent = futureRoot?.parent;
              const futurePoint = lifetimePositions.get(id), parentPoint = futureParent && lifetimePositions.get(getNodeId(futureParent));
              const sameBranch = movedRoot && futureRoot && JSON.stringify(childrenOf(movedRoot, scene.nodes)) === JSON.stringify(childrenOf(futureRoot, referenceNodes));
              if (preserveSourceClearance && movedRoot && !sourceTranslations.has(getNodeId(movedRoot))) {
                sourceTranslations.set(getNodeId(movedRoot), sourceSiblingTranslation(
                  movedRoot, anchor, scene.nodes, lifetimePositions, relocated));
              }
              const translation = movedRoot && sourceTranslations.get(getNodeId(movedRoot));
              const x = translation ? node.x + translation.x
                : position.x + (sameBranch && futurePoint && parentPoint ? futurePoint.x - parentPoint.x : node.x - anchor.x);
              if (translation && movedRoot && !sourceRanks.has(getNodeId(movedRoot))) {
                sourceRanks.set(getNodeId(movedRoot), unchangedSourceRankOffsets(
                  movedRoot, scene.nodes, referenceNodes, lifetimePositions));
              }
              const rankOffset = movedRoot && sourceRanks.get(getNodeId(movedRoot))?.get(id);
              const y = translation ? (rankOffset === undefined ? node.y : movedRoot!.y + rankOffset) + translation.y
                : position.y + (sameBranch && futurePoint && parentPoint ? futurePoint.y - parentPoint.y : node.y - anchor.y);
              coordinates.set(id, { x: direction === 'rtl' ? scene.size[0] - x : x, y });
            }
            if (ordinary) {
              if (progressive && !useWitnesses) {
                const current = { nodes: scene.nodes, visible: new Set(scene.nodes.keys()), coordinates };
                const future = { nodes: referenceNodes, visible: new Set(referenceNodes.keys()), coordinates: lifetimePositions };
                // Attachment continuity detaches an unbuilt wrapper from the
                // current tree. Its eventual rank must not leak back through
                // the retained old edge when workspace positions are reserved.
                const pendingWrappers = new Set((scene.canvas.replayOrigin?.kind === 'workspace' ? scene.canvas.children ?? [] : [])
                  .filter(node => node.id && !scene.nodes.has(node.id)).map(node => node.id!));
                if (pendingWrappers.size) retainCurrentSiblingRanks(current, future, undefined, relocated, pendingWrappers);
                retainCurrentRootFork(current, future);
              }
              const hierarchy = d3.hierarchy(scene.canvas); applyVizIds(hierarchy);
              const visible = new Set(scene.nodes.keys());
              const tree = layoutSyntaxTree(hierarchy, scene.size, direction, coordinates, visible);
              const valid = tree.descendants().filter(node => visible.has(getNodeId(node))).every(node => {
                if (node.parent && visible.has(getNodeId(node.parent)) && node.y <= node.parent.y) return false;
                const children = (node.children ?? []).filter(child => visible.has(getNodeId(child)));
                return children.slice(1).every((child, index) => direction === 'rtl'
                  ? children[index].x > child.x : children[index].x < child.x);
              });
              if (!valid) break;
              if (progressive && !useWitnesses) {
                referenceNodes = new Map(tree.descendants().filter(node => visible.has(getNodeId(node))).map(node => [getNodeId(node), node] as const));
                lifetimePositions = new Map([...referenceNodes].filter(([id]) => memberIds.has(id))
                  .map(([id, node]) => [id, { x: node.x, y: node.y }]));
              }
            }
            output.set(scene.canvas, coordinates);
          }
        };
        applyLifetime(boundary - 1, -1, false);
        if (preserveShape) applyLifetime(boundary, 1, true);
      }
    }
    return output;
  };
  const legacy = compute(false);
  const inkCaches = [new WeakMap<Scene, WeakMap<TreeCoordinateReservation, Map<string, number> | null>>(),
    new WeakMap<Scene, WeakMap<TreeCoordinateReservation, Map<string, number> | null>>()];
  let baseline: Reservations = compute(true, legacy);
  let candidate: Reservations = compute(true, baseline, true, false);
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
  if (!finalShapesUnchanged(baseline, legacy) || !attachmentsSafe(baseline, legacy) || !scenes.every(scene => {
    const after = ink(scene, baseline.get(scene.canvas)!), before = ink(scene, legacy.get(scene.canvas)!);
    return after && before && [...after].every(([pair, area]) => area <= (before.get(pair) ?? 0) + 1e-6);
  })) {
    baseline = legacy;
    candidate = compute(true, baseline, true, false);
  }
  // A lifetime can end when its topology changes. Reject a reservation that
  // merely moves a discontinuity to that boundary or to another component.
  let retainingLifetimes = false;
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
      if (!source || !witness || parentId(source, before.nodes) !== parentId(witness, scene.nodes)) continue;
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
  const stableMotion = (includeRelationReflow = false) => scenes.every((scene, index) => {
    if (!index) return true;
    const before = scenes[index - 1];
    const previous = new Map(rendered(before, candidate.get(before.canvas)!).map(node => [getNodeId(node), node] as const));
    const baselineBefore = new Map(rendered(before, baseline.get(before.canvas)!).map(node => [getNodeId(node), node] as const));
    const baselineAfter = new Map(rendered(scene, baseline.get(scene.canvas)!).map(node => [getNodeId(node), node] as const));
    const currentPositions = new Map(rendered(scene, candidate.get(scene.canvas)!).map(node => [getNodeId(node), node]));
    const priorAttachments = attachmentShapeChanges(baselineBefore, baselineAfter);
    const currentAttachments = attachmentShapeChanges(previous, currentPositions);
    if ([...currentAttachments].some(([pair, change]) => change > (priorAttachments.get(pair) ?? 0) + 1e-6)) return false;
    const lowerWitnesses = movementParticipants(before, scene);
    const joiningHosts = retainingLifetimes ? rigidMovementHosts(scene.step, before.nodes, scene.nodes, previous, currentPositions) : new Set<string>();
    return [...currentPositions.values()].every(node => {
      const id = getNodeId(node), original = scene.nodes.get(id)!, prior = before.nodes.get(id), moved = previous.get(id);
      if (!prior || !moved || parentId(original, scene.nodes) !== parentId(prior, before.nodes)
        || JSON.stringify(childrenOf(original, scene.nodes)) !== JSON.stringify(childrenOf(prior, before.nodes))) return true;
      if (scene.step.replayKind === 'relation' && visibleAncestors(prior, before.nodes).some(ancestor =>
        before.nodes.has(getNodeId(ancestor)) && ancestor.data.replayOrigin?.kind !== 'workspace'
        && !visibleAncestors(original, scene.nodes).some(current => getNodeId(current) === getNodeId(ancestor)))) return true;
      if (retainingLifetimes) {
        // The exact lower occurrence participates in its movement moment even
        // when it remains pronounced. Earlier trajectories grant no exception.
        if (lowerWitnesses.has(id) || joiningHosts.has(id)) return true;
        // The merge participants can translate when they join. Unrelated
        // components and relation-only scenes still obey the motion guard.
        if (scene.step.replayKind === 'micro' && scene.step.operation === 'ExternalMerge'
          && visibleAncestors(original, scene.nodes).some(ancestor => getNodeId(ancestor) === scene.step.targetNodeId)) return true;
        // A branch centers over its actual daughters after internal growth.
        // Its unchanged descendants remain independently constrained below.
        const changedSubtree = visibleComponentNodes(original, scene.nodes).some(child => {
          const old = before.nodes.get(getNodeId(child));
          return !old || child.data.label !== old.data.label || child.data.word !== old.data.word
            || child.data.silent !== old.data.silent || JSON.stringify(childrenOf(child, scene.nodes)) !== JSON.stringify(childrenOf(old, before.nodes));
        });
        if (childrenOf(original, scene.nodes).length && changedSubtree
          && Math.abs(node.y - moved.y) < 1e-6) return true;
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
      if (!cached) rectangles.set(id, cached = treeInkObstacles(visibleComponentNodes(node, visibleNodes), measureCategoryText, measureTreeInk, includeSiblings, scene.treeLabelRuns, scene.measureTreeLabel));
      return cached;
    };
    const indexes = new Map<Node, ReturnType<typeof verticalObstacleIndex<ReturnType<typeof treeInkObstacles>[number]>>>();
    const indexFor = (node: Node) => {
      let index = indexes.get(node);
      if (!index) indexes.set(node, index = verticalObstacleIndex(rects(node)));
      return index;
    };
    const groups = [nodes.filter(node => !included.has(node.parent!))];
    if (includeSiblings) for (const node of nodes) {
      const children = (node.children ?? []).filter(child => included.has(child));
      if (children.length > 1) groups.push(children);
    }
    const overlaps = new Map<string, number>();
    for (const components of groups) for (let i = 0; i < components.length; i++) for (let j = i + 1; j < components.length; j++) {
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
  function finalShapesUnchanged(proposed: Reservations = candidate, accepted: Reservations = baseline) {
    const scene = scenes.at(-1)!;
    const before = new Map(rendered(scene, accepted.get(scene.canvas)!).map(node => [getNodeId(node), node]));
    const after = new Map(rendered(scene, proposed.get(scene.canvas)!).map(node => [getNodeId(node), node]));
    return [...after.values()].filter(node => !parentId(node, after)).every(root => {
      const oldRoot = before.get(getNodeId(root))!;
      return visibleComponentNodes(root, after).every(node => {
        const old = before.get(getNodeId(node))!;
        return Math.hypot(node.x - root.x - (old.x - oldRoot.x), node.y - root.y - (old.y - oldRoot.y)) <= 1e-6;
      });
    });
  };
  const safe = () => finalShapesUnchanged() && stableMotion() && scenes.every(scene => {
    const next = candidate.get(scene.canvas)!, prior = baseline.get(scene.canvas)!;
    if ([...next].every(([id, p]) => p.x === prior.get(id)?.x && p.y === prior.get(id)?.y)) return true;
    if (retainingLifetimes) {
      const beforeNodes = new Map(rendered(scene, prior).map(node => [getNodeId(node), node]));
      const afterNodes = new Map(rendered(scene, next).map(node => [getNodeId(node), node]));
      for (const node of afterNodes.values()) {
        const children = childrenOf(node, afterNodes);
        if (children.length < 2) continue;
        const span = (nodes: ReadonlyMap<string, Node>) => {
          const rows = children.map(id => nodes.get(id)!.y);
          return Math.max(...rows) - Math.min(...rows);
        };
        if (span(afterNodes) > span(beforeNodes) + 1e-6) return false;
      }
    }
    const after = ink(scene, next, retainingLifetimes), before = ink(scene, prior, retainingLifetimes);
    return after && before && [...after].every(([pair, area]) => area <= (before.get(pair) ?? 0) + 1e-6);
  });
  if (!safe()) {
    // A compact lower copy can leave too little room for its earlier full form.
    // In that case reserve the existing component shape instead.
    candidate = compute(true, baseline, true);
    if (!safe()) {
      // A later movement changes the parent's center and the sister's width.
      // Reserve the earlier full source by its current sister clearance only
      // when neither established plan can preserve the workspace safely.
      candidate = compute(true, baseline, true, false, true);
      if (!stableMotion(true) || !safe()) candidate = baseline;
    }
  }
  const rememberCoherent = (coherent: ReturnType<typeof planCoherentWorkspace>) => {
    let diagnostics = coherentDiagnostics.get(steps);
    if (!diagnostics) coherentDiagnostics.set(steps, diagnostics = new Map());
    diagnostics.set(JSON.stringify([metricKey, key]), { ...coherent.diagnostic, direction });
    plans.set(key, coherent.coordinates);
    return coherent.coordinates;
  };
  // A complete solve validates every current contour and temporal constraint.
  // Only a resolved plan can bypass the older per-component repair attempts.
  const directInput = candidate;
  const direct = planCoherentWorkspace(scenes, directInput, direction, rendered, {
    measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel,
  });
  if (direct.diagnostic.status === 'resolved') return rememberCoherent(direct);

  // The attachment strategies above do not cover components that stay loose,
  // or a stage opened by selection before a relation performs the attachment.
  // Only reserve a component lifetime when the already accepted plan actually
  // reflows a complete unchanged component.
  baseline = candidate;
  retainingLifetimes = true;
  for (const seed of workspaceComponentLifetimeSeeds(scenes, baseline, rendered)) {
    const before = scenes[seed.index - 1], after = scenes[seed.index];
    const earlier = new Map(rendered(before, baseline.get(before.canvas)!).map(node => [getNodeId(node), node]));
    const later = new Map(rendered(after, baseline.get(after.canvas)!).map(node => [getNodeId(node), node]));
    const resolved = (before: ReadonlyMap<string, Node>, after: ReadonlyMap<string, Node>) => {
      if (!seed.attachment) return workspaceComponentIsStationary(before, after, seed.rootId);
      const old = before.get(seed.rootId)!, current = after.get(seed.rootId)!;
      return visibleComponentNodes(old, before).every(member => {
        const next = after.get(getNodeId(member))!;
        return Math.hypot(next.x - current.x - (member.x - old.x), next.y - current.y - (member.y - old.y)) <= 1e-6;
      });
    };
    if (resolved(earlier, later)) continue;
    const reserveLifetime = prepareComponentLifetimeReservations(scenes, baseline, direction, seed.index, seed.rootId, rendered);
    for (const attempt of lifetimeAttempts) {
      candidate = attempt.kind === 'retain'
        ? retainUnchangedComponentLifetime(scenes, baseline, direction, seed.index, seed.rootId, rendered)
        : reserveLifetime(attempt.options);
      const reservedBefore = new Map(rendered(before, candidate.get(before.canvas)!).map(node => [getNodeId(node), node]));
      const reservedAfter = new Map(rendered(after, candidate.get(after.canvas)!).map(node => [getNodeId(node), node]));
      if (resolved(reservedBefore, reservedAfter)
        && stableMotion(true) && safe()) {
        baseline = candidate;
        break;
      }
      candidate = baseline;
    }
  }
  const coherent = candidate === directInput ? direct : planCoherentWorkspace(scenes, candidate, direction, rendered, {
    measureCategoryText, measureTreeInk, treeLabelRuns, measureTreeLabel,
  });
  return rememberCoherent(coherent);
}
