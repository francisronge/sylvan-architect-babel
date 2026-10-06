import { currentWorkspaceMovements } from './currentWorkspaceMovements.ts';
import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { PlaybackStep } from './replayCompiler.ts';
import { getNodeId } from './displayIdentity.ts';
import { visibleComponentNodes } from './visibleComponent.ts';

type Node = d3.HierarchyPointNode<SyntaxNode>;
type Nodes = ReadonlyMap<string, Node>;
const parent = (node: Node, nodes: Nodes) => node.parent && nodes.has(getNodeId(node.parent))
  ? getNodeId(node.parent) : undefined;
const children = (node: Node, nodes: Nodes) => (node.children ?? [])
  .filter(child => nodes.has(getNodeId(child))).map(getNodeId);

/** A movement can insert a new parent around an existing host. Its unchanged
 * full contour may translate with that insertion, but cannot deform. */
export function rigidMovementHosts(
  step: PlaybackStep, before: Nodes, after: Nodes, priorPositions: Nodes, positions: Nodes
): ReadonlySet<string> {
  const result = new Set<string>();
  for (const link of currentWorkspaceMovements(step, before, after)) {
    const landing = after.get(link.targetNodeId);
    if (!landing) continue;
    for (let owner = landing.parent; owner && after.has(getNodeId(owner)); owner = owner.parent) {
      if (before.has(getNodeId(owner))) break;
      const hosts = (owner.children ?? []).filter(host => {
        const id = getNodeId(host), prior = before.get(id);
        return after.has(id) && prior && parent(prior, before) === parent(owner, after);
      });
      if (hosts.length > 1) break;
      if (!hosts.length) continue;
      const host = hosts[0], id = getNodeId(host), prior = before.get(id)!;
      const members = visibleComponentNodes(host, after), oldMembers = visibleComponentNodes(prior, before);
      const unchanged = members.length === oldMembers.length && members.every(member => {
        const old = before.get(getNodeId(member));
        return old && (member === host || parent(old, before) === parent(member, after))
          && member.data.label === old.data.label && member.data.word === old.data.word
          && member.data.silent === old.data.silent
          && JSON.stringify(children(member, after)) === JSON.stringify(children(old, before));
      });
      if (!unchanged) break;
      const priorRoot = priorPositions.get(id), root = positions.get(id);
      if (!priorRoot || !root) break;
      const dx = root.x - priorRoot.x, dy = root.y - priorRoot.y;
      if (members.every(member => {
        const old = priorPositions.get(getNodeId(member)), current = positions.get(getNodeId(member));
        return old && current && Math.hypot(current.x - old.x - dx, current.y - old.y - dy) <= 1e-6;
      })) for (const member of members) result.add(getNodeId(member));
      break;
    }
  }
  return result;
}
