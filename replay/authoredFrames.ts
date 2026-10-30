/** Adapt completed authored stages to the compiler input shape. */
import { type DerivationStage, type SurfaceRealization } from '../types.ts';
import { cloneRealizations } from './realizationReplay.ts';
import { cloneSyntaxForest, projectAuthoredSyntaxNode } from './syntaxForest.ts';
import {
  type DerivationReplayPlanStage,
  type ReplayDerivationChange,
  type ReplayDerivationFrame
} from './types.ts';

export const getMovementLandingNodeId = (movement?: {
  landingNodeId?: string;
  targetNodeId?: string;
  toNodeId?: string;
} | null): string => String(movement?.landingNodeId
  || movement?.targetNodeId
  || movement?.toNodeId
  || '');

export const getDerivationFrameChange = (frame?: ReplayDerivationFrame | null): ReplayDerivationChange | null => frame?.change && typeof frame.change === 'object' && !Array.isArray(frame.change)
  ? frame.change
  : null;

/** `spellingGroups` are the analysis's conversion-made groups (Provenance.spellingGroups);
 * each stage that holds one records it as spelled. */
export const adaptDerivationStagesForReplay = (stages?: DerivationStage[] | null,
  spellingGroups: readonly SurfaceRealization[] = []): ReplayDerivationFrame[] => {
  if (!Array.isArray(stages) || stages.length === 0)
    return [];
  const key = (group: SurfaceRealization) => JSON.stringify([group.nodeIds, group.tokenIndices]);
  const spelled = new Set(spellingGroups.map(key));
  return stages.map((stage, index) => {
    const spelledRealizations = Array.isArray(stage.realizations) ? stage.realizations.filter(group => spelled.has(key(group))) : [];
    const explicitWorkspaceForest = Array.isArray(stage.workspaceForest) ? stage.workspaceForest : [];
    const workspaceForest = cloneSyntaxForest(explicitWorkspaceForest).map(projectAuthoredSyntaxNode);
    const relations = Array.isArray(stage.relations) ? stage.relations : [];
    const details = {
      stageRecord: String(stage.stageRecord || '').trim(),
      derivationStageRelations: relations
    };
    const change: ReplayDerivationChange = {
      statement: String(stage.statement || '').trim(),
      details
    };
    return {
      frameId: `stage-${index + 1}`,
      stepId: `stage-${index + 1}`,
      statement: String(stage.statement || '').trim(),
      stageRecord: String(stage.stageRecord || '').trim(),
      relations,
      after: {
        workspaceForest,
        ...(Array.isArray(stage.realizations) ? { realizations: cloneRealizations(stage.realizations) } : {}),
        ...(spelledRealizations.length ? { spelledRealizations: cloneRealizations(spelledRealizations) } : {})
      },
      change,
      workspaceForest,
      recipe: String(change?.statement || '').trim() || undefined,
      movement: null
    };
  });
};

export const getFrameDetailsRecord = (frame?: ReplayDerivationFrame | null): Record<string, unknown> => (frame?.change?.details && typeof frame.change.details === 'object' && !Array.isArray(frame.change.details)
  ? frame.change.details as Record<string, unknown>
  : {});

export const getFrameStageRecordText = (frame?: ReplayDerivationFrame | null, plannedStage?: DerivationReplayPlanStage | null): string => {
  const details = getFrameDetailsRecord(frame);
  return String(plannedStage?.stageRecord
    || details.stageRecord
    || '').trim();
};

