import { recentLayoutResults } from '../replay/layoutResultCache.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReplayPlaqueSchedule, StageLayoutInput } from '../replay/stageCamera.ts';
import { bindPlaqueLayoutResult, bindPlaqueLayoutProgress, completePlaqueLayoutResult, measurePlaqueLayoutJob, plaqueLayoutViewportKey, type PlaqueLayoutResult, type PlaqueLayoutProgress, type PreparedPlaqueLayout, type PlaqueLayoutJob } from '../replay/plaqueLayoutJob.ts';
import { startQueuedLayoutJob } from '../replay/layoutWorkerQueue.ts';
const empty: ReplayPlaqueSchedule = { stages: [], steps: new Map() };

/** Everything a Replay layout depends on except the viewport. Each object is
 * one immutable content revision; any change must pass a new object. */
export type ReplayLayoutContent = Omit<StageLayoutInput, 'width' | 'height'>;
type LayoutRequest = { input: StageLayoutInput; attempt: number; layout?: PreparedPlaqueLayout;
  preparedStages?: readonly number[]; earlyDelivery?: { layout: PreparedPlaqueLayout; preparedStages: readonly number[] }; error?: string };

/**
 * Prepares one content revision for a viewport. The returned `viewport`,
 * `schedule` and `coordinates` are one displayed snapshot and always belong
 * together. A viewport with an unchanged layout key reuses the prepared layout
 * at once. Otherwise the last displayed snapshot of the same revision stays,
 * with the viewport it was drawn for, until the new request covers the
 * displayed camera group. A new revision never displays earlier geometry.
 */
export function useReplayPlaqueLayout<V extends { width: number; height: number }>(
  content: ReplayLayoutContent | null, viewport: V, stageIndex = 0) {
  const requestedStage = useRef(stageIndex);
  requestedStage.current = stageIndex;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LayoutRequest>();
  const key = useMemo(() => content && viewport.width > 0
    ? plaqueLayoutViewportKey({ ...content, width: viewport.width, height: viewport.height }) : null,
  [content, viewport.width, viewport.height]);
  // Viewports with equal keys prepare the same layout, so a request keeps its first viewport.
  const input = useMemo<StageLayoutInput | null>(() => content && key !== null
    ? { ...content, width: viewport.width, height: viewport.height } : null, [content, key]);
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
  const cameraGroup = content?.layoutGroups?.find(group => group.includes(stageIndex)) ?? [stageIndex];
  const covers = (request?: LayoutRequest) => Boolean(request?.layout && (!request.preparedStages
    || cameraGroup.every(stage => request.preparedStages!.includes(stage))));
  // Kept apart from the active request, so its partial progress cannot discard
  // usable geometry. The last displayed snapshot may be partial; the last
  // complete one, with its own viewport, covers stages the partial does not.
  type Snapshot = { content: ReplayLayoutContent; viewport: V; request: LayoutRequest };
  const shown = useRef<Snapshot>(undefined), completed = useRef<Snapshot>(undefined);
  if (content && covers(current)) {
    shown.current = { content, viewport, request: current! };
    if (!current!.preparedStages) completed.current = shown.current;
  }
  const usable = (snapshot?: Snapshot) => snapshot?.content === content && covers(snapshot.request) ? snapshot : undefined;
  const displayed = !content ? { viewport, request: undefined }
    : covers(current) ? shown.current : current?.error ? undefined : usable(shown.current) ?? usable(completed.current);
  const request = displayed?.request;
  // Later-stage completion must not invalidate the camera inputs of an already
  // displayed group. Keep its immutable early delivery; other groups use full data.
  const layout = request?.earlyDelivery && cameraGroup.every(stage => request.earlyDelivery!.preparedStages.includes(stage))
    ? request.earlyDelivery.layout : request?.layout;
  return { viewport: displayed?.viewport, schedule: layout?.schedule ?? empty, coordinates: layout?.coordinates,
    ready: Boolean(displayed), error: current?.error, retry: () => setAttempt(value => value + 1) };
}
