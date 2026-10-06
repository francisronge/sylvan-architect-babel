import { cubicIntersectsRect } from './relations/curveClearance.ts';
import { verticalObstacleIndex } from './verticalObstacleIndex.ts';
import type { TreeLabelRuns, TreeLabelMeasure } from './treeLabelRuns.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import { treeInkObstacles, type TreeInkTextMeasure } from './treeInkGeometry.ts';
import { authoredDisplayWord } from './displayWordMaterial.ts';
import { addsOwnedDisplayTerminal } from './workspaceDisplayTerminal.ts';
import type * as d3 from 'd3';
import { plaqueTreeObstacles, plaqueBranchObstacles } from './relations/plaquePlacement.ts';
import type { SyntaxNode } from '../types.ts';
import type { PlaybackStep } from './replayCompiler.ts';
import { getNodeId } from './displayIdentity.ts';
import { visibleComponentNodes } from './visibleComponent.ts';
import type { TreeCoordinateReservation, TreeDirection } from './treeLayout.ts';

type Node = d3.HierarchyPointNode<SyntaxNode>;
type Position = { x: number; y: number };
type HorizontalInterval = { low: number; high: number };
type Obstacle = ReturnType<typeof plaqueTreeObstacles>[number];

export type WorkspacePlacementScene = {
  measureCategoryText?: CategoryTextMeasure;
  measureTreeInk?: TreeInkTextMeasure;
  treeLabelRuns?: ReadonlyMap<string, readonly TreeLabelRuns[]>;
  measureTreeLabel?: TreeLabelMeasure;
  step: PlaybackStep;
  canvas: SyntaxNode;
  size: [number, number];
  nodes: Map<string, Node>;
  coordinates: TreeCoordinateReservation;
};
export type WorkspaceReservations = ReadonlyMap<SyntaxNode, TreeCoordinateReservation>;
type Render = (scene: WorkspacePlacementScene, coordinates: TreeCoordinateReservation) => readonly Node[];

const parent = (node: Node, nodes: ReadonlyMap<string, Node>) =>
  node.parent && nodes.has(getNodeId(node.parent)) ? getNodeId(node.parent) : undefined;
const material = (node: Node, nodes: ReadonlyMap<string, Node>): unknown[] => {
  const owner = node.parent && nodes.has(getNodeId(node.parent)) ? node.parent.data : undefined;
  const word = authoredDisplayWord(node.data, owner);
  return [word ?? node.data.label, word ?? node.data.word, node.data.silent,
    (node.children ?? []).filter(child => nodes.has(getNodeId(child)))
      .map(child => [getNodeId(child), material(child, nodes)])];
};
const signature = (node: Node, nodes: ReadonlyMap<string, Node>): string => JSON.stringify(material(node, nodes));

function positioned(scene: WorkspacePlacementScene, coordinates: WorkspaceReservations, render: Render): Map<string, Node> {
  return new Map(render(scene, coordinates.get(scene.canvas)!).map(node => [getNodeId(node), node]));
}

/** Horizontal translations that would overlap ink at a shared vertical range. */
function appendForbiddenShifts(intervals: HorizontalInterval[], own: readonly Obstacle[], other: readonly Obstacle[]) {
  const visitOverlapping = verticalObstacleIndex(other);
  for (const a of own) visitOverlapping(a, b => {
    if (!(Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y)))
      intervals.push({ low: b.x - a.x - a.width, high: b.x + b.width - a.x });
    return false;
  });
}

export function minimumClearanceShift(intervals: HorizontalInterval[]): number | undefined {
  // A connected interval union cannot cover zero unless one input contains
  // it or touches it. Keep touching intervals for the ordinary merge below.
  if (!intervals.some(interval => interval.low <= 0 && interval.high >= 0)) return undefined;
  intervals.sort((a, b) => a.low - b.low);
  const merged: HorizontalInterval[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.low <= previous.high) previous.high = Math.max(previous.high, interval.high);
    else merged.push({ ...interval });
  }
  const blocked = merged.find(interval => interval.low < 0 && interval.high > 0);
  return blocked ? (Math.abs(blocked.low) < Math.abs(blocked.high) ? blocked.low - 1 : blocked.high + 1) : undefined;
}

function translateReservation(
  output: Map<SyntaxNode, TreeCoordinateReservation>, canvas: SyntaxNode,
  ids: Iterable<string>, dx: number, direction: TreeDirection
) {
  const previous = output.get(canvas)!;
  let coordinates = previous;
  for (const id of ids) {
    const point = coordinates.get(id)!;
    const x = point.x + (direction === 'rtl' ? -dx : dx);
    // Retain an unchanged reservation's render-cache identity. Signed zero
    // still follows the original addition rather than a dx === 0 shortcut.
    if (Object.is(x, point.x)) continue;
    if (coordinates === previous) coordinates = new Map(previous);
    coordinates.set(id, { ...point, x });
  }
  if (coordinates !== previous) output.set(canvas, coordinates);
}

type ReservedSourceMembers = Map<SyntaxNode, Set<string>>;

/** One source slot must clear every current contour it meets before movement.
 * The backward reservation supplies exact members, including its construction
 * steps and prior source forms; future or unrelated material never enters it. */
function clearReservedSourceHistory(
  scenes: readonly WorkspacePlacementScene[], output: Map<SyntaxNode, TreeCoordinateReservation>,
  direction: TreeDirection, render: Render, sourceMembers: ReservedSourceMembers
) {
  const intervals: HorizontalInterval[] = [];
  for (const scene of scenes) {
    const owned = sourceMembers.get(scene.canvas);
    if (!owned) continue;
    const current = positioned(scene, output, render);
    const own = [...current.values()].filter(node => owned.has(getNodeId(node)));
    const other = [...current.values()].filter(node => !owned.has(getNodeId(node)));
    if (!own.length || !other.length) continue;
    appendForbiddenShifts(intervals,
      treeInkObstacles(own, scene.measureCategoryText, scene.measureTreeInk, false, scene.treeLabelRuns, scene.measureTreeLabel),
      treeInkObstacles(other, scene.measureCategoryText, scene.measureTreeInk, false, scene.treeLabelRuns, scene.measureTreeLabel));
  }
  const clearance = minimumClearanceShift(intervals);
  if (clearance === undefined) return;
  for (const [canvas, owned] of sourceMembers) translateReservation(output, canvas, owned, clearance, direction);
}

type VerticalGrid = { scale: number; offset: number };

