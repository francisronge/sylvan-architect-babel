import { select } from 'd3';

// Camera tests run the real fitting pipeline with synchronous reduced motion.
// Only the final D3 transform application is captured instead of updating a browser.
// With `reducedMotion: false`, animations run on a controlled clock: `advance(ms)`
// moves time and runs the pending animation frames. `paints` records every
// applied transform and `frames` holds the pending frame callbacks.
export function createCameraHarness(Element, {
  width, height, data = {}, step = 0, animated = false, signature = 'saved-stage-records',
  auto = { current: null }, manual = { current: null }, reducedMotion = true
}) {
  const svg = new Element('svg');
  let painted;
  const paints = [];
  const session = {
    cameraRuntime: { applying: false, cancel: undefined, deferred: null },
    svg: select(svg), svgRef: { current: svg },
    zoom: { transform: (_selection, transform) => { svg.__zoom = transform; painted = transform; paints.push(transform); } },
    autoCameraRef: auto, manualCameraRef: manual, animated, data,
    derivationStagesSignature: signature, fitRevision: 0,
    containerWidth: width, containerHeight: height, activeStepIndex: step,
    cameraAnimationRef: { current: null }, reportViewError: error => { throw error; }
  };
  let now = 0, nextFrame = 1;
  const frames = new Map();
  const window = { matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame: callback => { frames.set(nextFrame, callback); return nextFrame++; },
    cancelAnimationFrame: id => { frames.delete(id); } };
  const performance = { now: () => now };
  const withClock = operation => {
    const previous = { window: globalThis.window, performance: globalThis.performance };
    Object.assign(globalThis, { window, performance });
    try { return operation(); }
    finally {
      if (previous.window === undefined) delete globalThis.window;
      else globalThis.window = previous.window;
      globalThis.performance = previous.performance;
    }
  };
  return { session, paints, frames, group: select(new Element('g')),
    run: operation => withClock(() => { operation(); return painted; }),
    advance: ms => withClock(() => {
      now += ms;
      const due = [...frames.values()];
      frames.clear();
      due.forEach(callback => callback(now));
    }) };
}
