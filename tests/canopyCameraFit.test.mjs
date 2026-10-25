import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAMERA_ZOOM } from '../replay/rendererMetrics.ts';
import { checkCanopyPlacement } from './helpers/cameraInvariants.mjs';
import { CAMERA_VIEWPORTS, fitCanopyCamera } from './helpers/cameraTrace.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { prepareVisualRecord, viewportForWindow } from './helpers/visualFrames.mjs';

const corpus = loadFixtureAnalyses().records;
const visualOf = id => prepareVisualRecord(corpus.find(entry => entry.id === id).record);

// The widest committed Canopy, about 16,700 tree units across: wider than the
// smallest Replay fit scale shows in a narrow desktop pane or on a phone. The
// camera audit checks canopy-placement on every fixture at desktop and mobile.
const WIDE = 'replay-regressions/successive-cyclic-source.json#/cases/0';
const NARROW = [
  ['a narrow desktop pane', { name: 'pane-990', width: 990, height: 820 }],
  ['a half-width desktop pane', { name: 'pane-700', width: 700, height: 820 }],
  ['mobile', CAMERA_VIEWPORTS.find(({ name }) => name === 'mobile')]
];

const wide = visualOf(WIDE);
for (const [where, viewport] of NARROW) test(`the Canopy of a wide tree fits whole and centred in ${where}`, () => {
  const canopy = fitCanopyCamera(wide, viewport);
  assert.deepEqual(checkCanopyPlacement(canopy), []);
  const floor = CAMERA_ZOOM.minimumFitScale[viewport.width < 500 ? 'compact' : 'regular'];
  assert(canopy.pose.k < floor, `the fit goes below Replay's minimum fit scale (k ${canopy.pose.k} < ${floor})`);
  // Wheel and pinch zoom continue from the fitted scale instead of snapping to the user floor.
  assert.equal(canopy.extent[0], Math.min(CAMERA_ZOOM.userZoomExtent[0], canopy.pose.k));
  assert.equal(canopy.extent[1], CAMERA_ZOOM.userZoomExtent[1]);
});

test('a small Canopy is fitted whole and centred too', () => {
  for (const viewport of [viewportForWindow('desktop', [1440, 900]), NARROW[2][1]])
    assert.deepEqual(checkCanopyPlacement(fitCanopyCamera(visualOf('normalized/mia-laughed.xbar.json#/analyses/0'), viewport)), [], viewport.name);
});

test('control: canopy-placement reports a clipped and an off-centre Canopy', () => {
  const canopy = fitCanopyCamera(wide, NARROW[0][1]), { view, pose } = canopy;
  const centre = { x: (view.left + view.right) / 2, y: (view.top + view.bottom) / 2 };
  const zoomed = { k: pose.k * 1.2, x: centre.x + (pose.x - centre.x) * 1.2, y: centre.y + (pose.y - centre.y) * 1.2 };
  assert.deepEqual(checkCanopyPlacement({ ...canopy, pose: zoomed }).map(({ subtype }) => subtype), ['clipped']);
  const low = checkCanopyPlacement({ ...canopy, pose: { ...pose, y: pose.y + 30 } });
  assert.deepEqual(low.map(({ subtype, measure }) => [subtype, measure]), [['off-centre', 30]]);
});