/** A second current rank establishes spacing; every other witness must agree. */
function verticalGrid(samples: readonly { before: number; after: number }[]): VerticalGrid | undefined {
  const a = samples[0], b = a && samples.find(point => Math.abs(point.before - a.before) > 1e-6);
  if (!a || !b) return;
  const scale = (b.after - a.after) / (b.before - a.before);
  const offset = a.after - scale * a.before;
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(offset)
    || samples.some(point => Math.abs(point.after - (scale * point.before + offset)) > 1e-6)) return;
  return { scale, offset };
}

/** A compact lower witness cannot set the preceding full source's rank grid.
 * Its unchanged current sister, possibly above its parent, retains that grid.
 * Read the complete reference, not partially reserved earlier siblings. */
function precedingSiblingGrid(
  source: Node, prior: WorkspacePlacementScene, entry: WorkspacePlacementScene,
  origin: ReadonlyMap<string, Node>, current: ReadonlyMap<string, Position>
): VerticalGrid | undefined {
  for (let branch = source; branch.parent && prior.nodes.has(getNodeId(branch.parent)); branch = branch.parent) {
    for (const sister of branch.parent.children ?? []) {
      const id = getNodeId(sister), next = entry.nodes.get(id);
      if (sister === branch || !prior.nodes.has(id) || !next
        || parent(sister, prior.nodes) !== parent(next, entry.nodes)
        || signature(sister, prior.nodes) !== signature(next, entry.nodes)) continue;
      const members = visibleComponentNodes(sister, prior.nodes);
      if (members.some(node => !current.has(getNodeId(node)))) continue;
      const grid = verticalGrid(members.map(node => ({
        before: origin.get(getNodeId(node))!.y, after: current.get(getNodeId(node))!.y
      })));
      if (grid) return grid;
    }
  }
}

/** Complete partial reservations on one current grid without changing their
 * horizontal placement. A containing conflict may leave an earlier independent
 * component with its own consistent grid; unrelated fragments cannot supply one. */
function reconcileComponentRanks(
  scenes: readonly WorkspacePlacementScene[], output: Map<SyntaxNode, TreeCoordinateReservation>,
  base: WorkspaceReservations, first: number, last: number, render: Render,
  reserve: (end: number, id: string, reference: ReadonlyMap<string, Position>) => void
) {
  for (let index = first; index <= last; index++) {
    const scene = scenes[index], initial = positioned(scene, base, render), candidate = positioned(scene, output, render);
    const coordinates = new Map(output.get(scene.canvas)!);
    const wasIndependent = (root: Node) => {
      const id = getNodeId(root), shape = signature(root, initial);
      for (let earlier = index - 1; earlier >= 0; earlier--) {
        const scene = scenes[earlier], previous = scene.nodes.get(id);
        if (!previous || signature(previous, scene.nodes) !== shape) return false;
        if (!parent(previous, scene.nodes)) return true;
      }
      return false;
    };
    const reconcile = (root: Node) => {
      const children = (root.children ?? []).filter(child => initial.has(getNodeId(child)));
      if (parent(root, initial) && !wasIndependent(root)) {
        for (const child of children) reconcile(child);
        return;
      }
      const members = visibleComponentNodes(root, initial);
      const grid = verticalGrid(members.filter(node => Math.abs(candidate.get(getNodeId(node))!.y - node.y) > 1e-6)
        .map(node => ({ before: node.y, after: candidate.get(getNodeId(node))!.y })));
      if (!grid) {
        for (const child of children) reconcile(child);
        return;
      }
      for (const member of members) {
        const id = getNodeId(member), point = coordinates.get(id)!;
        coordinates.set(id, { ...point, y: member.y * grid.scale + grid.offset });
      }
      // A new ordinary wrapper joins complete children. When its coherent grid
      // changes a child's contour, reserve that whole contour before the join.
      const prior = scenes[index - 1];
      if (!prior || scene.step.replayKind !== 'micro'
        || !['Project', 'ExternalMerge'].includes(scene.step.operation)
        || scene.step.targetNodeId !== getNodeId(root) || prior.nodes.has(getNodeId(root))) return;
      for (const child of children) {
        const id = getNodeId(child), old = prior.nodes.get(id);
        if (!old || parent(old, prior.nodes) || signature(old, prior.nodes) !== signature(child, initial)) continue;
        const childMembers = visibleComponentNodes(child, initial);
        const rootY = coordinates.get(id)!.y;
        if (!childMembers.some(member => Math.abs(coordinates.get(getNodeId(member))!.y - rootY - (member.y - child.y)) > 1e-6)) continue;
        reserve(index - 1, id, new Map(childMembers.map(member => {
          const memberId = getNodeId(member), position = candidate.get(memberId)!;
          return [memberId, { x: position.x, y: coordinates.get(memberId)!.y }];
        })));
      }
    };
    for (const root of initial.values()) if (!parent(root, initial)) reconcile(root);
    output.set(scene.canvas, coordinates);
  }
}

/** Preserve the full source contour horizontally; its current sister supplies
 * the vertical grid when a later compact witness uses different spacing. */
