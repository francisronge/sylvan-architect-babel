import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { getNodeId } from './displayIdentity.ts';
import { authoredDisplayWord } from './displayWordMaterial.ts';
import type { TreeCoordinateReservation } from './treeLayout.ts';
import type { PlaybackStep } from './types.ts';
import { visibleComponentNodes } from './visibleComponent.ts';
import { changesOwnedDisplayTerminal } from './workspaceDisplayTerminal.ts';
import { paintedShift, type CarryOptions } from './cameraCarry.ts';
import { closingGroups, stepOwnership, stepTrajectoryParticipants } from './motionRule.ts';
import { workspaceMotionOwnership, type WorkspaceMotionView } from './workspaceMotionOwnership.ts';

type Node = d3.HierarchyPointNode<SyntaxNode>;
/** `closing`: the stage plan closed a movement's room at the crossing into this scene (CarryOptions). */
type Scene = { step: PlaybackStep; canvas: SyntaxNode; nodes: ReadonlyMap<string, Node>; closing?: boolean };
export type WorkspaceShapeReflow = { index: number; rootId: string; kind: 'unchanged-subtree-shape' };
export type WorkspaceContinuityReflow = WorkspaceShapeReflow
  | { index: number; rootId: string; kind: 'unowned-component-motion' };

/** Unchanged visible material retains its complete internal contour at every
 * boundary. Rigid translation is deliberately ignored here: the pose graph,
 * not this detector, decides which current operation owns that translation. */
export function unchangedWorkspaceShapeReflows<S extends Scene>(
  scenes: readonly S[], baseline: ReadonlyMap<SyntaxNode, TreeCoordinateReservation>,
  render: (scene: S, coordinates: TreeCoordinateReservation) => Node[]
): WorkspaceShapeReflow[] {
  return detectWorkspaceReflows(scenes, baseline, render, false) as WorkspaceShapeReflow[];
}

/** Internal shape and world pose are separate constraints. Only the exact
 * current ownership rules shared with the pose graph may release world pose.
 * With `ownClosings`, as the corpus comparison judges Replay, a movement step
 * also owns the closing of the gap its phrase leaves, as the motion rule
 * assigns it (`closingGroups` in motionRule.ts). */
export function workspaceContinuityReflows<S extends Scene>(
  scenes: readonly S[], baseline: ReadonlyMap<SyntaxNode, TreeCoordinateReservation>,
  render: (scene: S, coordinates: TreeCoordinateReservation) => Node[],
  { ownClosings = false }: { ownClosings?: boolean } = {}
): WorkspaceContinuityReflow[] {
  return detectWorkspaceReflows(scenes, baseline, render, true, ownClosings);
}

