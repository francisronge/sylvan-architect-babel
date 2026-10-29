/** Offline camera traces for tests/helpers/cameraInvariants.mjs.
 *
 * Frames come from the measured browser layout of tests/helpers/visualFrames.mjs
 * (scripts/replayFrameLayout.mjs: plaque worker job, stage layout, stage camera
 * bounds and containment); the real fitTreeCamera runs on the controlled clock of
 * tests/helpers/cameraHarness.mjs, through every adjacent step forwards and
 * backwards, one reversal after each arrival, and direct selection. Each step
 * records its first painted pose, then the clock runs the camera move to the pose
 * it settles on.
 *
 * What a trace cannot see: the browser's own font rasterization (text is measured
 * from the bundled fonts), the painted pixels between first and settled poses,
 * and real browser timing (a step pressed mid-move, deferred refits, resize). A
 * step's camera move finishes before the next step. */
import { fitTreeCamera, treeFitViewport } from '../../components/renderer/frameCamera.ts';
import { availableTreeViewport } from '../../components/treeViewport.ts';
import { getNodeId } from '../../replay/displayIdentity.ts';
import { STAGE_CAMERA_PADDING } from '../../replay/stageCamera.ts';
import { paintedShift } from '../../replay/cameraCarry.ts';
import { closingAt } from '../../replay/workspaceShapeReflows.ts';
import { createCameraHarness } from './cameraHarness.mjs';
import { CAMERA_THRESHOLDS, checkCameraTrace, checkCanopyPlacement } from './cameraInvariants.mjs';
import { createSvgDom } from './svgDom.mjs';
import {
  canopyFinalFrameFindings, layoutCanopyPainted, layoutMeasuredScenes, prepareVisualRecord, VIEWPORTS, viewportForWindow, viewportObstacles
} from './visualFrames.mjs';

/** The visual audit's windows plus a wide, short one, where height limits the Fit. */
export const CAMERA_VIEWPORTS = Object.freeze([...VIEWPORTS, viewportForWindow('wide-short', [1800, 900])]);
const SETTLE_MS = 1000;
const pose = transform => ({ x: transform.x, y: transform.y, k: transform.k });

