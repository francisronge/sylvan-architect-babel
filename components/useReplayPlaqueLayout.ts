import { useEffect, useState } from 'react';
import type { StageLayoutInput } from '../replay/stageCamera.ts';
import { measurePlaqueLayoutJob } from '../replay/plaqueLayoutJob.ts';
import { startWorkerJob } from '../replay/replayWorkerClient.ts';
import type { PlaquePlacement } from '../replay/relations/plaquePlacement.ts';

type Layouts = Map<number, PlaquePlacement>[];
const empty: Layouts = [];

export function useReplayPlaqueLayout(input: StageLayoutInput | null) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ input: StageLayoutInput; attempt: number; layouts?: Layouts; error?: string }>();
  useEffect(() => {
    if (!input) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let stopWorker: (() => void) | undefined;
    const measurements = measurePlaqueLayoutJob(input);
    const fail = (error: Error) => {
      if (active) setState({ input, attempt, error: error.message });
    };
    const measure = () => {
      if (!active) return;
      try {
        const deadline = performance.now() + 8;
        let next = measurements.next();
        while (!next.done && performance.now() < deadline) next = measurements.next();
        if (!next.done) { timer = setTimeout(measure, 0); return; }
        stopWorker = startWorkerJob(next.value,
          (layouts: Layouts) => { if (active) setState({ input, attempt, layouts }); }, fail,
          () => new Worker(new URL('../replay/plaqueLayout.worker.ts', import.meta.url), { type: 'module' }));
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    };
    timer = setTimeout(measure, 0);
    return () => { active = false; clearTimeout(timer); stopWorker?.(); measurements.return(undefined); };
  }, [input, attempt]);
  const current = state?.input === input && state.attempt === attempt ? state : undefined;
  return { layouts: current?.layouts ?? empty, ready: !input || Boolean(current?.layouts),
    error: current?.error, retry: () => setAttempt(value => value + 1) };
}
