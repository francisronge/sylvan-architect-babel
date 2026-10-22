import { currentWorkspaceMovements } from './currentWorkspaceMovements.ts';
import type { PlaybackStep } from './types.ts';
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
    const parent = current.parent(landing);
    const retained = parent && current.children(parent).filter(child => child !== landing);
    if (parent && before.has(parent) && !before.has(landing)
      && before.children(parent).length === 1 && retained?.length === 1
      && retained[0] === before.children(parent)[0]
      && before.contains(retained[0], source) && current.contains(retained[0], witness)) {
      // A unary projection can become a binary fork around its sole retained
      // child. Adding a daughter to an existing fork must not release peers
      // unrelated to movement. Unchanged subtree shapes remain rigid.
      result.add(parent);
    }
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
  const hosts = new Set(movementReceivingAttachments(step, before, current, sameTopology).map(item => item.host));
  for (const link of currentWorkspaceMovements(step, before, current)) {
    const receiver = current.parent(link.targetNodeId);
    if (link.trajectoryKind !== 'head' || !receiver || !before.has(receiver)
      || before.parent(receiver) !== current.parent(receiver)
      || before.contains(receiver, link.priorSourceNodeId)) continue;
    const priorChildren = before.children(receiver), children = current.children(receiver);
    const retained = children.filter(id => id !== link.targetNodeId);
    // A receiving head can grow around preserved inflection material without
    // an extra wrapper occurrence. Clearance belongs to that movement moment,
    // never to an earlier selection that merely reserves the final layout.
    // A unary receiver has no old fork to release: its retained child stays a
    // stationary witness while the new head is placed around it.
    if (priorChildren.length > 1 && children.length === priorChildren.length + 1
      && priorChildren.every((id, index) => id === retained[index] && sameTopology(id))) {
      hosts.add(receiver);
      priorChildren.forEach(id => hosts.add(id));
    }
    // The receiving head can instead keep its identity while one new inner
    // wrapper, beside the landing, takes over all of its prior children. Those
    // children change parent here, exactly as in the neutral reading of the same
    // rewrite (neutralWorkspaceAttachments), so they are released alike.
    const inner = retained.length === 1 && !before.has(retained[0]) ? current.children(retained[0]) : [];
    if (priorChildren.length && inner.length === priorChildren.length
      && priorChildren.every((id, index) => id === inner[index] && sameTopology(id)))
      priorChildren.forEach(id => hosts.add(id));
  }
  return hosts;
}

/** Share the exact replaced child slot with geometry planning. The wrapper is
 * new at this movement; the host already occupied its outer parent slot. */
export function movementReceivingAttachments(
  step: PlaybackStep, before: CurrentWorkspaceTopology, current: CurrentWorkspaceTopology,
  sameTopology: (id: string) => boolean
): readonly { host: string; wrapper: string }[] {
  const result: { host: string; wrapper: string }[] = [];
  for (const link of currentWorkspaceMovements(step, before, current)) {
    for (let owner = current.parent(link.targetNodeId); owner && !before.has(owner); owner = current.parent(owner)) {
      const hosts = current.children(owner).filter(id => before.has(id)
        && before.parent(id) === current.parent(owner));
      if (hosts.length > 1) break;
      if (!hosts.length) continue;
      if (sameTopology(hosts[0]) && !result.some(item => item.host === hosts[0]))
        result.push({ host: hosts[0], wrapper: owner });
      break;
    }
  }
  return result;
}

/** An ordinary merge can wrap one current child with detached inputs. The
 * retained child owns the same outer slot; relation names supply no permission. */
export function constructionReceivingAttachments(
  step: PlaybackStep, before: CurrentWorkspaceTopology, current: CurrentWorkspaceTopology,
  sameTopology: (id: string) => boolean
): readonly { host: string; wrapper: string }[] {
  const wrapper = step.targetNodeId, sources = step.sourceNodeIds ?? [];
  // Future layout metadata does not establish a current receiving boundary.
  if (step.replayKind !== 'micro' || step.operation !== 'ExternalMerge'
    || !wrapper || !current.has(wrapper) || before.has(wrapper)) return [];
  const owner = current.parent(wrapper), children = current.children(wrapper);
  if (!owner || !before.has(owner) || children.length < 2 || sources.length !== children.length
    || new Set(sources).size !== sources.length || !children.every(id => before.has(id) && sources.includes(id))) return [];
  const hosts = children.filter(id => before.parent(id) === owner);
  if (hosts.length !== 1 || !sameTopology(hosts[0])
    || children.some(id => id !== hosts[0] && before.parent(id) !== undefined)) return [];
  const host = hosts[0], priorPeers = before.children(owner), nextPeers = current.children(owner);
  return priorPeers.length === nextPeers.length
    && priorPeers.every((id, i) => (id === host ? wrapper : id) === nextPeers[i]) ? [{ host, wrapper }] : [];
}
