import { select } from 'd3';

// Camera tests run the real fitting pipeline with synchronous reduced motion.
// Only the final D3 transform application is captured instead of updating a browser.
export function createCameraHarness(Element, {
  width, height, data = {}, step = 0, animated = false, signature = 'saved-stage-records',
  auto = { current: null }, manual = { current: null }
}) {
  const svg = new Element('svg');
  let painted;
  const session = {
    cameraRuntime: { applying: false, cancel: undefined, deferred: null },
    svg: select(svg), svgRef: { current: svg },
    zoom: { transform: (_selection, transform) => { svg.__zoom = transform; painted = transform; } },
    autoCameraRef: auto, manualCameraRef: manual, animated, data,
    derivationStagesSignature: signature, fitRevision: 0,
    containerWidth: width, containerHeight: height, activeStepIndex: step,
    cameraAnimationRef: { current: null }, reportViewError: error => { throw error; }
  };
  return { session, group: select(new Element('g')), run: operation => {
    const previous = globalThis.window;
    globalThis.window = { matchMedia: () => ({ matches: true }) };
    try { operation(); return painted; }
    finally {
      if (previous === undefined) delete globalThis.window;
      else globalThis.window = previous;
    }
  } };
}