function precedingSourcePositions(
  prior: WorkspacePlacementScene, entry: WorkspacePlacementScene,
  sourceId: string, witnessId: string, landingId: string | undefined, reference: ReadonlyMap<string, Position>,
  base: WorkspaceReservations, render: Render
): Map<string, Position> | undefined {
  const source = prior.nodes.get(sourceId), witness = entry.nodes.get(witnessId);
  if (!source || !witness || parent(source, prior.nodes) !== parent(witness, entry.nodes)) return;
  const origin = positioned(prior, base, render);
  const sourcePoint = origin.get(sourceId), witnessPoint = reference.get(witnessId);
  if (!sourcePoint || !witnessPoint) return;
  // An unchanged constituent can keep its descendants when only its occurrence
  // shell changes. Its complete reference contour must survive the movement.
  const landing = landingId && entry.nodes.get(landingId);
  const landingPoint = landingId && reference.get(landingId);
  const sourceMembers = visibleComponentNodes(source, prior.nodes);
  if (landing && landingPoint && landingId !== witnessId
    && signature(source, prior.nodes) === signature(landing, entry.nodes)
    && sourceMembers.every(member => getNodeId(member) === sourceId || reference.has(getNodeId(member)))) {
    return new Map(sourceMembers.map(member => {
      const id = getNodeId(member), point = id === sourceId ? landingPoint : reference.get(id)!;
      return [id, { x: point.x + witnessPoint.x - landingPoint.x, y: point.y + witnessPoint.y - landingPoint.y }];
    }));
  }
  const lowerIds = new Set(visibleComponentNodes(witness, entry.nodes).map(getNodeId));
  const consistent = visibleComponentNodes(source, prior.nodes).flatMap(member => {
    const id = getNodeId(member), current = entry.nodes.get(id), point = reference.get(id), old = origin.get(id);
    return lowerIds.has(id) && current && point && old && parent(member, prior.nodes) === parent(current, entry.nodes)
      && signature(member, prior.nodes) === signature(current, entry.nodes)
      ? [{ dx: point.x - old.x, dy: point.y - old.y }] : [];
  });
  const shift = consistent[0] ?? { dx: witnessPoint.x - sourcePoint.x, dy: witnessPoint.y - sourcePoint.y };
  if (consistent.some(other => Math.hypot(other.dx - shift.dx, other.dy - shift.dy) > 1e-6)) return;
  const { dx, dy } = shift;
  const grid = precedingSiblingGrid(source, prior, entry, origin, reference) ?? { scale: 1, offset: dy };
  const sourceReference = new Map<string, Position>();
  for (const member of visibleComponentNodes(source, prior.nodes)) {
    const id = getNodeId(member), point = origin.get(id)!;
    sourceReference.set(id, { x: point.x + dx, y: point.y * grid.scale + grid.offset });
  }
  return sourceReference;
}

type InkMetrics = Pick<WorkspacePlacementScene, 'measureTreeInk' | 'treeLabelRuns' | 'measureTreeLabel'>;
const placementInk = (nodes: Node[], measure?: CategoryTextMeasure, metrics: InkMetrics = {}) =>
  treeInkObstacles(nodes, measure, metrics.measureTreeInk, false, metrics.treeLabelRuns, metrics.measureTreeLabel);

function ownedInk(nodes: Node[], measure?: CategoryTextMeasure, metrics: InkMetrics = {}): Map<string, Obstacle[]> {
  const result = new Map(nodes.map(node => [getNodeId(node), placementInk([node], measure, metrics)]));
  const included = new Set(nodes);
  for (const node of nodes) {
    if (!node.parent || !included.has(node.parent) || node.data.replayOrigin?.kind === 'workspace'
      || node.parent.data.replayOrigin?.kind === 'workspace') continue;
    // A branch belongs to its child, so moving a different branch cannot cancel
    // a newly introduced overlap with this one.
    result.get(getNodeId(node))!.push(...plaqueBranchObstacles(node.parent, node, true));
  }
  return result;
}

/** Compare the same source/obstacle pair before requesting source clearance. */
export function collisionAreas(own: Node[], other: Node[], measure?: CategoryTextMeasure, metrics: InkMetrics = {}): Map<string, number> {
  const result = new Map<string, number>();
  if (!own.length || !other.length) return result;
  const bounds = (rects: readonly Obstacle[]) => {
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const rect of rects) {
      left = Math.min(left, rect.x); right = Math.max(right, rect.x + rect.width);
      top = Math.min(top, rect.y); bottom = Math.max(bottom, rect.y + rect.height);
    }
    return { left, right, top, bottom };
  };
  // The measured ink is immutable for this comparison. Reject disjoint owners
  // before visiting their individual labels and sampled branch rectangles.
  const sources = ownedInk(own, measure, metrics);
  if (!sources.size) return result;
  const opponents = [...ownedInk(other, measure, metrics)].map(([id, ink]) => ({ id, ink, box: bounds(ink) }));
  for (const [aId, as] of sources) {
    const aBox = bounds(as);
    for (const { id: bId, ink: bs, box: bBox } of opponents) {
      if (aBox.right <= bBox.left || bBox.right <= aBox.left || aBox.bottom <= bBox.top || bBox.bottom <= aBox.top) continue;
      let area = 0;
      for (const a of as) for (const b of bs) {
        const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (width > 0 && height > 0
          && (!a.curve || cubicIntersectsRect(a.curve, b, a.curvePadding!))
          && (!b.curve || cubicIntersectsRect(b.curve, a, b.curvePadding!))) area += width * height;
      }
      if (area) result.set(JSON.stringify([aId, bId]), area);
    }
  }
  return result;
}


