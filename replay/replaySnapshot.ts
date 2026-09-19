import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import type { ParseBundle, SurfaceRealization } from '../types.ts';
import { cloneRealizations } from './realizationReplay.ts';
import { collectPronouncedTerminalSequence } from './pronouncedTerminals.ts';
import {
  adaptDerivationStagesForReplay,
  buildPlaybackStepsFromDerivationFrames,
  type DerivationReplayPlan,
  type PlaybackStep
} from './replayCompiler.ts';

export interface ReplayStepProjection {
  operation: string;
  replayKind: PlaybackStep['replayKind'] | null;
  targetNodeId: string;
  sourceNodeIds: string[];
  replayProgressLabel: string;
  replayVisibleNodeIds: string[];
  replayRealizations?: SurfaceRealization[];
  replayRealizationDiagnostics?: string[];
}

export interface ReplaySnapshotProjection {
  schemaVersion: 1;
  sentence: string;
  stepCount: number;
  steps: ReplayStepProjection[];
}

export interface ReplayPlayback {
  sentence: string;
  steps: PlaybackStep[];
}

const projectReplayStep = (step: PlaybackStep): ReplayStepProjection => ({
  operation: String(step.operation || ''),
  replayKind: step.replayKind || null,
  targetNodeId: String(step.targetNodeId || ''),
  sourceNodeIds: (Array.isArray(step.sourceNodeIds) ? step.sourceNodeIds : [])
    .map((nodeId) => String(nodeId || '')),
  replayProgressLabel: String(step.replayProgressLabel || ''),
  replayVisibleNodeIds: (Array.isArray(step.replayVisibleNodeIds) ? step.replayVisibleNodeIds : [])
    .map((nodeId) => String(nodeId || '')),
  ...(step.replayRealizations ? { replayRealizations: cloneRealizations(step.replayRealizations) } : {}),
  ...(step.replayRealizationDiagnostics ? { replayRealizationDiagnostics: [...step.replayRealizationDiagnostics] } : {})
});

export const buildReplayPlayback = (bundle: ParseBundle): ReplayPlayback => {
  const analysis = bundle?.analyses?.[0];
  if (!analysis) throw new Error('Replay snapshot requires at least one analysis.');
  const derivationStages = Array.isArray(analysis.derivationStages)
    ? analysis.derivationStages
    : [];
  const suppliedSentence = String(bundle.sentence || '').trim();
  if (!suppliedSentence && derivationStages.some(stage => stage.realizations?.length)) {
    throw new Error('Replay with realization groups requires the original input sentence.');
  }
  const sentence = suppliedSentence
    || collectPronouncedTerminalSequence(analysis.tree).join(' ');
  const frames = adaptDerivationStagesForReplay(derivationStages);
  const replayPlan = buildDerivationReplayPlan({ derivationStages }) as DerivationReplayPlan;
  const steps = buildPlaybackStepsFromDerivationFrames(
    frames,
    sentence,
    replayPlan,
    bundle.inputTokens
  );

  return { sentence, steps };
};

export const buildReplaySnapshotProjection = (bundle: ParseBundle): ReplaySnapshotProjection => {
  const { sentence, steps } = buildReplayPlayback(bundle);

  return {
    schemaVersion: 1,
    sentence,
    stepCount: steps.length,
    steps: steps.map(projectReplayStep)
  };
};
