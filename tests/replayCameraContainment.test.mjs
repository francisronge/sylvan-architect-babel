import * as d3 from 'd3';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fitTreeCamera } from '../components/renderer/frameCamera.ts';
import { availableTreeViewport } from '../components/treeViewport.ts';
import { STAGE_CAMERA_PADDING } from '../replay/stageCamera.ts';
import { createCameraHarness } from './helpers/cameraHarness.mjs';
import { createSvgDom } from './helpers/svgDom.mjs';

const { Element, restore } = createSvgDom();
after(restore);

// A supplied harness keeps one session across steps; with motion enabled, the
// returned pose is an animation's first frame.
function camera(input) {
  const harness = input.harness ?? createCameraHarness(Element, { ...input, animated: true });
  harness.session.activeStepIndex = input.step ?? 0;
  const painted = harness.run(() => fitTreeCamera({ session: harness.session, layout: {
    relationRenderPlan: null, activeDerivationFrameIndex: input.stage ?? 0, completedReplayStep: input.completed,
    stageCameraBounds: input.bounds, stagePlaqueContainmentBounds: input.plaques ?? null,
    uiBounds: input.uiBounds, g: harness.group,
    derivationFrameFitNodes: [{}], overlayFitBounds: null, visibleNodes: input.nodes ?? []
  } }));
  if (!input.harness) {
    assert.deepEqual(harness.session.cameraRuntime.deferred, painted,
      'deferred panels use the destination or retained manual camera');
  }
  return painted;
}

const enclosed = (transform, bounds, view) => {
  assert(transform.x + bounds.minX * transform.k >= view.left - 1e-7);
  assert(transform.x + bounds.maxX * transform.k <= view.right + 1e-7);
  assert(transform.y + bounds.minY * transform.k >= view.top - 1e-7);
  assert(transform.y + bounds.maxY * transform.k <= view.bottom + 1e-7);
};

for (const [width, height, panelTop] of [[1596, 996, 721], [390, 844, 585]]) {
  for (const withPlaques of [false, true]) {
    test(`${width}px: sequential Replay keeps both edge-label margins${withPlaques ? ' and plaques' : ''}`, () => {
      const uiBounds = { headerBottom: 64, panelTop };
      const view = availableTreeViewport(width, height, uiBounds);
      // Saved French geometry; the left-edge control mirrors the same failure
      // observed in the saved parasitic-gap Replay.
      const bounds = { minX: 290, maxX: 6670, minY: 0, maxY: 2470 };
      const plaques = withPlaques ? { ...bounds, maxY: 2725 } : null;
      const envelope = { minX: 70, maxX: 6890, minY: -160, maxY: withPlaques ? 2725 : 2630 };
      const data = {};
      const input = { bounds, plaques, width, height, uiBounds, data, step: 0, auto: { current: null } };
      const direct = camera(input);
      enclosed(direct, envelope, view);
      for (const side of ['left', 'right']) {
        const previous = { ...direct, x: side === 'left'
          ? view.left - bounds.minX * direct.k
          : view.right - bounds.maxX * direct.k };
        const auto = { current: { ...input.auto.current, transform: previous } };
        const next = camera({ ...input, auto, step: 1 });
        enclosed(next, envelope, view);
        assert.equal(next.k, direct.k, 'recover the margin by panning, without shrinking');
        assert.notEqual(next.x, previous.x, 'a terminal centre at the edge is insufficient containment');
        for (let step = 2; step < 7; step++) {
          assert.deepEqual(camera({ ...input, auto, step }), next, 'one camera throughout the same authored stage');
        }
      }
    });
  }

  test(`${width}px: containment preserves a user-controlled camera`, () => {
    const data = {}, uiBounds = { headerBottom: 64, panelTop };
    const view = availableTreeViewport(width, height, uiBounds);
    const bounds = { minX: 290, maxX: 6670, minY: 0, maxY: 2470 };
    const transform = d3.zoomIdentity.translate(-450, 98).scale(0.7);
    const manual = { current: { data, signature: 'saved-stage-records', width, height, transform } };
    const input = { bounds, plaques: { ...bounds, maxY: 2725 }, width, height, uiBounds,
      data, step: 0, auto: { current: null }, manual };
    assert.deepEqual(camera(input), transform);
    assert.deepEqual(camera({ ...input, step: 1 }), transform, 'Next does not replace manual pan or zoom');
  });
}