/** Place a newly selected source in a clear slot until its material changes. */
function clearNewSources(
  scenes: readonly WorkspacePlacementScene[], output: Map<SyntaxNode, TreeCoordinateReservation>,
  first: number, last: number, direction: TreeDirection, render: Render, base: WorkspaceReservations, reserveProjections = false, carryUntilMovement = false
) {
  for (let index = first; index <= last; index++) {
    const scene = scenes[index];
    const previous = index ? scenes[index - 1].nodes : new Map<string, Node>();
    // Selection eligibility is visible topology, independent of reserved
    // coordinates. Retained-only scenes need no geometry for this phase.
    if (![...scene.nodes.values()].some(node => !parent(node, scene.nodes)
      && visibleComponentNodes(node, scene.nodes).every(member => !previous.has(getNodeId(member))))) continue;
    const nodes = positioned(scene, output, render);
    const roots = [...nodes.values()].filter(node => !parent(node, nodes));
    for (const root of roots) {
      const members = visibleComponentNodes(root, nodes);
      if (members.some(node => previous.has(getNodeId(node)))) continue;
      const lifetime: { scene: WorkspacePlacementScene; members: Node[]; peers?: Node[] }[] = [];
      const intervals: HorizontalInterval[] = [];
      let introducedCollision = false;
      if (!reserveProjections) appendForbiddenShifts(intervals, placementInk(members, scene.measureCategoryText, scene),
        placementInk([...nodes.values()].filter(node => !members.includes(node)), scene.measureCategoryText, scene));
      if (!reserveProjections && minimumClearanceShift(intervals) === undefined) continue;
      for (let next = index; next < scenes.length; next++) {
        const current = scenes[next], at = current.nodes.get(getNodeId(root));
        if (!at || signature(at, current.nodes) !== signature(root, nodes)) break;
        if (next > index) {
          const ancestry = (node: Node, included: ReadonlyMap<string, Node>) => {
            const ids: string[] = [];
            for (let owner = node.parent; owner && included.has(getNodeId(owner)); owner = owner.parent) ids.push(getNodeId(owner));
            return ids;
          };
          const before = scenes[next - 1], earlier = before.nodes.get(getNodeId(root))!;
          const oldChain = ancestry(earlier, before.nodes), newChain = ancestry(at, current.nodes);
          if (JSON.stringify(oldChain) !== JSON.stringify(newChain)) {
            const target = current.step.targetNodeId && current.nodes.get(current.step.targetNodeId);
            const projection = current.step.replayKind === 'micro' && current.step.operation === 'Project'
              && target && !before.nodes.has(getNodeId(target)) && newChain.includes(getNodeId(target))
              && (target.children ?? []).filter(child => current.nodes.has(getNodeId(child))).length === 1
              && JSON.stringify(newChain.filter(id => id !== getNodeId(target))) === JSON.stringify(oldChain);
            const joining = carryUntilMovement && current.step.replayKind === 'micro' && current.step.operation === 'ExternalMerge'
              && target && newChain.includes(getNodeId(target))
              && (target.children ?? []).filter(child => current.nodes.has(getNodeId(child))).length > 1
              && JSON.stringify(newChain.filter(id => id !== getNodeId(target))) === JSON.stringify(oldChain);
            const identity = current.step.replayRelationIdentity;
            const ownKey = identity && `${identity.stageIndex}:${identity.relationIndex}`;
            const inserted = newChain.filter(id => !oldChain.includes(id));
            const movementWrapper = carryUntilMovement && current.step.replayKind === 'relation' && ownKey
              && inserted.length > 0 && inserted.every(id => !before.nodes.has(id))
              && JSON.stringify(newChain.filter(id => !inserted.includes(id))) === JSON.stringify(oldChain)
              && (current.step.replayRelationLinks ?? []).some(link => {
                if (link.authoredRelationKey !== ownKey || link.renderFamily !== 'trajectory' || !link.targetNodeId
                  || !link.priorSourceNodeId || !before.nodes.has(link.priorSourceNodeId)
                  || !link.witnessNodeId || !current.nodes.has(link.witnessNodeId)
                  || link.targetNodeId === link.witnessNodeId) return false;
                const landing = current.nodes.get(link.targetNodeId);
                if (!landing) return false;
                const landingChain = ancestry(landing, current.nodes);
                return inserted.every(id => landingChain.includes(id));
              });
            if (!projection && !joining && !movementWrapper) break;
          }
        }
        const merge = current.step.replayKind === 'micro' && current.step.operation === 'ExternalMerge'
          ? current.nodes.get(current.step.targetNodeId ?? '') : undefined;
        if (carryUntilMovement && next > index && current.step.replayKind === 'relation' && current.step.replayRelationIdentity) {
          const ownKey = `${current.step.replayRelationIdentity.stageIndex}:${current.step.replayRelationIdentity.relationIndex}`;
          if ((current.step.replayRelationLinks ?? []).some(link => {
            if (link.authoredRelationKey !== ownKey || link.renderFamily !== 'trajectory' || !link.priorSourceNodeId
              || !link.witnessNodeId || !current.nodes.has(link.witnessNodeId)
              || !link.targetNodeId || !current.nodes.has(link.targetNodeId)
              || link.targetNodeId === link.witnessNodeId) return false;
            const prior = scenes[next - 1], source = prior.nodes.get(link.priorSourceNodeId);
            return source && visibleComponentNodes(source, prior.nodes).some(member => getNodeId(member) === getNodeId(root));
          })) break;
        }
        if (!carryUntilMovement && merge && visibleComponentNodes(merge, current.nodes).some(node => getNodeId(node) === getNodeId(root))
          && (merge.children ?? []).some(child => current.nodes.has(getNodeId(child))
            && scenes[next - 1]?.nodes.has(getNodeId(child))
            && !visibleComponentNodes(child, current.nodes).some(node => getNodeId(node) === getNodeId(root)))) break;
        if (!reserveProjections) { lifetime.push({scene:current,members}); continue; }
        const placed = positioned(current, output, render);
        let top = placed.get(getNodeId(root))!;
        while (top.parent && placed.has(getNodeId(top.parent))
          && (top.parent.children ?? []).filter(child => placed.has(getNodeId(child))).length === 1) top = top.parent;
        const ownMembers = visibleComponentNodes(top, placed);
        const ids = new Set(ownMembers.map(getNodeId));
        const peers = [...placed.values()].filter(node => !ids.has(getNodeId(node)));
        lifetime.push({scene:current,members:ownMembers,peers});
        if (!introducedCollision && peers.length) {
          const original = positioned(current, base, render);
          const beforeInk = collisionAreas([...original.values()].filter(node => ids.has(getNodeId(node))),
            [...original.values()].filter(node => !ids.has(getNodeId(node))), current.measureCategoryText, current);
          const afterInk = collisionAreas(ownMembers, peers, current.measureCategoryText, current);
          introducedCollision = [...afterInk].some(([pair, area]) => area > (beforeInk.get(pair) ?? 0) + 1e-6);
        }
      }
      // Native overlaps are not introduced by reservation. Once clearance is
      // needed, all lifetime intervals still constrain the chosen rigid shift.
      if (reserveProjections && !introducedCollision) continue;
      if (reserveProjections) for (const { scene: current, members: own, peers } of lifetime)
        if (own.length && peers!.length) appendForbiddenShifts(intervals, placementInk(own, current.measureCategoryText, current),
          placementInk(peers!, current.measureCategoryText, current));
      const dx = minimumClearanceShift(intervals);
      if (dx === undefined) continue;
      const applied = new Set<SyntaxNode>();
      for (const {scene:current,members:currentMembers} of lifetime) {
        if (applied.has(current.canvas)) continue;
        applied.add(current.canvas);
        translateReservation(output, current.canvas, currentMembers.map(getNodeId), dx, direction);
      }
    }
  }
}

/** Clear the reserved lifetime as whole current components, including earlier
 * full sources whose IDs do not survive. Shared canvases contribute once. */
