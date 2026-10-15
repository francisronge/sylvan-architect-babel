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
    relationRenderPlan: null, activeDerivationFrameIndex: 0,
    stageCameraBounds: input.bounds, stagePlaqueContainmentBounds: input.plaques ?? null,
    uiBounds: input.uiBounds, g: harness.group,
    derivationFrameFitNodes: [{}], overlayFitBounds: null, visibleNodes: []
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
