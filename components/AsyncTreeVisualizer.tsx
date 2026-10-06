import React, { useEffect, useMemo, useRef, useState } from 'react';
import TreeVisualizer, { type TreeCameraState, type TreeVisualizerProps } from './TreeVisualizer';
import LoadingMark from './LoadingMark';
import { startReplayPreparation } from '../replay/replayWorkerClient.ts';
import type { PreparedReplay, ReplayPreparationInput } from '../replay/prepareReplay.ts';
import ViewErrorBoundary, { ViewFailure } from './ViewErrorBoundary';

type AsyncTreeVisualizerProps = Omit<TreeVisualizerProps, 'preparedReplay' | 'manualCameraState'>;

const PreparedTreeVisualizer: React.FC<AsyncTreeVisualizerProps> = (props) => {
  const manualCameraState = useRef<TreeCameraState | null>(null);
  const input = useMemo<ReplayPreparationInput>(() => ({
    derivationStages: props.derivationStages,
    sentence: props.sentence ?? '',
    inputTokens: props.inputTokens,
    includePlayback: Boolean(props.animated)
  }), [props.derivationStages, props.sentence, props.inputTokens, props.animated]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    input: ReplayPreparationInput; attempt: number; result?: PreparedReplay; error?: Error;
  } | null>(null);
  useEffect(() => startReplayPreparation(input,
    result => setState({ input, attempt, result }),
    error => setState({ input, attempt, error })
  ), [input, attempt]);
  // An old analysis must disappear immediately, before effect cleanup runs.
  const current = state?.input === input && state.attempt === attempt ? state : null;
  if (current?.result) return <TreeVisualizer {...props} preparedReplay={current.result} manualCameraState={manualCameraState} />;
  if (current?.error) return <ViewFailure error={current.error} title="Could not prepare this view."
    onRetry={() => setAttempt(value => value + 1)} />;
  return <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-emerald-200">
    <div role="status" aria-label="Loading">
      <div className="babel-preparation-mark"><LoadingMark compact /></div>
    </div>
  </div>;
};

const AsyncTreeVisualizer: React.FC<AsyncTreeVisualizerProps> = (props) => {
  const resetKey = useMemo(() => ({}), [props.data, props.derivationStages, props.sentence, props.inputTokens, props.animated]);
  return <ViewErrorBoundary resetKey={resetKey}><PreparedTreeVisualizer {...props} /></ViewErrorBoundary>;
};

export default AsyncTreeVisualizer;
