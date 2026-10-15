// Installed before application code so automation polling cannot inflate first paint.
export function observeRendererOpening() {
  const state = window.__rendererBenchmark = { readyMs: null, settledStep: null, complete: null, workers: [] };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      const record = { terminated: false }; state.workers.push(record); this.record = record;
      this.addEventListener('message', ({ data }) => {
        const coordinates = data?.result?.coordinates;
        if (!(coordinates instanceof Map)) {
          // The pre-optimization base completed its coordinates on the main thread.
          if (Array.isArray(data?.result?.stages) && data.result.steps instanceof Map) {
            state.complete = { at: performance.now(), stages: data.result.stages.length, legacySchedule: true };
          }
          return;
        }
        let points = 0, invalid = 0;
        for (const canvases of coordinates.values()) for (const nodes of canvases.values()) for (const point of nodes.values()) {
          points++; if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) invalid++;
        }
        state.complete = { at: performance.now(), stages: coordinates.size, points, invalid };
      });
    }
    terminate() { this.record.terminated = true; return super.terminate(); }
  };
  let consecutive = 0, previous = null;
  const tick = () => {
    const svg = document.querySelector('svg[data-babel-tree]');
    const step = svg?.dataset.babelRenderedStep;
    const camera = svg?.querySelector(':scope > g')?.getAttribute('transform');
    const ready = document.fonts.status === 'loaded' && step !== undefined && camera
      && !/NaN|Infinity/.test(camera)
      && svg.querySelector('.node-group text')?.textContent.trim();
    const signature = ready ? `${step}:${camera}` : null;
    consecutive = signature ? signature === previous ? consecutive + 1 : 1 : 0;
    previous = signature;
    state.settledStep = consecutive >= 2 ? step : null;
    if (state.settledStep === '0' && state.readyMs === null) state.readyMs = performance.now();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