function detectWorkspaceReflows<S extends Scene>(
  scenes: readonly S[], baseline: ReadonlyMap<SyntaxNode, TreeCoordinateReservation>,
  render: (scene: S, coordinates: TreeCoordinateReservation) => Node[], includeMotion: boolean, ownClosings = false
): WorkspaceContinuityReflow[] {
  const signatures = new Map<string, number>(), topologies = new Map<string, number>();
  const snapshots = scenes.map(scene => {
    const visible = new Set(scene.step.replayVisibleNodeIds);
    const nodes = new Map([...scene.nodes].filter(([id, node]) => visible.has(id)
      && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace'));
    const parents = new Map<string, string>(), children = new Map<string, string[]>();
    for (const [id, node] of nodes) {
      const parentId = node.parent && getNodeId(node.parent);
      if (parentId && nodes.has(parentId)) parents.set(id, parentId);
      children.set(id, (node.children ?? []).filter(child => nodes.has(getNodeId(child))).map(getNodeId));
    }
    const parts = new Map<string, { signature: number; topology: number; size: number }>();
    // Intern local signatures rather than serializing every descendant at each
    // ancestor. A child contributes its ID and already interned current shape.
    for (const id of nodes.keys()) {
      const pending = [id];
      while (pending.length) {
        const current = pending.at(-1)!;
        if (parts.has(current)) { pending.pop(); continue; }
        const childIds = children.get(current)!;
        const missing = childIds.filter(child => !parts.has(child));
        if (missing.length) { pending.push(...missing); continue; }
        const node = nodes.get(current)!;
        const owner = node.parent && (nodes.has(getNodeId(node.parent)) || scene.step.replayUsesFutureLayoutScaffold)
          ? node.parent.data : undefined;
        const word = authoredDisplayWord(node.data, owner);
        const key = JSON.stringify([word ?? node.data.label, word ?? node.data.word, node.data.silent,
          childIds.map(child => [child, parts.get(child)!.signature])]);
        let signature = signatures.get(key);
        if (signature === undefined) { signature = signatures.size; signatures.set(key, signature); }
        const topologyKey = JSON.stringify(childIds.map(child => [child, parts.get(child)!.topology]));
        let topology = topologies.get(topologyKey);
        if (topology === undefined) { topology = topologies.size; topologies.set(topologyKey, topology); }
        parts.set(current, { signature, topology, size: 1 + childIds.reduce((sum, child) => sum + parts.get(child)!.size, 0) });
        pending.pop();
      }
    }
    const view: WorkspaceMotionView = {
      ids: () => nodes.keys(), has: id => nodes.has(id), parent: id => parents.get(id), children: id => children.get(id) ?? [],
      contains: (root, id) => {
        for (let current: string | undefined = id; current; current = parents.get(current)) if (current === root) return true;
        return false;
      },
      *members(root) {
        const pending = [root];
        while (pending.length) {
          const id = pending.pop()!;
          if (!nodes.has(id)) continue;
          yield id;
          pending.push(...(children.get(id) ?? []).slice().reverse());
        }
      }
    };
    return { nodes, parents, parts, view };
  });
  const positioned = new Map<number, Map<string, Node>>();
  const positions = (index: number) => {
    let result = positioned.get(index);
    if (!result) {
      const scene = scenes[index];
      result = new Map(render(scene, baseline.get(scene.canvas)!).map(node => [getNodeId(node), node]));
      positioned.set(index, result);
    }
    return result;
  };
  const result: WorkspaceContinuityReflow[] = [];
  for (let index = 1; index < scenes.length; index++) {
    const before = snapshots[index - 1], current = snapshots[index];
    for (const [id, part] of current.parts) {
      if (part.size < 2 || before.parts.get(id)?.signature !== part.signature) continue;
      const owner = current.parents.get(id), oldOwner = before.parents.get(id);
      if (owner && owner === oldOwner
        && before.parts.get(owner)?.signature === current.parts.get(owner)?.signature) continue;
      const oldPositions = positions(index - 1), newPositions = positions(index);
      const origin = oldPositions.get(id), nextOrigin = newPositions.get(id);
      if (!origin || !nextOrigin) continue;
      const members = visibleComponentNodes(current.nodes.get(id)!, current.nodes);
      if (members.some(node => {
        const prior = oldPositions.get(getNodeId(node)), next = newPositions.get(getNodeId(node));
        return prior && next && Math.hypot((next.x - nextOrigin.x) - (prior.x - origin.x),
          (next.y - nextOrigin.y) - (prior.y - origin.y)) > 1e-6;
      })) result.push({ index, rootId: id, kind: 'unchanged-subtree-shape' });
    }
    if (includeMotion) {
      const { stationary } = workspaceMotionOwnership({
        step: scenes[index].step, before: before.view, current: current.view,
        sameMaterial: id => before.parts.get(id)?.signature === current.parts.get(id)?.signature,
        sameTopology: id => before.parts.get(id)?.topology === current.parts.get(id)?.topology,
        displayTerminalChange: id => changesOwnedDisplayTerminal(before.nodes, current.nodes, id)
      });
      if (stationary.length) {
        const oldPositions = positions(index - 1), newPositions = positions(index);
        const closing = ownClosings ? closingAt(scenes[index - 1].step, scenes[index].step, before.nodes, current.nodes, oldPositions, newPositions,
          { closing: Boolean(scenes[index].closing) }) : undefined;
        for (const id of stationary) {
          if (closing?.has(id)) continue;
          const prior = oldPositions.get(id), next = newPositions.get(id);
          if (prior && next && Math.hypot(next.x - prior.x, next.y - prior.y) > 1e-6)
            result.push({ index, rootId: id, kind: 'unowned-component-motion' });
        }
      }
    }
  }
  return result;
}

/** The syntax a step's approved closing moves, as the motion rule finds it over
 * the painted nodes `before` and `current` at their laid-out positions. */
export function closingAt(previous: PlaybackStep, step: PlaybackStep, before: ReadonlyMap<string, Node>, current: ReadonlyMap<string, Node>,
  oldPositions: ReadonlyMap<string, Node>, newPositions: ReadonlyMap<string, Node>, carry: CarryOptions = {}) {
  const points = (nodes: ReadonlyMap<string, Node>, at: ReadonlyMap<string, Node>) => new Map([...nodes].flatMap(([id, node]) => {
    const point = at.get(id);
    const parent = node.parent && nodes.has(getNodeId(node.parent)) ? getNodeId(node.parent) : null;
    return point ? [[id, { id, x: point.x, y: point.y, parent }] as const] : [];
  }));
  const prior = points(before, oldPositions), now = points(current, newPositions);
  const painted = (map: typeof prior) => new Map([...map].map(([id, point]) => [id, { x: point.x, y: point.y, parentId: point.parent }]));
  // The closing is found under the carry without its held syntax, which is
  // what the closing itself decides (stageCoordinates.entryCarry).
  const shift = previous.replayFrameIndex !== step.replayFrameIndex ? paintedShift(painted(prior), painted(now), { closing: carry.closing }) : { x: 0, y: 0 };
  const motion = (id: string) => {
    const a = prior.get(id), b = now.get(id);
    return a && b ? { x: b.x - shift.x - a.x, y: b.y - shift.y - a.y } : undefined;
  };
  const links = stepTrajectoryParticipants(step);
  const owned = stepOwnership({ target: step.targetNodeId, links, points: [...now.values()], prior });
  return closingGroups({ kind: step.replayKind, links, current: now, prior, motion, owned });
}
