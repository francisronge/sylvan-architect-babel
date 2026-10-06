import { neutralWorkspaceAttachments } from './workspaceNeutralAttachments.ts';
import type { PlaybackStep } from './replayCompiler.ts';
import { currentWorkspaceMovements } from './currentWorkspaceMovements.ts';
import { movementReceivingHosts, extractionReceivingHosts, type CurrentWorkspaceTopology } from './workspaceReceivingHost.ts';

export type WorkspaceMotionView = CurrentWorkspaceTopology & {
  ids(): Iterable<string>;
  members(root: string): Iterable<string>;
};

/** Motion belongs to the current operation's exact participants. Stationary
 * witnesses are shared by detection, planning, and verification; changing PF
 * material alone does not grant translation to a topology-stable point. */
export function workspaceMotionOwnership({ step, before, current, sameMaterial, sameTopology, displayTerminalChange }: {
  step: PlaybackStep;
  before: WorkspaceMotionView;
  current: WorkspaceMotionView;
  sameMaterial(id: string): boolean;
  sameTopology(id: string): boolean;
  /** Exact generated-terminal addition/removal, proved from current node provenance. */
  displayTerminalChange?(id: string): boolean;
}): { owned: ReadonlySet<string>; stationary: readonly string[] } {
  const owned = new Set<string>(), ids = [...current.ids()];
  const include = (id: string, old = false) => {
    const view = old ? before : current;
    if (view.has(id)) for (const member of view.members(id)) owned.add(member);
  };
  const target = step.targetNodeId;
  const children = target ? current.children(target) : [];
  const unaryProject = step.operation === 'Project' && children.length === 1
    && step.sourceNodeIds?.length === 1 && step.sourceNodeIds[0] === children[0];
  if (step.replayKind === 'micro' && (step.operation === 'ExternalMerge' || unaryProject)
    && target && !before.has(target)) {
    for (const child of children) {
      if (before.has(child) && sameMaterial(child)
        && (before.parent(child) === undefined || before.parent(child) === current.parent(target))) include(child);
    }
  }
  for (const link of currentWorkspaceMovements(step, before, current)) {
    include(link.priorSourceNodeId, true); include(link.witnessNodeId); include(link.targetNodeId);
  }
  for (const host of movementReceivingHosts(step, before, current, sameTopology)) include(host);
  for (const host of extractionReceivingHosts(step, before, current)) include(host);
  for (const root of neutralWorkspaceAttachments(step, before, current, sameMaterial)) include(root);

  // Compute ownership once per current subtree, including singleton witnesses.
  // An owned sibling must never suppress a stationary sibling's equation.
  const containsOwned = new Map<string, boolean>();
  for (const id of ids) {
    const pending = [id];
    while (pending.length) {
      const node = pending.at(-1)!;
      if (containsOwned.has(node)) { pending.pop(); continue; }
      const children = current.children(node);
      const missing = children.filter(child => !containsOwned.has(child));
      if (missing.length) { pending.push(...missing); continue; }
      containsOwned.set(node, owned.has(node) || children.some(child => containsOwned.get(child)));
      pending.pop();
    }
  }
  const stationary: string[] = [];
  for (const id of ids) {
    if (!before.has(id) || containsOwned.get(id)) continue;
    const oldParent = before.parent(id), parent = current.parent(id);
    if (!sameMaterial(id) && !(oldParent === parent && (sameTopology(id) || displayTerminalChange?.(id)))) continue;
    if (oldParent && oldParent === parent && sameMaterial(parent!) && !containsOwned.get(parent!)) continue;
    stationary.push(id);
  }
  return { owned, stationary };
}