// Saved GPT-6 Astra/high geometry for "The man whose car was stolen called the
// police." at Replay frames 20 and 21: [x, y, parent]. Stage 2 lays out the same
// syntax in its own coordinates, thousands of units from where stage 1 drew it,
// and passive movement reattaches carDP from V' to the new IP.
const whoseRelative = {
  stage1: { minX: 357.5, minY: 220, maxX: 1927.5, maxY: 2110 },
  stage2: { minX: 4510.375, minY: 1980, maxX: 6224.625, maxY: 3430 },
  frame20: { relativeIBar: [1140, 220, null], was: [877.5, 440, 'relativeIBar'], passiveVP: [1402.5, 440, 'relativeIBar'],
    'was::__leaf': [877.5, 660, 'was'], passiveVBar: [1402.5, 660, 'passiveVP'], stolen: [1140, 880, 'passiveVBar'],
    carDP: [1665, 880, 'passiveVBar'], 'stolen::__leaf': [1140, 1100, 'stolen'], carDBar: [1665, 1100, 'carDP'],
    whose: [1402.5, 1320, 'carDBar'], carNP: [1927.5, 1320, 'carDBar'], 'whose::__leaf': [1402.5, 1540, 'whose'],
    carNBar: [1927.5, 1540, 'carNP'], car: [1927.5, 1760, 'carNBar'], 'car::__leaf': [1927.5, 1980, 'car'] },
  frame21: { relativeIP: [5295, 1980, null], carDP: [5004.375, 2200, 'relativeIP'],
    relativeIBar: [5585.625, 2200, 'relativeIP'], carDBar: [5004.375, 2420, 'carDP'], was: [5323.125, 2420, 'relativeIBar'],
    passiveVP: [5848.125, 2420, 'relativeIBar'], whose: [4741.875, 2640, 'carDBar'], carNP: [5266.875, 2640, 'carDBar'],
    'was::__leaf': [5323.125, 2640, 'was'], passiveVBar: [5848.125, 2640, 'passiveVP'],
    'whose::__leaf': [4741.875, 2860, 'whose'], carNBar: [5266.875, 2860, 'carNP'], stolen: [5660.625, 2860, 'passiveVBar'],
    themeTrace: [6035.625, 2860, 'passiveVBar'], car: [5266.875, 3080, 'carNBar'],
    'stolen::__leaf': [5660.625, 3080, 'stolen'], 'car::__leaf': [5266.875, 3300, 'car'] }
};
const { stage1, stage2, frame20, frame21 } = whoseRelative;
// Painted hierarchy nodes, as the frame camera reads them.
const paintedNodes = points => Object.entries(points).map(([id, [x, y, parent]]) =>
  ({ __vizId: id, x, y, parent: parent && { __vizId: parent } }));
const onScreen = (pose, [x, y]) => [pose.x + x * pose.k, pose.y + y * pose.k];
const unmoved = ['relativeIBar', 'was', 'was::__leaf', 'passiveVP', 'passiveVBar'];
const whoseCamera = (width, height, uiBounds) => (auto, step, stage, bounds, points, harness) =>
  camera({ bounds, width, height, uiBounds, data: whoseRelative, step, stage, nodes: paintedNodes(points), auto, harness });

test('1440px: Next into a stage with moved coordinates carries the view with its unmoved syntax', () => {
  const uiBounds = { headerBottom: 57, panelTop: 564, right: 16 };
  const at = whoseCamera(1440, 840, uiBounds), auto = { current: null };
  const previous = at(auto, 19, 0, stage1, frame20);
  const entered = at(auto, 20, 1, stage2, frame21);
  assert.equal(entered.k, previous.k, 'forward playback does not zoom in');
  enclosed(entered, { minX: stage2.minX - STAGE_CAMERA_PADDING.x, maxX: stage2.maxX + STAGE_CAMERA_PADDING.x,
    minY: stage2.minY - STAGE_CAMERA_PADDING.y, maxY: stage2.maxY + STAGE_CAMERA_PADDING.y }, availableTreeViewport(1440, 840, uiBounds));
  for (const id of unmoved) {
    assert(Math.abs(onScreen(entered, frame21[id])[0] - onScreen(previous, frame20[id])[0]) < 1e-6,
      `${id} keeps its column; only containment pans the view, instead of parking it at the edge`);
  }
  for (let step = 21; step < 24; step++) {
    assert.deepEqual(at(auto, step, 1, stage2, frame21), entered, 'one camera throughout the same authored stage');
  }
  for (const step of [22, 21, 20]) {
    assert.deepEqual(at(auto, step, 1, stage2, frame21), entered, `Prev to frame ${step + 1} keeps the stage camera`);
  }
});

