import * as d3 from 'd3';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fitTreeCamera } from '../components/renderer/frameCamera.ts';
import { availableTreeViewport } from '../components/treeViewport.ts';
import { createCameraHarness } from './helpers/cameraHarness.mjs';
import { createSvgDom } from './helpers/svgDom.mjs';

const { Element, restore } = createSvgDom();
after(restore);

function camera(input) {
  const harness = createCameraHarness(Element, { ...input, animated: true });
  const painted = harness.run(() => fitTreeCamera({ session: harness.session, layout: {
    relationRenderPlan: null, activeDerivationFrameIndex: input.stage ?? 0,
    stageCameraBounds: input.bounds, stagePlaqueContainmentBounds: input.plaques ?? null,
    uiBounds: input.uiBounds, g: harness.group,
    derivationFrameFitNodes: [{}], overlayFitBounds: null, visibleNodes: input.nodes ?? []
  } }));
  assert.deepEqual(harness.session.cameraRuntime.deferred, painted,
    'deferred panels use the destination or retained manual camera');
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
// Painted hierarchy nodes, as the frame camera reads them.
const paintedNodes = points => Object.entries(points).map(([id, [x, y]]) => {
  const lineage = [id];
  for (let parent = points[id][2]; parent; parent = points[parent][2]) lineage.push(parent);
  return { __vizId: id, x, y, ancestors: () => lineage.map(__vizId => ({ __vizId })) };
});
const onScreen = (pose, [x, y]) => [pose.x + x * pose.k, pose.y + y * pose.k];

for (const [width, height, uiBounds] of [[1440, 840, { headerBottom: 57, panelTop: 564, right: 16 }],
  [390, 844, { headerBottom: 72, panelTop: 585, right: 72 }]]) {
  const { stage1, stage2, frame20, frame21 } = whoseRelative;
  const at = (auto, step, stage, bounds, points) => camera({ bounds, width, height, uiBounds,
    data: whoseRelative, step, stage, nodes: paintedNodes(points), auto });

  test(`${width}px: Next into a stage with moved coordinates settles where direct selection does`, () => {
    const direct = at({ current: null }, 20, 1, stage2, frame21);
    const auto = { current: null };
    at(auto, 19, 0, stage1, frame20);
    assert.deepEqual(at(auto, 20, 1, stage2, frame21), direct,
      'the stage 1 pose frames none of stage 2, so retaining it parks the tree against the viewport edge');
    for (let step = 21; step < 24; step++) {
      assert.deepEqual(at(auto, step, 1, stage2, frame21), direct, 'one camera throughout the same authored stage');
    }
  });

  test(`${width}px: shared syntax at unchanged coordinates still keeps the accepted view on stage entry`, () => {
    // Control: an earlier stage reserved more room around the same syntax.
    const earlier = { ...stage2, minX: stage2.minX - 600, minY: stage2.minY - 900 };
    const { themeTrace: _added, ...unchanged } = frame21;
    const auto = { current: null };
    const accepted = at(auto, 19, 0, earlier, unchanged);
    const entered = at(auto, 20, 1, stage2, frame21);
    assert.deepEqual(entered, accepted, 'forward playback does not zoom in merely because the new stage has room');
    assert(entered.k < at({ current: null }, 20, 1, stage2, frame21).k, 'direct selection still fits the stage');
  });

  test(`${width}px: an animated step into a new stage first paints its syntax where it was`, () => {
    const harness = createCameraHarness(Element, { width, height, data: whoseRelative, animated: true, reducedMotion: false });
    const paint = (step, stage, bounds, points) => {
      harness.session.activeStepIndex = step;
      harness.paints.length = 0;
      harness.run(() => fitTreeCamera({ session: harness.session, layout: {
        relationRenderPlan: null, activeDerivationFrameIndex: stage, stageCameraBounds: bounds,
        stagePlaqueContainmentBounds: null, uiBounds, g: harness.group,
        derivationFrameFitNodes: [{}], overlayFitBounds: null, visibleNodes: paintedNodes(points)
      } }));
      return { first: harness.paints[0], destination: harness.session.cameraRuntime.deferred };
    };
    const previous = paint(19, 0, stage1, frame20).first;
    const entry = paint(20, 1, stage2, frame21);
    assert.deepEqual(entry.destination, at({ current: null }, 20, 1, stage2, frame21), 'the settled pose is unchanged');
    assert.equal(entry.first.k, previous.k, 'the camera begins at the painted scale');
    for (const id of ['relativeIBar', 'was', 'was::__leaf', 'passiveVP', 'passiveVBar']) {
      const [x, y] = onScreen(entry.first, frame21[id]), [oldX, oldY] = onScreen(previous, frame20[id]);
      assert(Math.hypot(x - oldX, y - oldY) < 1e-6, `${id} first paints where stage 1 showed it`);
    }
    for (const id of Object.keys(frame20)) {
      const [x, y] = onScreen(entry.first, frame21[id]);
      assert(x >= 0 && x <= width && y >= 0 && y <= height, `${id} stays on the canvas, including the moved DP`);
    }
    const next = paint(21, 1, stage2, frame21);
    assert.deepEqual(next.first, entry.first, 'a later micro-step starts from the painted camera');
    assert.deepEqual(next.destination, entry.destination);
  });
}