function clearReservedLifetime(
  scenes: readonly WorkspacePlacementScene[], output: Map<SyntaxNode, TreeCoordinateReservation>,
  first: number, last: number, rootId: string, direction: TreeDirection, render: Render,
  reservedMembers: ReadonlyMap<SyntaxNode, ReadonlySet<string>>
) {
  const ids = new Set(visibleComponentNodes(scenes[last].nodes.get(rootId)!, scenes[last].nodes).map(getNodeId));
  const shiftedMembers = new Map<SyntaxNode, Set<string>>();
  const intervals: HorizontalInterval[] = [];
  for (let index = first; index < scenes.length; index++) {
    const scene = scenes[index];
    if (shiftedMembers.has(scene.canvas)) continue;
    const nodes = positioned(scene, output, render);
    const affected = new Set([...(index > last ? ids : reservedMembers.get(scene.canvas) ?? [])].filter(id => nodes.has(id)));
    const roots = new Set<Node>();
    for (const id of affected) {
      let root = nodes.get(id)!;
      while (root.parent && nodes.has(getNodeId(root.parent))) root = root.parent;
      roots.add(root);
    }
    for (const root of roots) for (const member of visibleComponentNodes(root, nodes)) affected.add(getNodeId(member));
    shiftedMembers.set(scene.canvas, affected);
    const ownNodes = [...nodes].filter(([id]) => affected.has(id)).map(([, node]) => node);
    const otherNodes = [...nodes].filter(([id]) => !affected.has(id)).map(([, node]) => node);
    if (!ownNodes.length || !otherNodes.length) continue;
    const own = placementInk(ownNodes, scene.measureCategoryText, scene);
    const other = placementInk(otherNodes, scene.measureCategoryText, scene);
    appendForbiddenShifts(intervals, own, other);
  }
  const dx = minimumClearanceShift(intervals) ?? 0;
  for (const [canvas, affected] of shiftedMembers) translateReservation(output, canvas, affected, dx, direction);
}

/** Check every current member, not just the root, of an unchanged component. */
export function workspaceComponentIsStationary(
  before: ReadonlyMap<string, Node>, after: ReadonlyMap<string, Node>, rootId: string
): boolean {
  const root = before.get(rootId);
  return Boolean(root && visibleComponentNodes(root, before).every(node => {
    const next = after.get(getNodeId(node));
    return next && Math.hypot(next.x - node.x, next.y - node.y) <= 1e-6;
  }));
}

/** Find a completed workspace whose unchanged visible syntax reflows in the
 * accepted plan. Only those component lifetimes need another placement attempt. */
export function workspaceComponentLifetimeSeeds(
  scenes: readonly WorkspacePlacementScene[], coordinates: WorkspaceReservations, render: Render
) {
  const seeds: { index: number; rootId: string; attachment?: boolean; unrelated?: boolean }[] = [];
  for (let index = 1; index < scenes.length; index++) {
    const before = positioned(scenes[index - 1], coordinates, render), after = positioned(scenes[index], coordinates, render);
    for (const node of before.values()) {
      const id = getNodeId(node), current = after.get(id);
      if (!current || signature(node, before) !== signature(current, after)) continue;
      const oldOwner = parent(node, before), newOwner = parent(current, after);
      const step = scenes[index].step;
      const wrapper = newOwner && after.get(newOwner);
      if (oldOwner !== newOwner && wrapper && !before.has(newOwner!) && step.replayKind === 'micro'
        && step.operation === 'ExternalMerge' && step.targetNodeId === newOwner && (!oldOwner || parent(wrapper, after) === oldOwner)) {
        if (visibleComponentNodes(node, before).some(member => {
          const next = after.get(getNodeId(member))!;
          return Math.hypot(next.x-current.x-(member.x-node.x),next.y-current.y-(member.y-node.y)) > 1e-6;
        })) seeds.push({index,rootId:id,attachment:true});
        continue;
      }
      if (oldOwner || newOwner) {
        const ancestors = (node: Node, nodes: ReadonlyMap<string, Node>) => {
          const visible: Node[] = [];
          for (let ancestor = node.parent; ancestor && nodes.has(getNodeId(ancestor)); ancestor = ancestor.parent) visible.push(ancestor);
          return visible;
        };
        const outsideJoin = step.replayKind === 'micro' && step.operation === 'ExternalMerge'
          && step.targetNodeId && after.has(step.targetNodeId) && !before.has(step.targetNodeId)
          && oldOwner === newOwner && getNodeId(current) !== step.targetNodeId
          && !ancestors(current, after).some(ancestor => getNodeId(ancestor) === step.targetNodeId);
        const unchangedAncestor = ancestors(node, before).some(ancestor => {
          const ancestorId = getNodeId(ancestor), next = after.get(ancestorId);
          return before.has(ancestorId) && next && signature(ancestor, before) === signature(next, after);
        });
        if (outsideJoin && !unchangedAncestor && !workspaceComponentIsStationary(before, after, id)) seeds.push({ index, rootId: id, unrelated: true });
        continue;
      }
      if (visibleComponentNodes(node, before).some(member => {
        const point = after.get(getNodeId(member));
        return point && Math.hypot(point.x - member.x, point.y - member.y) > 1e-6;
      })) seeds.push({ index, rootId: id });
    }
  }
  const path = (seed: typeof seeds[number]) => {
    const nodes = scenes[seed.index - 1].nodes;
    let root = nodes.get(seed.rootId)!;
    const parts: number[] = [];
    while (root.parent && nodes.has(getNodeId(root.parent))) {
      parts.unshift(root.parent.children!.filter(child => nodes.has(getNodeId(child))).indexOf(root));
      root = root.parent;
    }
    return { root, parts };
  };
  return seeds.sort((a, b) => {
    const boundary = a.index - b.index;
    if (boundary) return boundary;
    const priority = (seed: typeof seeds[number]) => seed.attachment ? 0 : seed.unrelated ? 2 : 1;
    const dependency = priority(a) - priority(b);
    if (dependency) return dependency;
    const left = path(a), right = path(b);
    if (getNodeId(left.root) !== getNodeId(right.root)) return left.root.x - right.root.x
      || left.root.y - right.root.y || getNodeId(left.root).localeCompare(getNodeId(right.root));
    for (let index = 0; index < Math.min(left.parts.length, right.parts.length); index++) {
      if (left.parts[index] !== right.parts[index]) return left.parts[index] - right.parts[index];
    }
    return left.parts.length - right.parts.length;
  });
}

export type ComponentLifetimeOptions = {
  throughRelations?: boolean;
  reserveSourceProjections?: boolean;
  carryUntilMovement?: boolean;
  clearPriorSources?: boolean;
};

type ComponentLifetimePrefix = {
  coordinates: WorkspaceReservations;
  reservedMembers: ReadonlyMap<SyntaxNode, ReadonlySet<string>>;
  first: number;
  last: number;
};

/** Alternate clearance policies for one seed share their complete reservation
 * and rank reconciliation. Only prior-source clearance affects that prefix;
 * the two retained snapshots never escape this fixed-baseline attempt group. */
