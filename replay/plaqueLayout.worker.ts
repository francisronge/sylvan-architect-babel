import { runPlaqueLayoutJob, type PlaqueLayoutJob } from './plaqueLayoutJob.ts';

self.onmessage = (event: MessageEvent<PlaqueLayoutJob>) => {
  try {
    self.postMessage({ result: runPlaqueLayoutJob(event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
