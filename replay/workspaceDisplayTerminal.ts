import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { authoredDisplayWord } from './displayWordMaterial.ts';
import { getNodeId } from './displayIdentity.ts';

type Node = d3.HierarchyNode<SyntaxNode>;
type Nodes = ReadonlyMap<string, Node>;

/** Pronouncing a retained wordless head adds a display child, not a syntax
 * position. Only the current connected owner and exact generated text prove it. */
export function addsOwnedDisplayTerminal(before: Nodes, current: Nodes, id: string): boolean {
  const old = before.get(id), node = current.get(id);
  if (!old || !node || old.data.id !== id || node.data.id !== id
    || old.data.word || !node.data.word || old.data.label !== node.data.label
    || old.data.silent !== node.data.silent) return false;
  const parent = (node: Node, nodes: Nodes) => node.parent && nodes.has(getNodeId(node.parent))
    ? getNodeId(node.parent) : undefined;
  const children = (node.children ?? []).filter(child => current.has(getNodeId(child)));
  if ((old.children ?? []).some(child => before.has(getNodeId(child)))
    || parent(old, before) !== parent(node, current) || children.length !== 1) return false;
  const child = children[0];
  return child.data.replayOrigin?.kind === 'word' && child.data.replayOrigin.ownerId === id
    && child.parent === node && !child.children?.length
    && authoredDisplayWord(child.data, node.data) === node.data.word
    && !before.has(getNodeId(child));
}

/** Addition and removal have the same stationary owner. The caller still
 * applies the current operation's movement and merge ownership exclusions. */
export function changesOwnedDisplayTerminal(before: Nodes, current: Nodes, id: string): boolean {
  return addsOwnedDisplayTerminal(before, current, id) || addsOwnedDisplayTerminal(current, before, id);
}
