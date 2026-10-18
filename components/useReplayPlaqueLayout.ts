import { recentLayoutResults } from '../replay/layoutResultCache.ts';
import { useEffect, useRef, useState } from 'react';
import type { ReplayPlaqueSchedule, StageLayoutInput } from '../replay/stageCamera.ts';
import { bindPlaqueLayoutResult, bindPlaqueLayoutProgress, completePlaqueLayoutResult, measurePlaqueLayoutJob, type PlaqueLayoutResult, type PlaqueLayoutProgress, type PreparedPlaqueLayout, type PlaqueLayoutJob } from '../replay/plaqueLayoutJob.ts';
import { startQueuedLayoutJob } from '../replay/layoutWorkerQueue.ts';
const empty: ReplayPlaqueSchedule = { stages: [], steps: new Map() };

function differsOnlyInViewport(previous: StageLayoutInput, next: StageLayoutInput) {
  const a = previous as Record<string, unknown>, b = next as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .every(key => key === 'width' || key === 'height' || Object.is(a[key], b[key]));
}

/** `preparedInput` names the input the returned layout belongs to. After a
 * viewport-only change it stays the preceding input, whose completed layout
 * remains displayable until the new viewport's layout is ready; consumers lay
 * out and fit with that input's own viewport. Every other change hides it. */
export function useReplayPlaqueLayout(input: StageLayoutInput | null, stageIndex = 0) {
  const requestedStage = useRef(stageIndex);
  requestedStage.current = stageIndex;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ input: StageLayoutInput; attempt: number; layout?: PreparedPlaqueLayout;
    preparedStages?: readonly number[]; earlyDelivery?: { layout: PreparedPlaqueLayout; preparedStages: readonly number[] }; error?: string }>();
  useEffect(() => {
    if (!input) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let stopWorker: (() => void) | undefined;
    let early: { progress: PlaqueLayoutProgress; layout: PreparedPlaqueLayout } | undefined;
    const measurements = measurePlaqueLayoutJob(input);
    const fail = (error: Error) => {
      if (!active) return;
      active = false;
      clearTimeout(timer); stopWorker?.(); measurements.return(undefined);
      setState({ input, attempt, error: error.message });
    };
    let job: PlaqueLayoutJob | undefined;
    let measuredReady: ((job: PlaqueLayoutJob) => void) | undefined;
    const start = (pending: PlaqueLayoutJob | Promise<PlaqueLayoutJob>) => {
      stopWorker = startQueuedLayoutJob(pending,
          (result: PlaqueLayoutResult) => {
            if (!active) return;
            try {
              const layout = completePlaqueLayoutResult(input, job!, result, early);
              recentLayoutResults.put(job!, result);
              setState({ input, attempt, layout,
                earlyDelivery: early ? { layout: early.layout, preparedStages: early.progress.preparedStages } : undefined });
            }
            catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
          }, fail,
          () => new Worker(new URL('../replay/plaqueLayout.worker.ts', import.meta.url), { type: 'module' }),
          (progress: PlaqueLayoutProgress) => {
            if (!active) return;
            const layout = bindPlaqueLayoutProgress(input, job!, progress);
            early = { progress, layout };
            setState({ input, attempt, layout, preparedStages: progress.preparedStages });
          });
    };
    // Compile the serial worker while native font probes yield on the UI thread.
    // A possible cache hit keeps the existing no-worker path.
    if (recentLayoutResults.empty) {
      const pending = new Promise<PlaqueLayoutJob>(resolve => { measuredReady = resolve; });
      start(pending);
    }
    const measure = () => {
      if (!active) return;
      try {
        const deadline = performance.now() + 8;
        let next = measurements.next();
        while (!next.done && performance.now() < deadline) next = measurements.next();
        if (!next.done) { timer = setTimeout(measure, 0); return; }
        job = next.value;
        const cached = recentLayoutResults.get(job);
        if (cached) {
          stopWorker?.();
          setState({ input, attempt, layout: bindPlaqueLayoutResult(input, job, cached) });
          return;
        }
        job.progressStage = requestedStage.current;
        if (measuredReady) measuredReady(job);
        else start(job);
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    };
    if (active) timer = setTimeout(measure, 0);
    return () => { active = false; clearTimeout(timer); stopWorker?.(); measurements.return(undefined); };
  }, [input, attempt]);
  const current = state?.input === input && state.attempt === attempt ? state : undefined;
  const cameraGroup = input?.layoutGroups?.find(group => group.includes(stageIndex)) ?? [stageIndex];
  const prepared = (entry: typeof state) => Boolean(entry?.layout && (!entry.preparedStages
    || cameraGroup.every(stage => entry.preparedStages!.includes(stage))));
  const retained = !current && input && state && state.attempt === attempt && prepared(state)
    && differsOnlyInViewport(state.input, input) ? state : undefined;
  const shown = retained ?? current;
  // Later-stage completion must not invalidate the camera inputs of an already
  // displayed group. Keep its immutable early delivery; other groups use full data.
  const layout = shown?.earlyDelivery && cameraGroup.every(stage => shown.earlyDelivery!.preparedStages.includes(stage))
    ? shown.earlyDelivery.layout : shown?.layout;
  return { schedule: layout?.schedule ?? empty, coordinates: layout?.coordinates,
    ready: !input || prepared(shown), preparedInput: layout ? shown!.input : undefined,
    error: current?.error, retry: () => setAttempt(value => value + 1) };
}