/** One prepared record's camera trace at one canvas (see cameraInvariants.mjs). */
export function traceCamera(visual, viewport, { reversals = true } = {}) {
  const steps = visual.prepared.playbackSteps, plan = visual.prepared.relationRenderPlan;
  if (!steps.length || !visual.prepared.replayDerivationFrames.length) return null;
  const layout = layoutMeasuredScenes(visual, viewport), uiBounds = viewportObstacles(viewport);
  const pad = STAGE_CAMERA_PADDING;
  // The syntax each step's closing moves (closingAt, as the corpus gate grants it,
  // and moving there after the camera carry), over the painted nodes of it and
  // the step before.
  const painted = nodes => new Map([...nodes].filter(([, node]) => !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace'));
  const points = nodes => new Map([...nodes].map(([id, node]) => [id, { x: node.x, y: node.y,
    parentId: node.parent && nodes.has(getNodeId(node.parent)) ? getNodeId(node.parent) : null }]));
  const closings = layout.scenes.map(({ step, nodes, closing }, index) => {
    if (!index) return new Set();
    const previous = layout.scenes[index - 1], before = painted(previous.nodes), after = painted(nodes);
    const carry = previous.step.replayFrameIndex !== step.replayFrameIndex ? paintedShift(points(before), points(after), { closing }) : { x: 0, y: 0 };
    return new Set([...closingAt(previous.step, step, before, after, before, after, { closing })].filter(id =>
      Math.hypot(after.get(id).x - carry.x - before.get(id).x, after.get(id).y - carry.y - before.get(id).y) > 1));
  });
  const scenes = layout.scenes.map(({ step, nodes, closing: closesOnEntry }, index) => {
    const completedStep = index === steps.length - 1 && step.replayKind === 'macro' ? index : undefined;
    const { bounds, containment } = layout.stageCamera(step.replayFrameIndex, completedStep);
    const visibleNodes = [...nodes.values()];
    return { stage: step.replayFrameIndex, completedStep, bounds, containment, visibleNodes, closing: closings[index], closesOnEntry,
      // fitTreeCamera's stageFitContainmentBounds.
      envelope: bounds && {
        minX: Math.min(containment?.minX ?? Infinity, bounds.minX - pad.x), maxX: Math.max(containment?.maxX ?? -Infinity, bounds.maxX + pad.x),
        minY: Math.min(containment?.minY ?? Infinity, bounds.minY - pad.y), maxY: Math.max(containment?.maxY ?? -Infinity, bounds.maxY + pad.y)
      },
      nodes: new Map(visibleNodes.map(node => [getNodeId(node), { x: node.x, y: node.y,
        ancestors: node.ancestors().slice(1).map(getNodeId).filter(id => nodes.has(id)) }])) };
  });
  const { Element, restore } = createSvgDom();
  const data = {};
  const harness = (auto = null) => createCameraHarness(Element, { width: viewport.width, height: viewport.height, data,
    animated: true, reducedMotion: false, auto: { current: auto } });
  const show = (camera, index) => {
    const scene = scenes[index];
    camera.session.activeStepIndex = index;
    camera.paints.length = 0;
    camera.run(() => fitTreeCamera({ session: camera.session, layout: { relationRenderPlan: plan, activeDerivationFrameIndex: scene.stage,
      uiBounds, stageCameraBounds: scene.bounds, stagePlaqueContainmentBounds: scene.containment, completedReplayStep: scene.completedStep,
      g: camera.group, fitFallbackOverlays: undefined, derivationFrameFitNodes: scene.visibleNodes, overlayFitBounds: null,
      visibleNodes: scene.visibleNodes, closesOnEntry: scene.closesOnEntry } }));
    const first = camera.paints[0];
    camera.advance(SETTLE_MS);
    const settled = camera.paints.at(-1);
    if (camera.frames.size || pose(settled).x !== camera.session.cameraRuntime.deferred.x)
      throw Error(`Frame ${index + 1}: the camera move did not settle on its destination`);
    return { first: pose(first), settled: pose(settled), transform: settled, auto: camera.session.autoCameraRef.current };
  };
  const view = availableTreeViewport(viewport.width, viewport.height, uiBounds);
  try {
    const direct = scenes.map((_, index) => show(harness(), index).settled);
    const play = order => {
      const camera = harness(), states = new Map(), out = [];
      let previous = null;
      for (const index of order) {
        const state = show(camera, index);
        if (previous !== null) out.push({ from: previous, to: index, before: states.get(previous).settled, first: state.first, settled: state.settled });
        states.set(index, state);
        previous = index;
      }
      return { steps: out, states };
    };
    const forward = play(scenes.map((_, index) => index)), backward = play(scenes.map((_, index) => scenes.length - 1 - index));
    // Reverse once from the state a pass left at each frame.
    const reverse = (states, offset) => scenes.flatMap((_, index) => {
      const target = index + offset, state = states.get(index);
      if (target < 0 || target >= scenes.length) return [];
      const camera = harness(state.auto);
      camera.session.svgRef.current.__zoom = state.transform;
      return [{ from: index, to: target, before: state.settled, ...(({ first, settled }) => ({ first, settled }))(show(camera, target)) }];
    });
    const passes = [{ name: 'forward', steps: forward.steps }, { name: 'backward', steps: backward.steps }];
    if (reversals) passes.push({ name: 'next-then-prev', steps: reverse(forward.states, -1) },
      { name: 'prev-then-next', steps: reverse(backward.states, 1) });
    return { canvas: { width: viewport.width, height: viewport.height }, view,
      frames: scenes.map(scene => ({ stage: scene.stage, final: scene.completedStep !== undefined, bounds: scene.bounds,
        envelope: scene.envelope, nodes: scene.nodes, closing: scene.closing, view: treeFitViewport(plan, scene.stage, view) })),
      direct, passes };
  } finally { restore(); }
}

/** The Canopy's fit at one canvas, for checkCanopyPlacement: the real
 * fitTreeCamera of the Canopy view (not animated, no stage bounds) over the
 * painted tree's box, which stands in for the renderer's getBBox. `extent` is
 * the wheel and pinch zoom extent the fit leaves. Null without a Canopy. */
export function fitCanopyCamera(visual, viewport) {
  const canopy = layoutCanopyPainted(visual, viewport);
  if (!canopy) return null;
  const { Element, restore } = createSvgDom();
  try {
    const camera = createCameraHarness(Element, { width: viewport.width, height: viewport.height });
    const { x, y, width, height } = canopy.box;
    camera.group.node().getBBox = () => ({ x, y, width, height });
    const uiBounds = viewportObstacles(viewport, false), visibleNodes = canopy.tree.descendants();
    const painted = camera.run(() => fitTreeCamera({ session: camera.session, layout: {
      relationRenderPlan: visual.prepared.relationRenderPlan, activeDerivationFrameIndex: -1, uiBounds, stageCameraBounds: null,
      stagePlaqueContainmentBounds: null, completedReplayStep: undefined, g: camera.group, fitFallbackOverlays: undefined,
      derivationFrameFitNodes: null, overlayFitBounds: null, visibleNodes } }));
    return { view: availableTreeViewport(viewport.width, viewport.height, uiBounds), box: canopy.box, pose: pose(painted),
      extent: camera.session.zoom.scaleExtent() };
  } finally { restore(); }
}

/** One record's camera findings at each viewport, in the shape of tests/helpers/findings.mjs,
 * with canopy-final-frame (the Canopy and the last Replay frame differ only in
 * the camera) and canopy-placement (the Canopy's fit shows and centres the whole tree).
 * `visual` may be the record's prepareVisualRecord result shared with another
 * audit; this audit only reads it. */
export function auditCameraRecord(id, record, { viewports = CAMERA_VIEWPORTS, thresholds = CAMERA_THRESHOLDS, reversals = true,
  visual = prepareVisualRecord(record) } = {}) {
  let frames = 0;
  const findings = viewports.flatMap(viewport => {
    const trace = traceCamera(visual, viewport, { reversals }), canopy = fitCanopyCamera(visual, viewport);
    if (trace) frames += trace.frames.length;
    return [...trace ? [...checkCameraTrace(trace, thresholds).findings, ...canopyFinalFrameFindings(visual, viewport)] : [],
      ...canopy ? checkCanopyPlacement(canopy, thresholds) : []]
      .map(finding => ({ ...finding, record: id, viewport: viewport.name }));
  });
  return { steps: visual.prepared.playbackSteps.length, frames, findings };
}
