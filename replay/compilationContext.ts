/** Per-compilation identity, authored relation cache, and preceding-stage visibility. */
import { resolveSavedInputTokens } from '../server/babelParser/surfaceTokens.js';
import { stageContinuedOccurrences } from './continuedOccurrences.ts';
import { createReplayIdentityContext } from './displayIdentity.ts';
import { createFrameRelationResolver } from './frameRelations.ts';
import { getReplayPlanStage } from './playbackFormatting.ts';
import { type DerivationReplayPlan, type DerivationReplayPlanStep, type ReplayDerivationFrame } from './types.ts';

export interface ReplayCompilationInput {
  frames: ReplayDerivationFrame[];
  sentence?: string;
  replayPlan?: DerivationReplayPlan | null;
  inputTokens?: string[];
  frameRelations?: (frameIndex: number) => DerivationReplayPlanStep[];
}

export const createReplayCompilation = ({
  frames,
  sentence,
  replayPlan,
  inputTokens,
  frameRelations
}: ReplayCompilationInput) => {
  const identity = createReplayIdentityContext(frames.flatMap(frame => frame.workspaceForest || []));
  const plannedStageCount = Array.isArray(replayPlan?.stages) ? replayPlan.stages.length : 0;
  const plannedRelationsByFrame: DerivationReplayPlanStep[][] = [];
  const resolveFrameRelations = frameRelations ?? createFrameRelationResolver(frames, replayPlan);
  // A saved unary shell withheld from its first stage until the earliest
  // moment of the relations that own its second child at `stageIndex`.
  const pendingProjectionReveals: Array<{
    nodeId: string;
    firstStageIndex: number;
    stageIndex: number;
    relationIndexes: number[];
  }> = [];
  // Each stage's continuations of its preceding stage, `previous id -> current id`.
  const continuations = new Map<number, Map<string, string>>();
  const plannedRelations = (stage: number) => getReplayPlanStage(replayPlan, stage) ? resolveFrameRelations(stage) : [];
  const continuedOccurrenceIds = (index: number): Map<string, string> => {
    if (!continuations.has(index)) continuations.set(index, index > 0
      ? stageContinuedOccurrences(frames, index, plannedRelations(index), plannedRelations)
      : new Map());
    return continuations.get(index)!;
  };
  const previousVisibleNodeIds = new Set<string>();
  const sentenceInitialSurface = String(resolveSavedInputTokens(sentence, inputTokens)[0] || '').trim();
  return {
    frames,
    sentence,
    replayPlan,
    inputTokens,
    resolveFrameRelations,
    plannedRelationsByFrame,
    pendingProjectionReveals,
    previousVisibleNodeIds,
    continuedOccurrenceIds,
    identity,
    plannedStageCount,
    sentenceInitialSurface
  };
};

export type ReplayCompilation = ReturnType<typeof createReplayCompilation>;
