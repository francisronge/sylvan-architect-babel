import { currentWorkspaceMovements } from './currentWorkspaceMovements.ts';
import type { PlaybackStep } from './replayCompiler.ts';
export type CurrentWorkspaceTopology = {
  has(id: string): boolean;
  parent(id: string): string | undefined;
  children(id: string): readonly string[];
  contains(root: string, id: string): boolean;
};
/** Extracting a source can also wrap its remaining host at that host's old
 * parent slot. This identifies the host's outer motion; it grants no change to
 * the internal contour of any retained subtree. */
export function extractionReceivingHosts(
  step: PlaybackStep, before: CurrentWorkspaceTopology, current: CurrentWorkspaceTopology
): ReadonlySet<string> {
  const result = new Set<string>();
  for (const link of currentWorkspaceMovements(step, before, current)) {
    const source = link.priorSourceNodeId, witness = link.witnessNodeId, landing = link.targetNodeId;
    for (let owner = current.parent(landing); owner && !before.has(owner); owner = current.parent(owner)) {
      const hosts = current.children(owner).filter(id => before.has(id)
        && before.parent(id) === current.parent(owner));
      if (hosts.length > 1) break;
      if (!hosts.length) continue;
      const host = hosts[0];
      if (before.contains(host, source) && current.contains(host, witness)) result.add(host);
      break;
    }
  }
  return result;
}

/** The unique preceding child replaced by a new movement wrapper is its
 * receiving host. Material may change, but an unchanged topology still owns
 * the same host slot; callers retain its complete current interior. */
export function movementReceivingHosts(
  step: PlaybackStep, before: CurrentWorkspaceTopology, current: CurrentWorkspaceTopology,
  sameTopology: (id: string) => boolean
): ReadonlySet<string> {
  const result = new Set<string>();
  for (const link of currentWorkspaceMovements(step, before, current)) {
    for (let owner = current.parent(link.targetNodeId); owner && !before.has(owner); owner = current.parent(owner)) {
      const hosts = current.children(owner).filter(id => before.has(id)
        && before.parent(id) === current.parent(owner));
      if (hosts.length > 1) break;
      if (!hosts.length) continue;
      if (sameTopology(hosts[0])) result.add(hosts[0]);
      break;
    }
  }
  return result;
}
