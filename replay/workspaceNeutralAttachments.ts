import type { PlaybackStep } from './replayCompiler.ts';
import type { CurrentWorkspaceTopology } from './workspaceReceivingHost.ts';

/** A neutral rewrite can attach existing material without proving a linguistic
 * movement chain. Only its actual changed attachments permit rigid translation;
 * naming an unchanged participant or changing its pronunciation does not. */
export function neutralWorkspaceAttachments(
  step: PlaybackStep, before: CurrentWorkspaceTopology, current: CurrentWorkspaceTopology,
  sameMaterial: (id: string) => boolean,
): ReadonlySet<string> {
  const identity = step.replayRelationIdentity, proof = step.replayTreeTransition;
  const roots = new Set<string>();
  if (step.replayKind !== 'relation' || !identity || !proof
    || proof.relationKey !== `${identity.stageIndex}:${identity.relationIndex}`
    || !proof.priorNodeIds.length || !proof.currentNodeIds.length) return roots;
  const prior = new Set(proof.priorNodeIds), present = new Set(proof.currentNodeIds);
  // The compiler's sets may include display-independent IDs; only current,
  // uniquely represented structural witnesses participate in this boundary.
  if (![...prior].some(id => before.has(id))) return roots;
  for (const id of present) {
    if (!before.has(id) || !current.has(id) || !prior.has(id) || !sameMaterial(id)) continue;
    if (before.parent(id) !== current.parent(id)) roots.add(id);
  }
  for (const anchor of present) {
    if (!current.has(anchor) || before.has(anchor)) continue;
    let branch = anchor;
    for (let wrapper = current.parent(branch); wrapper && !before.has(wrapper); wrapper = current.parent(branch)) {
      const children = current.children(wrapper);
      // A new unary shell on this exact branch introduces no competing host.
      // Continue to the binary attachment; old ancestors still stop the loop.
      if (children.length === 1 && children[0] === branch) {
        branch = wrapper;
        continue;
      }
      const siblings = children.filter(id => id !== branch);
      const oldOwner = current.parent(wrapper);
      // One new branch wraps one complete retained host in that host's old
      // parent slot. Extra old branches or a moved-from-elsewhere host give no proof.
      if (siblings.length !== 1 || !before.has(siblings[0]) || !sameMaterial(siblings[0])
        || before.parent(siblings[0]) !== oldOwner) break;
      const host = siblings[0];
      if (oldOwner) {
        const oldChildren = before.children(oldOwner), nextChildren = current.children(oldOwner);
        if (oldChildren.length !== nextChildren.length
          || !oldChildren.every((id, index) => (id === host ? wrapper : id) === nextChildren[index])) break;
      }
      roots.add(host);
      branch = wrapper;
    }
  }
  return roots;
}
