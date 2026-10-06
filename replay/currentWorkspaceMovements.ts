import type { ResolvedRelationLink } from '../relationLinks.ts';
import type { PlaybackStep } from './replayCompiler.ts';

type CurrentNodes = { has(id: string): boolean };
export type CurrentWorkspaceMovement = ResolvedRelationLink & {
  priorSourceNodeId: string; witnessNodeId: string; targetNodeId: string;
};
/** Structural motion belongs to the compiler's current proved transition, even
 * when its presentation is an identity or scope mark instead of a trajectory. */
export function currentWorkspaceMovements(step: PlaybackStep, before: CurrentNodes, current: CurrentNodes): readonly CurrentWorkspaceMovement[] {
  const identity = step.replayRelationIdentity;
  if (step.replayKind !== 'relation' || !identity) return [];
  const key = `${identity.stageIndex}:${identity.relationIndex}`;
  return (step.replayRelationLinks ?? []).filter((link): link is CurrentWorkspaceMovement => {
    const proved = link.movementTransition === true
      || (link.movementTransition === undefined && link.renderFamily === 'trajectory');
    return proved && link.authoredRelationKey === key
      && !!link.priorSourceNodeId && before.has(link.priorSourceNodeId)
      && !!link.witnessNodeId && current.has(link.witnessNodeId)
      && !!link.targetNodeId && current.has(link.targetNodeId) && link.targetNodeId !== link.witnessNodeId;
  });
}
