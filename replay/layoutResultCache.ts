import { measuredKey, type PlaqueLayoutJob, type PlaqueLayoutResult } from './plaqueLayoutJob.ts';

/** Keep the two most recent layouts in memory only. Reuse requires exact input
 * and freshly measured fonts; every hit still goes through normal result binding.
 * Copies prevent a view from mutating the next view's cached schedule. */
export function createLayoutResultCache() {
  const entries: Array<{ input: string; metrics: string; result: PlaqueLayoutResult }> = [];
  return {
    get empty() { return entries.length === 0; },
    get(job: PlaqueLayoutJob): PlaqueLayoutResult | undefined {
      const metrics = measuredKey(job);
      const index = entries.findIndex(entry => entry.input === job.inputKey && entry.metrics === metrics);
      if (index < 0) return undefined;
      const [entry] = entries.splice(index, 1); entries.push(entry);
      return { ...structuredClone(entry.result), requestKey: job.requestKey };
    },
    put(job: PlaqueLayoutJob, result: PlaqueLayoutResult) {
      const metrics = measuredKey(job);
      if (result.requestKey !== job.requestKey || result.measurementKey !== metrics) return;
      // Large one-off analyses should not occupy retained UI memory.
      if (job.inputKey.length + metrics.length > 2_000_000) return;
      const index = entries.findIndex(entry => entry.input === job.inputKey && entry.metrics === metrics);
      if (index >= 0) entries.splice(index, 1);
      entries.push({ input: job.inputKey, metrics, result: structuredClone(result) });
      if (entries.length > 2) entries.shift();
    }
  };
}

export const recentLayoutResults = createLayoutResultCache();
