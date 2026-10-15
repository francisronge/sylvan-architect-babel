/** Names, recipes, and progress metadata for compiled structural steps. */
import { type DerivationOperation } from '../types.ts';
import {
  formatOperationLabel,
  formatReplayLabelSeries,
  isGenericReplayStructuralLabel
} from './replayPanelFormatting.ts';
import { isNullLike, isTraceLike } from './replaySurfaceNotation.ts';
import { type DerivationReplayPlan, type DerivationReplayPlanStage, type PlaybackStep } from './types.ts';

export const STEP_DELAY_MS = 1000;

/** The first non-blank authored text. Prose is never classified as boilerplate. */
export const pickPreferredReplayText = (...values: Array<string | undefined | null>): string | undefined => {
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (trimmed)
      return trimmed;
  }
  return undefined;
};

export const buildStructuralReplayFallback = (
  operation: DerivationOperation | string | undefined,
  primaryRootLabel: string,
  rootLabels: string[]
): string => {
  const op = String(operation || '').trim();
  const readableOperation = formatOperationLabel(op as DerivationOperation);
  const target = primaryRootLabel || rootLabels[0] || 'workspace';
  const targetSummary = rootLabels.length > 1 ? rootLabels.join(' + ') : target;
  const targetIsTraceLike = isTraceLike(target) || isNullLike(target);
  const describesWorkspaceState = target === 'Workspace';
  switch (op) {
    case 'LexicalSelect':
      return `Select ${targetSummary}`;
    case 'Project':
      return `Project ${targetSummary}`;
    case 'ExternalMerge':
      if (targetIsTraceLike)
        return 'External merge in workspace';
      if (describesWorkspaceState) {
        const mergeSourceSummary = formatReplayLabelSeries(rootLabels);
        return mergeSourceSummary ? `External merge of ${mergeSourceSummary}` : 'External merge in workspace';
      }
      return `External merge into ${target}`;
    case 'InternalMerge':
    case 'Move':
      return (targetIsTraceLike || describesWorkspaceState || isGenericReplayStructuralLabel(target)) ? 'Internal merge' : `Internal merge to ${target}`;
    case 'A-Move':
      return (targetIsTraceLike || describesWorkspaceState || isGenericReplayStructuralLabel(target)) ? 'A-movement' : `A-movement to ${target}`;
    case 'AbarMove':
      return (targetIsTraceLike || describesWorkspaceState || isGenericReplayStructuralLabel(target)) ? 'A-bar movement' : `A-bar movement to ${target}`;
    case 'HeadMove':
      return (targetIsTraceLike || describesWorkspaceState || isGenericReplayStructuralLabel(target)) ? 'Head movement' : `Head movement to ${target}`;
    case 'Agree':
      return `Agree on ${target}`;
    case 'Other':
      return target && target !== 'Workspace' ? `Establish ${target}` : 'Update derivational workspace';
    default:
      if (!op)
        return target && target !== 'Workspace' ? `Establish ${target}` : 'Update derivational workspace';
      if (/(?:move|movement|raise|lower|front|displac|extract|shift|scrambl|rollup|sideward|incorpor|clitic|affix|remnant|piedpip|topicaliz|focaliz|extraposit|atb|remerge)/i.test(op)) {
        return readableOperation;
      }
      return target && target !== 'Workspace'
        ? `${readableOperation} to ${target}`
        : readableOperation;
  }
};

export const getReplayPlanStage = (plan: DerivationReplayPlan | null | undefined, stageIndex: number): DerivationReplayPlanStage | null => {
  const stages = Array.isArray(plan?.stages) ? plan.stages : [];
  return stages.find((stage) => Number(stage?.stageIndex) === stageIndex) || null;
};

export const buildReplayProgressLabel = (
  stage: DerivationReplayPlanStage | null | undefined,
  stageCount: number,
  stepNumber: number,
  stepCount: number
): string | undefined => {
  if (!stage || !Number.isFinite(stage.stageNumber) || stage.stageNumber <= 0 || stageCount <= 0 || stepCount <= 0) {
    return undefined;
  }
  return `Stage ${stage.stageNumber}/${stageCount} \u00b7 Step ${stepNumber}/${stepCount}`;
};

export const stripSemanticPayloadFromMicrostep = (step: PlaybackStep): PlaybackStep => ({
  ...step,
  sourceKind: 'microstep',
  detailBlocks: undefined,
  note: undefined,
  movementSerializationStatus: undefined,
  movementDiagnostics: undefined
});