export function prepareComponentLifetimeReservations(
  scenes: readonly WorkspacePlacementScene[], base: WorkspaceReservations, direction: TreeDirection,
  boundary: number, rootId: string, render: Render
): (options?: ComponentLifetimeOptions) => WorkspaceReservations {
  const prefixes = new Map<boolean, ComponentLifetimePrefix>();
  return (options = {}) => reserveComponentLifetime(scenes, base, direction, boundary, rootId, render, options, prefixes);
}

/** Use an already accepted complete shape only while its visible syntax and
 * material are identical. Neither future traces nor unbuilt children qualify. */
export function reserveCompleteComponentLifetime(
  scenes: readonly WorkspacePlacementScene[], base: WorkspaceReservations, direction: TreeDirection,
  boundary: number, rootId: string, render: Render, options: ComponentLifetimeOptions = {}
): WorkspaceReservations {
  return reserveComponentLifetime(scenes, base, direction, boundary, rootId, render, options);
}

function reserveComponentLifetime(
  scenes: readonly WorkspacePlacementScene[], base: WorkspaceReservations, direction: TreeDirection,
  boundary: number, rootId: string, render: Render, options: ComponentLifetimeOptions,
  prefixes?: Map<boolean, ComponentLifetimePrefix>
): WorkspaceReservations {
  const { throughRelations = false, reserveSourceProjections = false,
    carryUntilMovement = false, clearPriorSources = false } = options;
  const complete = (prefix: ComponentLifetimePrefix): WorkspaceReservations => {
    // Clearance replaces per-canvas maps and points rather than modifying them.
    // Give each attempt its own outer map, including attempts rejected later.
    const output = new Map(prefix.coordinates);
    if (throughRelations) clearNewSources(scenes, output, prefix.first, prefix.last, direction,
      render, base, reserveSourceProjections, carryUntilMovement);
    clearReservedLifetime(scenes, output, prefix.first, prefix.last, rootId, direction, render, prefix.reservedMembers);
    return output;
  };
  const cached = throughRelations && prefixes?.get(clearPriorSources);
  if (cached) return complete(cached);
  const reference = scenes[boundary].nodes.get(rootId)!;
  const shape = signature(reference, scenes[boundary].nodes);
  let last = boundary;
  while (last + 1 < scenes.length) {
    const next = scenes[last + 1], node = next.nodes.get(rootId);
    if (!node || parent(node, next.nodes) !== parent(reference, scenes[boundary].nodes) || signature(node, next.nodes) !== shape) break;
    const prior = scenes[last], earlier = prior.nodes.get(rootId)!;
    let attachedAncestor = false;
    for (let owner = earlier.parent; owner && prior.nodes.has(getNodeId(owner)); owner = owner.parent) {
      const current = next.nodes.get(getNodeId(owner));
      if (current && parent(owner, prior.nodes) !== parent(current, next.nodes)
        && signature(owner, prior.nodes) === signature(current, next.nodes)) {
        attachedAncestor = true;
        break;
      }
    }
    if (attachedAncestor) break;
    last++;
  }
  const final = positioned(scenes[last], base, render);
  const output = new Map(base);
  const reservedMembers = new Map<SyntaxNode, Set<string>>();
  let first = last;
  const reserve = (end: number, id: string, reference: ReadonlyMap<string, Position>, sourceGroups: ReservedSourceMembers[] = []) => {
    const node = scenes[end].nodes.get(id)!;
    const material = signature(node, scenes[end].nodes);
    let start = end;
    while (start > 0) {
      const prior = scenes[start - 1], root = prior.nodes.get(id);
      if (!root || parent(root, prior.nodes) !== (throughRelations ? parent(node, scenes[end].nodes) : undefined)
        || signature(root, prior.nodes) !== material) break;
      start--;
    }
    first = Math.min(first, start);
    const members = visibleComponentNodes(node, scenes[end].nodes);
    for (let index = start; index <= end; index++) {
      const scene = scenes[index], coordinates = new Map(output.get(scene.canvas)!);
      const owned = reservedMembers.get(scene.canvas) ?? new Set<string>();
      for (const member of members) owned.add(getNodeId(member));
      reservedMembers.set(scene.canvas, owned);
      for (const group of sourceGroups) {
        const sourceOwned = group.get(scene.canvas) ?? new Set<string>();
        for (const member of members) sourceOwned.add(getNodeId(member));
        group.set(scene.canvas, sourceOwned);
      }
      for (const member of members) {
        const point = reference.get(getNodeId(member))!;
        coordinates.set(getNodeId(member), {
          x: direction === 'rtl' ? scene.size[0] - point.x : point.x, y: point.y
        });
      }
      output.set(scene.canvas, coordinates);
    }
    const entry = scenes[start];
    if (!start || (!throughRelations && (entry.step.replayKind !== 'micro'
      || !['Project', 'ExternalMerge'].includes(entry.step.operation)))) return;
    const prior = scenes[start - 1];
    const ids = new Set(members.map(getNodeId));
    const ownKey = entry.step.replayRelationIdentity && `${entry.step.replayRelationIdentity.stageIndex}:${entry.step.replayRelationIdentity.relationIndex}`;
    const movementLinks = (entry.step.replayRelationLinks ?? []).filter(link => entry.step.replayKind === 'relation' && ownKey !== undefined && link.authoredRelationKey === ownKey && link.renderFamily === 'trajectory' && link.priorSourceNodeId);
    const movingSources = new Set(movementLinks.flatMap(link => {
      const source = prior.nodes.get(link.priorSourceNodeId!);
      return source ? visibleComponentNodes(source, prior.nodes).map(getNodeId) : [];
    }));
    const retainedSources = new Set(movementLinks.flatMap(link => {
      const source = prior.nodes.get(link.priorSourceNodeId!), lower = link.witnessNodeId && entry.nodes.get(link.witnessNodeId);
      const unchangedLower = source && lower && getNodeId(source) === getNodeId(lower)
        && parent(source, prior.nodes) === parent(lower, entry.nodes)
        && signature(source, prior.nodes) === signature(lower, entry.nodes);
      return source && unchangedLower ? visibleComponentNodes(source, prior.nodes).map(getNodeId) : [];
    }));
    // Continue through unchanged components present before this wrapper or relation.
    const compatible = new Set([...prior.nodes.values()].filter(root => {
      const id = getNodeId(root), next = entry.nodes.get(id);
      if (visibleComponentNodes(root, prior.nodes).some(node => movingSources.has(getNodeId(node)) && !retainedSources.has(getNodeId(node))) || !ids.has(id) || !next || signature(root, prior.nodes) !== signature(next, entry.nodes)) return false;
      if (entry.step.replayKind === 'micro' && ['Project', 'ExternalMerge'].includes(entry.step.operation)) {
        if (!parent(root, prior.nodes)) return true;
        const ownerId = parent(next, entry.nodes), owner = ownerId && entry.nodes.get(ownerId);
        const ordinaryJoin = entry.step.operation === 'ExternalMerge' && entry.step.targetNodeId
          && entry.nodes.has(entry.step.targetNodeId) && !prior.nodes.has(entry.step.targetNodeId);
        return Boolean(ordinaryJoin && (parent(root, prior.nodes) === parent(next, entry.nodes)
          || owner && !prior.nodes.has(ownerId!) && entry.step.targetNodeId === ownerId
            && parent(root, prior.nodes) === parent(owner, entry.nodes)));
      }
      return parent(root, prior.nodes) === parent(next, entry.nodes);
    }).map(getNodeId));
    // Reserve the host's eventual horizontal position before ordinary attachment.
    // It stays on the wrapper's earlier row until that new current edge exists.
    // The same rule applies when recursion reaches a join inside a larger tree.
    const ordinaryHostReference = (current: Node) => {
      if (entry.step.replayKind !== 'micro' || entry.step.operation !== 'ExternalMerge') return;
      const id = getNodeId(current), old = prior.nodes.get(id), wrapperId = parent(current, entry.nodes);
      const wrapper = wrapperId && entry.nodes.get(wrapperId), oldOwnerId = old && parent(old, prior.nodes);
      const oldOwner = oldOwnerId && prior.nodes.get(oldOwnerId), owner = oldOwnerId && entry.nodes.get(oldOwnerId);
      if (!old || !wrapper || !oldOwner || !owner || prior.nodes.has(wrapperId!)
        || entry.step.targetNodeId !== wrapperId || parent(wrapper, entry.nodes) !== oldOwnerId
        || signature(old, prior.nodes) !== signature(current, entry.nodes)
        || oldOwner.data.label !== owner.data.label || oldOwner.data.word !== owner.data.word
        || oldOwner.data.silent !== owner.data.silent
        || JSON.stringify((oldOwner.children ?? []).filter(child => prior.nodes.has(getNodeId(child))).map(getNodeId))
          !== JSON.stringify((owner.children ?? []).filter(child => entry.nodes.has(getNodeId(child)))
            .map(child => getNodeId(child) === wrapperId ? id : getNodeId(child)))
        || !reference.has(wrapperId!)) return;
      const members = visibleComponentNodes(current, entry.nodes);
      if (members.some(member => !reference.has(getNodeId(member)))) return;
      const point = reference.get(id)!, target = reference.get(wrapperId!)!;
      return new Map(members.map(member => {
        const memberId = getNodeId(member), position = reference.get(memberId)!;
        return [memberId, { x: position.x, y: position.y + target.y - point.y }];
      }));
    };
    for (const id of compatible) {
      const root = prior.nodes.get(id)!;
      if (root.parent && compatible.has(getNodeId(root.parent))) continue;
      reserve(start - 1, id, ordinaryHostReference(entry.nodes.get(id)!) ?? reference, sourceGroups);
    }
    const ordinaryHost = ordinaryHostReference(node);
    if (ordinaryHost) reserve(start - 1, id, ordinaryHost, sourceGroups);

    // A current wordless atom has the same contour when an unrelated relation
    // changes its silent flag. Its own authored state remains untouched.
    if (entry.step.replayKind === 'relation') for (const current of members) {
      const id = getNodeId(current), old = prior.nodes.get(id);
      if (!old || compatible.has(id) || old.data.word || current.data.word
        || (old.children ?? []).some(child => prior.nodes.has(getNodeId(child)))
        || (current.children ?? []).some(child => entry.nodes.has(getNodeId(child)))
        || parent(old, prior.nodes) !== parent(current, entry.nodes)
        || old.data.label !== current.data.label || movingSources.has(id)) continue;
      const point = reference.get(id);
      if (point) reserve(start - 1, id, new Map([[id, point]]), sourceGroups);
    }

    // Pronouncing an existing wordless head adds its display child, not a new
    // syntax position. Reserve that exact head before its pronunciation moment.
    if (entry.step.replayKind === 'relation') for (const current of members) {
      const id = getNodeId(current);
      if (!addsOwnedDisplayTerminal(prior.nodes, entry.nodes, id) || movingSources.has(id)) continue;
      reserve(start - 1, id, new Map([[id, reference.get(id)!]]), sourceGroups);
    }

    if (entry.step.replayKind === 'relation' && entry.step.replayRelationIdentity) {
      const key = entry.step.replayRelationIdentity.stageIndex + ':' + entry.step.replayRelationIdentity.relationIndex;
      for (const link of entry.step.replayRelationLinks ?? []) {
        if (link.authoredRelationKey !== key || link.renderFamily !== 'trajectory'
          || !link.priorSourceNodeId || !link.witnessNodeId) continue;
        const ownsSource = ids.has(link.witnessNodeId);
        const ownsLanding = Boolean(link.targetNodeId && ids.has(link.targetNodeId));
        if (!ownsSource && !ownsLanding) continue;
        const sourceReference = ownsSource ? precedingSourcePositions(prior, entry, link.priorSourceNodeId, link.witnessNodeId, link.targetNodeId, reference, base, render) : undefined;
        if (sourceReference) {
          const group = clearPriorSources ? new Map<SyntaxNode, Set<string>>() : undefined;
          reserve(start - 1, link.priorSourceNodeId, sourceReference, group ? [...sourceGroups, group] : sourceGroups);
          if (group) clearReservedSourceHistory(scenes, output, direction, render, group);
        }
        const landing = ownsLanding && link.targetNodeId && entry.nodes.get(link.targetNodeId);
        if (!landing) continue;
        const origin = positioned(prior, base, render);
        for (const owner of landing.ancestors().slice(1)) {
          const ownerId = getNodeId(owner);
          if (!entry.nodes.has(ownerId)) break;
          const oldOwner = prior.nodes.get(ownerId);
          if (oldOwner) {
            // An atomic head may retain its ID when this movement gives it children.
            const atomicHost = !(oldOwner.children ?? []).some(child => prior.nodes.has(getNodeId(child)))
              && parent(oldOwner, prior.nodes) === parent(owner, entry.nodes)
              && !movingSources.has(ownerId);
            if (atomicHost) {
              let point = reference.get(ownerId);
              if (!point) {
                // A later source's reference may contain only this landing.
                // Its already assembled entry retains the receiving atom's slot.
                const entryPositions = positioned(entry, output, render);
                const entryLanding = entryPositions.get(getNodeId(landing)), entryOwner = entryPositions.get(ownerId);
                const reservedLanding = reference.get(getNodeId(landing));
                if (entryLanding && entryOwner && reservedLanding) point = {
                  x: entryOwner.x + reservedLanding.x - entryLanding.x,
                  y: entryOwner.y + reservedLanding.y - entryLanding.y
                };
              }
              if (point) reserve(start - 1, ownerId, new Map([[ownerId, point]]), sourceGroups);
            } else {
              // A receiving head may already project features. Only its owned
              // landing can add a branch; keep every retained child on that grid.
              // Wordless host silence may change as its pronounced child arrives.
              const oldChildren = (oldOwner.children ?? []).filter(child => prior.nodes.has(getNodeId(child)));
              const currentChildren = (owner.children ?? []).filter(child => entry.nodes.has(getNodeId(child)));
              const oldIds = new Set(oldChildren.map(getNodeId));
              const added = currentChildren.filter(child => !oldIds.has(getNodeId(child)));
              const currentOld = currentChildren.filter(child => oldIds.has(getNodeId(child)));
              const retainedMembers = visibleComponentNodes(oldOwner, prior.nodes);
              const additiveHost = oldChildren.length > 0 && added.length === 1
                && parent(oldOwner, prior.nodes) === parent(owner, entry.nodes)
                && oldOwner.data.label === owner.data.label && oldOwner.data.word === owner.data.word
                && (oldOwner.data.silent === owner.data.silent || (!oldOwner.data.word && !owner.data.word))
                && JSON.stringify(currentOld.map(getNodeId)) === JSON.stringify(oldChildren.map(getNodeId))
                && landing.ancestors().some(ancestor => ancestor === added[0])
                && oldChildren.every(child => signature(child, prior.nodes) === signature(entry.nodes.get(getNodeId(child))!, entry.nodes))
                && retainedMembers.every(member => reference.has(getNodeId(member)) && !movingSources.has(getNodeId(member)));
              if (additiveHost) reserve(start - 1, ownerId,
                new Map(retainedMembers.map(member => [getNodeId(member), reference.get(getNodeId(member))!])), sourceGroups);
            }
            break;
          }
          if (!reference.has(ownerId)) break;
          const hosts = (owner.children ?? []).flatMap(child => {
            const id = getNodeId(child), old = prior.nodes.get(id);
            if (!old || !entry.nodes.has(id) || parent(old, prior.nodes) !== parent(owner, entry.nodes)
              || signature(old, prior.nodes) !== signature(child, entry.nodes)
              || visibleComponentNodes(old, prior.nodes).some(member => movingSources.has(getNodeId(member)))) return [];
            return [old];
          });
          if (hosts.length > 1) break;
          if (!hosts.length) continue;
          const host = hosts[0], id = getNodeId(host), hostMembers = visibleComponentNodes(host, prior.nodes);
          // The wrapper changes the host's slot, not its internal geometry.
          const hostPositions = hostMembers.every(member => reference.has(getNodeId(member))) ? reference : origin;
          const point = hostPositions.get(id)!, target = reference.get(ownerId)!;
          const hostReference = new Map(hostMembers.map(member => {
            const memberId = getNodeId(member), position = hostPositions.get(memberId)!;
            return [memberId, {x: position.x + target.x - point.x, y: position.y + target.y - point.y}];
          }));
          reserve(start - 1, id, hostReference, sourceGroups);
          break;
        }
      }
    }
  };
  reserve(last, rootId, final);
  if (throughRelations) {
    reconcileComponentRanks(scenes, output, base, first, last, render, reserve);
  }
  const prefix: ComponentLifetimePrefix = { coordinates: output, first, last,
    reservedMembers: new Map([...reservedMembers].map(([canvas, ids]) => [canvas, new Set(ids)])) };
  if (throughRelations) prefixes?.set(clearPriorSources, prefix);
  return complete(prefix);
}

