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
// police." at Replay frames 20 and 21. Stage 2 lays out the same syntax in its own
// coordinates, thousands of units from where stage 1 drew it.
const whoseRelative = {
  stage1: { minX: 357.5, minY: 220, maxX: 1927.5, maxY: 2110 },
  stage2: { minX: 4510.375, minY: 1980, maxX: 6224.625, maxY: 3430 },
  frame20: { relativeIBar: [1140, 220], was: [877.5, 440], passiveVP: [1402.5, 440], 'was::__leaf': [877.5, 660],
    passiveVBar: [1402.5, 660], stolen: [1140, 880], carDP: [1665, 880], 'stolen::__leaf': [1140, 1100],
    carDBar: [1665, 1100], whose: [1402.5, 1320], carNP: [1927.5, 1320], 'whose::__leaf': [1402.5, 1540],
    carNBar: [1927.5, 1540], car: [1927.5, 1760], 'car::__leaf': [1927.5, 1980] },
  frame21: { relativeIP: [5295, 1980], carDP: [5004.375, 2200], relativeIBar: [5585.625, 2200],
    carDBar: [5004.375, 2420], was: [5323.125, 2420], passiveVP: [5848.125, 2420], whose: [4741.875, 2640],
    carNP: [5266.875, 2640], 'was::__leaf': [5323.125, 2640], passiveVBar: [5848.125, 2640],
    'whose::__leaf': [4741.875, 2860], carNBar: [5266.875, 2860], stolen: [5660.625, 2860],
    themeTrace: [6035.625, 2860], car: [5266.875, 3080], 'stolen::__leaf': [5660.625, 3080],
    'car::__leaf': [5266.875, 3300] }
};
const paintedNodes = points => Object.entries(points).map(([id, [x, y]]) => ({ __vizId: id, x, y }));

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
}
