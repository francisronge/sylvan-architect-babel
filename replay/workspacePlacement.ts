import { plaqueTreeObstacles } from './relations/plaquePlacement.ts';
import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { PlaybackStep } from './replayCompiler.ts';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { layoutSyntaxTree, type TreeCoordinateReservation, type TreeDirection } from './treeLayout.ts';
import { retainCurrentRootFork } from './currentRootFork.ts';
import { retainCurrentSiblingRanks } from './currentSiblingRanks.ts';

type Node = d3.HierarchyPointNode<SyntaxNode>;
type Reservations = ReadonlyMap<SyntaxNode, TreeCoordinateReservation>;
type Scene = {
  step: PlaybackStep;
  canvas: SyntaxNode;
  size: [number, number];
  nodes: Map<string, Node>;
  coordinates: TreeCoordinateReservation;
};

const cache = new WeakMap<readonly PlaybackStep[], Map<string, Reservations>>();
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
  coordinatesForStage: (stage: number, size: [number, number]) => Reservations
): Reservations {
  const stageSizes = [...sizes].sort(([a], [b]) => a - b);
  const key = JSON.stringify([direction, stageSizes]);
  let plans = cache.get(steps);
  if (!plans) cache.set(steps, plans = new Map());
  const cached = plans.get(key);
  if (cached) return cached;

  const originals = new Map(stageSizes.map(([stage, size]) => [stage, coordinatesForStage(stage, size)]));
  const orderedSteps = [...steps].sort((a, b) => (a.replayFrameIndex! - b.replayFrameIndex!)
    || ((a.replayStageStepIndex ?? (a.replayKind === 'macro' ? Infinity : 0))
      - (b.replayStageStepIndex ?? (b.replayKind === 'macro' ? Infinity : 0))));
  const scenes: Scene[] = orderedSteps.flatMap(step => {
    const canvas = step.replayCanvasData, size = sizes.get(step.replayFrameIndex!);
    if (!canvas || !size) return [];
    const coordinates = originals.get(step.replayFrameIndex!)!.get(canvas)!;
    const root = d3.hierarchy(canvas); applyVizIds(root);
    const visible = new Set(step.replayVisibleNodeIds);
    const tree = layoutSyntaxTree(root, size, direction, coordinates, visible);
    const nodes = new Map<string, Node>(tree.descendants().filter(node => visible.has(getNodeId(node)))
      .map(node => [getNodeId(node), node] as const));
    return [{ step, canvas, size, nodes, coordinates }];
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
  const compute = (allowOrdinary: boolean, base?: Reservations, progressive = false, preserveShape = true) => {
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
            // Retain its existing shape relative to the nearest reserved ancestor.
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
              const x = position.x + (sameBranch && futurePoint && parentPoint ? futurePoint.x - parentPoint.x : node.x - anchor.x);
              const y = position.y + (sameBranch && futurePoint && parentPoint ? futurePoint.y - parentPoint.y : node.y - anchor.y);
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
  if (!ordinaryRoots.size) { plans.set(key, legacy); return legacy; }
  let baseline = compute(true, legacy);
  let candidate = compute(true, baseline, true, false);
  const rendered = (scene: Scene, reservation: TreeCoordinateReservation): Node[] => {
    const root = d3.hierarchy(scene.canvas); applyVizIds(root);
    const visible = new Set(scene.nodes.keys());
    return layoutSyntaxTree(root, scene.size, direction, reservation, visible).descendants()
      .filter(node => visible.has(getNodeId(node)));
  };
  if (!scenes.every(scene => {
    const after = ink(scene, baseline.get(scene.canvas)!), before = ink(scene, legacy.get(scene.canvas)!);
    return after && before && [...after].every(([pair, area]) => area <= (before.get(pair) ?? 0) + 1e-6);
  })) {
    baseline = legacy;
    candidate = compute(true, baseline, true, false);
  }
  // A lifetime can end when its topology changes. Reject a reservation that
  // merely moves a discontinuity to that boundary or to another component.
  const stableMotion = () => scenes.every((scene, index) => {
    if (!index) return true;
    const before = scenes[index - 1];
    const previous = new Map(rendered(before, candidate.get(before.canvas)!).map(node => [getNodeId(node), node] as const));
    const baselineBefore = new Map(rendered(before, baseline.get(before.canvas)!).map(node => [getNodeId(node), node] as const));
    const baselineAfter = new Map(rendered(scene, baseline.get(scene.canvas)!).map(node => [getNodeId(node), node] as const));
    return rendered(scene, candidate.get(scene.canvas)!).every(node => {
      const id = getNodeId(node), original = scene.nodes.get(id)!, prior = before.nodes.get(id), moved = previous.get(id);
      if (!prior || !moved || parentId(original, scene.nodes) !== parentId(prior, before.nodes)
        || JSON.stringify(childrenOf(original, scene.nodes)) !== JSON.stringify(childrenOf(prior, before.nodes))) return true;
      if (scene.step.replayKind === 'relation' && prior.ancestors().slice(1).some(ancestor =>
        before.nodes.has(getNodeId(ancestor)) && ancestor.data.replayOrigin?.kind !== 'workspace'
        && !original.ancestors().some(current => getNodeId(current) === getNodeId(ancestor)))) return true;
      const priorMotion = Math.hypot(baselineAfter.get(id)!.x - baselineBefore.get(id)!.x,
        baselineAfter.get(id)!.y - baselineBefore.get(id)!.y);
      return scene.step.replayKind === 'relation' && priorMotion > 1e-6
        || Math.hypot(node.x - moved.x, node.y - moved.y) <= priorMotion + 1e-6;
    });
  });
  // Validate the assembled cohort, including labels, words and native branches.
  // An individually valid component can still collide with another reservation.
  function ink(scene: Scene, reservation: TreeCoordinateReservation) {
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
    const components = nodes.filter(node => !included.has(node.parent!)).map(node => ({
      id: getNodeId(node), rects: plaqueTreeObstacles(node.descendants().filter(node => included.has(node)))
    }));
    const overlaps = new Map<string, number>();
    for (let i = 0; i < components.length; i++) for (let j = i + 1; j < components.length; j++) {
      let area = 0;
      for (const a of components[i].rects) for (const b of components[j].rects) {
        const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (h <= 0) continue;
        const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        if (w > 0) area += w * h;
      }
      if (area) overlaps.set(JSON.stringify([components[i].id, components[j].id].sort()), area);
    }
    return overlaps;
  }
  const safe = () => stableMotion() && scenes.every(scene => {
    const next = candidate.get(scene.canvas)!, prior = baseline.get(scene.canvas)!;
    if ([...next].every(([id, p]) => p.x === prior.get(id)?.x && p.y === prior.get(id)?.y)) return true;
    const after = ink(scene, next), before = ink(scene, prior);
    return after && before && [...after].every(([pair, area]) => area <= (before.get(pair) ?? 0) + 1e-6);
  });
  if (!safe()) {
    // A compact lower copy can leave too little room for its earlier full form.
    // In that case reserve the existing component shape instead.
    candidate = compute(true, baseline, true);
    if (!safe()) candidate = baseline;
  }
  const result = candidate;
  plans.set(key, result);
  return result;
}
