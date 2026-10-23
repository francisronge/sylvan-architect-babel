/** The authored relations a Replay step plays: a relation moment's own relation, then any true
 * duplicates that share its moment (`replaySharedRelationIdentities`). Empty for other steps. */
import type { PlaybackStep } from './types.ts';

export const momentRelationIdentities = (step: PlaybackStep | null | undefined): Array<{ stageIndex: number; relationIndex: number }> =>
  step?.replayKind === 'relation' && step.replayRelationIdentity
    ? [step.replayRelationIdentity, ...(step.replaySharedRelationIdentities ?? [])] : [];