test('390px control: a new stage that needs a smaller scale settles on its own fit', () => {
  const at = whoseCamera(390, 844, { headerBottom: 72, panelTop: 585, right: 72 }), auto = { current: null };
  const direct = at({ current: null }, 20, 1, stage2, frame21);
  at(auto, 19, 0, stage1, frame20);
  for (let step = 20; step < 24; step++) assert.deepEqual(at(auto, step, 1, stage2, frame21), direct);
});

test('1440px: a stage entry that the accepted view leaves flush against one edge takes the stage fit', () => {
  const width = 1440, height = 840, uiBounds = { headerBottom: 57, panelTop: 564, right: 16 };
  const at = whoseCamera(width, height, uiBounds);
  // The earlier stage reserved its extra room only above and left of the same syntax.
  const lopsided = { ...stage2, minX: stage2.minX - 600, minY: stage2.minY - 900 };
  const { themeTrace: _added, ...unchanged } = frame21;
  const auto = { current: null };
  const accepted = at(auto, 19, 0, lopsided, unchanged);
  const view = availableTreeViewport(width, height, uiBounds);
  const gaps = pose => [pose.x + (stage2.minX - STAGE_CAMERA_PADDING.x) * pose.k - view.left,
    view.right - pose.x - (stage2.maxX + STAGE_CAMERA_PADDING.x) * pose.k,
    pose.y + (stage2.minY - STAGE_CAMERA_PADDING.y) * pose.k - view.top,
    view.bottom - pose.y - (stage2.maxY + STAGE_CAMERA_PADDING.y) * pose.k];
  const [left, right, top, bottom] = gaps(accepted);
  assert(Math.max(Math.abs(left - right) / (view.right - view.left), Math.abs(top - bottom) / (view.bottom - view.top)) > 0.25,
    'the accepted view would leave the new stage to one side');
  assert.deepEqual(at(auto, 20, 1, stage2, frame21), at({ current: null }, 20, 1, stage2, frame21), 'Next settles on the stage fit');
});

