import { select } from 'd3';

// Camera tests run the real fitting pipeline with synchronous reduced motion.
// Only the final D3 transform application is captured instead of updating a browser.
// With `reducedMotion: false`, an animation paints only its first pose; `paints`
// records every applied transform.
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
  return { session, paints, group: select(new Element('g')), run: operation => {
    const previous = globalThis.window;
    globalThis.window = { matchMedia: () => ({ matches: reducedMotion }),
      requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} };
    try { operation(); return painted; }
    finally {
      if (previous === undefined) delete globalThis.window;
      else globalThis.window = previous;
    }
  } };
}
