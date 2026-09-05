import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import type { ParseBundle } from '../types.ts';
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
    .map((nodeId) => String(nodeId || ''))
});

export const buildReplayPlayback = (bundle: ParseBundle): ReplayPlayback => {
  const analysis = bundle?.analyses?.[0];
  if (!analysis) throw new Error('Replay snapshot requires at least one analysis.');
  const derivationStages = Array.isArray(analysis.derivationStages)
    ? analysis.derivationStages
    : [];
  const sentence = String(bundle.sentence || '').trim()
    || collectPronouncedTerminalSequence(analysis.tree).join(' ');
  const frames = adaptDerivationStagesForReplay(derivationStages);
  const replayPlan = buildDerivationReplayPlan({ derivationStages }) as DerivationReplayPlan;
  const steps = buildPlaybackStepsFromDerivationFrames(
    frames,
    sentence,
    replayPlan
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
