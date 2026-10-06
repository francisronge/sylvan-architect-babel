import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import { getNodeId } from './displayIdentity.ts';
import { authoredDisplayWord } from './displayWordMaterial.ts';
import { visibleComponentNodes } from './visibleComponent.ts';

type Node = d3.HierarchyPointNode<SyntaxNode>;
const owner = (node: Node, nodes: ReadonlyMap<string, Node>) =>
  node.parent && nodes.has(getNodeId(node.parent)) ? getNodeId(node.parent) : undefined;

function material(node: Node, nodes: ReadonlyMap<string, Node>): unknown[] {
  const parent = node.parent && nodes.has(getNodeId(node.parent)) ? node.parent.data : undefined;
  const word = authoredDisplayWord(node.data, parent);
  return [getNodeId(node), word ?? node.data.label, word ?? node.data.word, node.data.silent,
    (node.children ?? []).filter(child => nodes.has(getNodeId(child))).map(child => material(child, nodes))];
}

/** Measure each unchanged member relative to its root when that complete
 * component changes owner. A rigid attachment contributes zero deformation. */
export function attachmentShapeChanges(
  before: ReadonlyMap<string, Node>, after: ReadonlyMap<string, Node>
): Map<string, number> {
  const changes = new Map<string, number>();
  for (const [id, root] of before) {
    const nextRoot = after.get(id);
    if (!nextRoot || owner(root, before) === owner(nextRoot, after)
      || JSON.stringify(material(root, before)) !== JSON.stringify(material(nextRoot, after))) continue;
    for (const node of visibleComponentNodes(root, before)) {
      const next = after.get(getNodeId(node))!;
      changes.set(JSON.stringify([id, getNodeId(node)]), Math.hypot(
        next.x - nextRoot.x - (node.x - root.x), next.y - nextRoot.y - (node.y - root.y)));
    }
  }
  return changes;
}
