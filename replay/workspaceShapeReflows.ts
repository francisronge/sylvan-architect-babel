import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { PlaybackStep } from './replayCompiler.ts';
import type { TreeCoordinateReservation } from './treeLayout.ts';
import { authoredDisplayWord } from './displayWordMaterial.ts';
import { getNodeId } from './displayIdentity.ts';
import { visibleComponentNodes } from './visibleComponent.ts';
import { workspaceMotionOwnership, type WorkspaceMotionView } from './workspaceMotionOwnership.ts';
import { changesOwnedDisplayTerminal } from './workspaceDisplayTerminal.ts';

type Node = d3.HierarchyPointNode<SyntaxNode>;
type Scene = { step: PlaybackStep; canvas: SyntaxNode; nodes: ReadonlyMap<string, Node> };
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
 * current ownership rules shared with the pose graph may release world pose. */
export function workspaceContinuityReflows<S extends Scene>(
  scenes: readonly S[], baseline: ReadonlyMap<SyntaxNode, TreeCoordinateReservation>,
  render: (scene: S, coordinates: TreeCoordinateReservation) => Node[]
): WorkspaceContinuityReflow[] {
  return detectWorkspaceReflows(scenes, baseline, render, true);
}

function detectWorkspaceReflows<S extends Scene>(
  scenes: readonly S[], baseline: ReadonlyMap<SyntaxNode, TreeCoordinateReservation>,
  render: (scene: S, coordinates: TreeCoordinateReservation) => Node[], includeMotion: boolean
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
        const node = nodes.get(current)!, owner = parents.get(current);
        const word = authoredDisplayWord(node.data, owner ? nodes.get(owner)!.data : undefined);
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
        for (const id of stationary) {
          const prior = oldPositions.get(id), next = newPositions.get(id);
          if (prior && next && Math.hypot(next.x - prior.x, next.y - prior.y) > 1e-6)
            result.push({ index, rootId: id, kind: 'unowned-component-motion' });
        }
      }
    }
  }
  return result;
}
