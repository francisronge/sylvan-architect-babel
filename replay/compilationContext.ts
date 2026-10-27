/** Per-compilation identity, authored relation cache, and preceding-stage visibility. */
import { caseSurfaceInitial, resolveSavedInputTokens } from '../server/babelParser/surfaceTokens.js';
import { stageContinuedOccurrences } from './continuedOccurrences.ts';
import { createReplayIdentityContext } from './displayIdentity.ts';
import { createFrameRelationResolver } from './frameRelations.ts';
import { isRegisteredFrontingTrajectoryRelation } from './relations/movementIdentities.ts';
import { getReplayPlanStage } from './playbackFormatting.ts';
import { normalizeToken } from './syntaxForest.ts';
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
  const previousWorkspaceRootIds = new Set<string>();
  const sentenceInitialSurface = String(resolveSavedInputTokens(sentence, inputTokens)[0] || '').trim();
  const firstFrontingStageIndex = (() => {
    const stages = Array.isArray(replayPlan?.stages) ? replayPlan.stages : [];
    for (const stage of stages) {
      const relationSteps = Array.isArray(stage?.relationSteps) ? stage.relationSteps : [];
      if (!relationSteps.some((relation) => isRegisteredFrontingTrajectoryRelation(relation?.relation, relation?.anchors)))
        continue;
      const stageIndex = Number(stage?.stageIndex);
      return Number.isFinite(stageIndex) ? stageIndex : -1;
    }
    return -1;
  })();
  const getPreFrontingLexicalSurface = (surface: string, frameIndex: number): string => {
    const trimmed = String(surface || '').trim();
    if (!trimmed
      || !sentenceInitialSurface
      || firstFrontingStageIndex <= frameIndex
      || normalizeToken(trimmed) !== normalizeToken(sentenceInitialSurface)) {
      return trimmed;
    }
    return caseSurfaceInitial(trimmed, 'lower');
  };
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
    previousWorkspaceRootIds,
    getPreFrontingLexicalSurface,
    plannedStageCount,
    sentenceInitialSurface
  };
};

export type ReplayCompilation = ReturnType<typeof createReplayCompilation>;
