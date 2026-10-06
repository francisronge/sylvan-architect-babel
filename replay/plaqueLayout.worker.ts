import { runPlaqueLayoutJob, type PlaqueLayoutJob } from './plaqueLayoutJob.ts';

self.onmessage = (event: MessageEvent<PlaqueLayoutJob>) => {
  try {
    // Only a complete stage and its entire shared camera group may be shown.
    // Keep this worker alive until all later plaque allocation also finishes.
    self.postMessage({ result: runPlaqueLayoutJob(event.data,
      progress => self.postMessage({ progress })) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