for (const [width, height, uiBounds] of [[1440, 840, { headerBottom: 57, panelTop: 564, right: 16 }],
  [390, 844, { headerBottom: 72, panelTop: 585, right: 72 }]]) {
  const at = whoseCamera(width, height, uiBounds);

  // Control: an earlier stage reserved more room on every side of the same syntax.
  const earlier = { minX: stage2.minX - 300, maxX: stage2.maxX + 300, minY: stage2.minY - 450, maxY: stage2.maxY + 450 };

  test(`${width}px: shared syntax at unchanged coordinates still keeps the accepted view on stage entry`, () => {
    const { themeTrace: _added, ...unchanged } = frame21;
    const auto = { current: null };
    const accepted = at(auto, 19, 0, earlier, unchanged);
    const entered = at(auto, 20, 1, stage2, frame21);
    assert.deepEqual(entered, accepted, 'forward playback does not zoom in merely because the new stage has room');
    assert(entered.k < at({ current: null }, 20, 1, stage2, frame21).k, 'direct selection still fits the stage');
  });

  test(`${width}px: Prev within a stage keeps its retained camera; Prev into an earlier stage refits`, () => {
    const { themeTrace: _added, ...unchanged } = frame21;
    const auto = { current: null };
    at(auto, 19, 0, earlier, unchanged);
    const retained = at(auto, 20, 1, stage2, frame21);
    for (const step of [21, 22, 21, 20]) {
      assert.deepEqual(at(auto, step, 1, stage2, frame21), retained, `frame ${step + 1} keeps the stage camera`);
    }
    assert.deepEqual(at(auto, 19, 0, earlier, unchanged), at({ current: null }, 19, 0, earlier, unchanged));
  });

  test(`${width}px: Prev out of the completed last Stage Record refits instead of keeping its pose`, () => {
    // The completed record's own fit here frames more than its stage's earlier steps need.
    const completedBounds = { ...stage2, minX: stage2.minX - 600, minY: stage2.minY - 900 };
    const auto = { current: null };
    const final = camera({ bounds: completedBounds, width, height, uiBounds, data: whoseRelative, step: 23, stage: 1,
      completed: 23, nodes: paintedNodes(frame21), auto });
    const back = at(auto, 22, 1, stage2, frame21);
    assert.deepEqual(back, at({ current: null }, 22, 1, stage2, frame21), 'Prev settles on the stage fit');
    assert.notDeepEqual(back, final);
  });

  test(`${width}px: an animated step into a new stage first paints its unmoved syntax where it was`, () => {
    const harness = createCameraHarness(Element, { width, height, data: whoseRelative, animated: true, reducedMotion: false });
    const previous = at(undefined, 19, 0, stage1, frame20, harness);
    const first = at(undefined, 20, 1, stage2, frame21, harness);
    const auto = { current: null };
    at(auto, 19, 0, stage1, frame20);
    const settled = at(auto, 20, 1, stage2, frame21);
    assert.deepEqual(harness.session.cameraRuntime.deferred, settled, 'the animation is aimed at the settled pose');
    assert.equal(first.k, previous.k, 'the camera begins at the painted scale');
    for (const id of unmoved) {
      const [x, y] = onScreen(first, frame21[id]), [oldX, oldY] = onScreen(previous, frame20[id]);
      assert(Math.hypot(x - oldX, y - oldY) < 1e-6, `${id} first paints where stage 1 showed it`);
    }
    for (const id of Object.keys(frame20)) {
      const [x, y] = onScreen(first, frame21[id]);
      assert(x >= 0 && x <= width && y >= 0 && y <= height, `${id} stays on the canvas, including the moved DP`);
    }
    harness.advance(360);
    assert.deepEqual(harness.paints.at(-1), settled, 'the animation finishes at the settled pose');
    assert.equal(harness.session.svgRef.current.getAttribute('data-babel-camera-settled-step'), '20');
    assert.equal(harness.frames.size, 0);
  });

  test(`${width}px: rapid Next and Prev across the stage boundary cancel and then settle`, () => {
    const harness = createCameraHarness(Element, { width, height, data: whoseRelative, animated: true, reducedMotion: false });
    const settledStep = () => harness.session.svgRef.current.getAttribute('data-babel-camera-settled-step');
    // Each Replay draw cancels the previous draw's camera animation before painting.
    const step = (index, stage, bounds, points) => {
      harness.run(() => harness.session.cameraRuntime.cancel?.());
      return at(undefined, index, stage, bounds, points, harness);
    };
    const stage1Fit = step(19, 0, stage1, frame20);
    assert.equal(settledStep(), '19', 'the first frame has no animation');
    const start = step(20, 1, stage2, frame21);
    const destination = harness.session.cameraRuntime.deferred;
    assert.equal(settledStep(), null);
    assert.equal(harness.frames.size, 1);
    harness.advance(180);
    const midway = harness.paints.at(-1);
    for (const axis of ['x', 'y', 'k']) {
      assert(midway[axis] >= Math.min(start[axis], destination[axis]) - 1e-9
        && midway[axis] <= Math.max(start[axis], destination[axis]) + 1e-9, `midway ${axis} lies on the path`);
    }
    assert.notDeepEqual(midway, destination, 'the animation is still running');
    const back = step(19, 0, stage1, frame20);
    assert.equal(harness.frames.size, 1, 'Prev cancels the unfinished animation and starts one');
    for (const id of unmoved) {
      const [x, y] = onScreen(back, frame20[id]), [oldX, oldY] = onScreen(midway, frame21[id]);
      assert(Math.hypot(x - oldX, y - oldY) < 1e-6, `${id} begins Prev where the interrupted camera showed it`);
    }
    harness.advance(360);
    assert.deepEqual(harness.paints.at(-1), stage1Fit, 'Prev settles on the stage 1 fit');
    assert.equal(settledStep(), '19');
    assert.equal(harness.frames.size, 0);
    assert.equal(harness.session.cameraAnimationRef.current, null);
  });
}
