/**
 * The one reading of authored relations that Replay dispatches. The relation
 * render plan and the frame relations behind Replay steps both consume the
 * same dispatches over the same projected stages, so a drawing and the Replay
 * moment that owns it cannot interpret one authored claim differently.
 *
 * Stages are read as Replay adapts them: contract node fields only, in one key
 * order (`projectAuthoredSyntaxNode`), and named relations with their
 * contract fields and trimmed names. Authored keys that normalization keeps
 * but the contract ignores, and authored key order, never change a claim.
 */
import { buildDerivationReplayPlan, classifyRelationAnchors } from '../derivationReplayPlan.js';
import { type DerivationStage, type DerivationStageRelation, type SurfaceRealization, type SyntaxNode } from '../types.ts';
import { adaptDerivationStagesForReplay, getFrameDetailsRecord } from './authoredFrames.ts';
import { getReplayPlanStage } from './playbackFormatting.ts';
import { type RelationClaimDispatch } from './relations/relationClaims.ts';
import { dispatchStageRelations } from './relations/tier2RelationDispatch.ts';
import {
  type DerivationReplayPlan,
  type DerivationReplayPlanStage,
  type DerivationReplayPlanStep,
  type ReplayDerivationFrame
} from './types.ts';

export type RelationStage = {
  workspaceForest: SyntaxNode[];
  relations: DerivationStageRelation[];
  realizations?: SurfaceRealization[];
};

/** Projected stages and their ordered claim dispatches, index for index. */
export type DispatchedRelationStages = {
  stages: RelationStage[];
  dispatches: RelationClaimDispatch[][];
};

/** The named relations of one frame as Replay relation steps, in authored order. */
export const getAuthoredFrameRelations = (frame?: ReplayDerivationFrame | null, plannedStage?: DerivationReplayPlanStage | null): DerivationReplayPlanStep[] => {
  const plannedRelations = Array.isArray(plannedStage?.relationSteps) ? plannedStage.relationSteps : [];
  if (plannedRelations.length > 0)
    return plannedRelations;
  const details = getFrameDetailsRecord(frame);
  const workspaceForest = Array.isArray(frame?.workspaceForest)
    ? frame.workspaceForest
    : Array.isArray(frame?.after?.workspaceForest)
      ? frame.after.workspaceForest
      : [];
  const relations = Array.isArray(details.derivationStageRelations)
    ? details.derivationStageRelations
    : [];
  return relations
    .map<DerivationReplayPlanStep | null>((relation, authoredRelationIndex) => {
      if (!relation || typeof relation !== 'object')
        return null;
      const relationRecord = relation as Record<string, unknown>;
      const label = String(relationRecord.relation || '').trim();
      const anchors = relationRecord.anchors && typeof relationRecord.anchors === 'object' && !Array.isArray(relationRecord.anchors)
        ? relationRecord.anchors as Record<string, unknown>
        : {};
      if (!label)
        return null;
      const priorAnchors = relationRecord.priorAnchors && typeof relationRecord.priorAnchors === 'object' && !Array.isArray(relationRecord.priorAnchors)
        ? relationRecord.priorAnchors as Record<string, string | string[]>
        : undefined;
      const values = relationRecord.values && typeof relationRecord.values === 'object' && !Array.isArray(relationRecord.values)
        ? relationRecord.values as Record<string, string | string[]>
        : undefined;
      return {
        kind: 'relation',
        relation: label,
        anchors,
        ...(priorAnchors ? { priorAnchors } : {}),
        ...(values ? { values } : {}),
        ...(relationRecord.relationContractFailure && typeof relationRecord.relationContractFailure === 'object'
          ? {
            relationContractFailure: relationRecord.relationContractFailure as DerivationStageRelation['relationContractFailure'],
            movementDiagnostics: (relationRecord.relationContractFailure as {
              issues?: Array<{
                message: string;
              }>;
            })
              .issues?.map(issue => issue.message) ?? []
          } : {}),
        authoredRelationIndex,
        ...(() => {
          const { resolved, unresolved } = classifyRelationAnchors(anchors, workspaceForest);
          return {
            resolvedAnchors: resolved,
            ...(unresolved.length > 0 ? { unresolvedAnchors: unresolved } : {})
          };
        })()
      } satisfies DerivationReplayPlanStep;
    })
    .filter((relation): relation is DerivationReplayPlanStep => relation !== null);
};

// Only the contract fields of a relation step are a claim; step bookkeeping is not.
const authoredRelation = (step: DerivationReplayPlanStep): DerivationStageRelation => ({
  relation: String(step.relation),
  anchors: step.anchors as DerivationStageRelation['anchors'],
  ...(step.priorAnchors ? { priorAnchors: step.priorAnchors } : {}),
  ...(step.values ? { values: step.values } : {}),
  ...(step.relationContractFailure ? { relationContractFailure: step.relationContractFailure } : {})
});

export const relationStagesFromFrames = (
  frames: readonly ReplayDerivationFrame[],
  replayPlan?: DerivationReplayPlan | null
): RelationStage[] => frames.map((frame, index) => {
  const plannedStage = getReplayPlanStage(replayPlan, index);
  const realizations = frame.after?.realizations ?? plannedStage?.realizations;
  return {
    workspaceForest: frame.workspaceForest || [],
    relations: getAuthoredFrameRelations(frame, plannedStage).map(authoredRelation),
    ...(realizations ? { realizations } : {})
  };
});

export const dispatchRelationStages = (
  stages: RelationStage[],
  options: Parameters<typeof dispatchStageRelations>[1] = {}
): DispatchedRelationStages => ({ stages, dispatches: dispatchStageRelations(stages, options) });

/** For a caller that holds only authored stages; Replay preparation reuses its own frames and plan. */
export const projectRelationStages = (derivationStages: DerivationStage[]): RelationStage[] => (
  Array.isArray(derivationStages) && derivationStages.length > 0
    ? relationStagesFromFrames(adaptDerivationStagesForReplay(derivationStages),
      buildDerivationReplayPlan({ derivationStages }) as DerivationReplayPlan)
    : []
);
