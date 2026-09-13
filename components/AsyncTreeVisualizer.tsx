import React, { useEffect, useMemo, useRef, useState } from 'react';
import TreeVisualizer, { type TreeCameraState, type TreeVisualizerProps } from './TreeVisualizer';
import LoadingMark from './LoadingMark';
import { startReplayPreparation } from '../replay/replayWorkerClient.ts';
import type { PreparedReplay, ReplayPreparationInput } from '../replay/prepareReplay.ts';

const AsyncTreeVisualizer: React.FC<Omit<TreeVisualizerProps, 'preparedReplay' | 'manualCameraState'>> = (props) => {
  const manualCameraState = useRef<TreeCameraState | null>(null);
  const input = useMemo<ReplayPreparationInput>(() => ({
    derivationStages: props.derivationStages,
    sentence: props.sentence ?? '',
    includePlayback: Boolean(props.animated)
  }), [props.derivationStages, props.sentence, props.animated]);
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
  return <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-emerald-200">
    {current?.error ? <>
      <p role="alert">Could not prepare this view. Your analysis is unchanged.</p>
      <button className="rounded-xl border border-emerald-500/30 px-4 py-2" onClick={() => setAttempt(value => value + 1)}>Retry</button>
    </> : <div role="status">
      <span className="sr-only">{props.animated ? 'Preparing Replay' : 'Preparing tree'}</span>
      <div className="babel-preparation-mark"><LoadingMark compact /></div>
    </div>}
  </div>;
};

export default AsyncTreeVisualizer;