/** Keep an already complete shape through selection or relation-only steps.
 * Stop before its first material, topology, or ownership change. */
export function retainUnchangedComponentLifetime(
  scenes: readonly WorkspacePlacementScene[], base: WorkspaceReservations, direction: TreeDirection,
  boundary: number, rootId: string, render: Render
): WorkspaceReservations {
  const prior = scenes[boundary - 1], root = prior.nodes.get(rootId)!;
  const shape = signature(root, prior.nodes), owner = parent(root, prior.nodes);
  const points = positioned(prior, base, render), members = visibleComponentNodes(root, prior.nodes);
  const output = new Map(base);
  let last = boundary - 1;
  for (let index = boundary; index < scenes.length; index++) {
    const scene = scenes[index], current = scene.nodes.get(rootId);
    if (!current || parent(current, scene.nodes) !== owner || signature(current, scene.nodes) !== shape) break;
    const coordinates = new Map(output.get(scene.canvas)!);
    for (const member of members) {
      const id = getNodeId(member), point = points.get(id)!;
      coordinates.set(id, { x: direction === 'rtl' ? scene.size[0] - point.x : point.x, y: point.y });
    }
    output.set(scene.canvas, coordinates);
    last = index;
  }
  // An ownership change may translate an intact component, but cannot become
  // the delayed location of the deformation this reservation was meant to fix.
  const following = scenes[last + 1], nextRoot = following?.nodes.get(rootId);
  if (nextRoot && parent(nextRoot, following.nodes) !== owner && signature(nextRoot, following.nodes) === shape) {
    const nextPoints = positioned(following, base, render), oldRoot = points.get(rootId)!, newRoot = nextPoints.get(rootId)!;
    if (members.some(member => {
      const id = getNodeId(member), old = points.get(id)!, next = nextPoints.get(id)!;
      return Math.hypot(next.x - newRoot.x - (old.x - oldRoot.x), next.y - newRoot.y - (old.y - oldRoot.y)) > 1e-6;
    })) return base;
  }
  clearNewSources(scenes, output, boundary, last, direction, render, base, true);
  return output;
}
