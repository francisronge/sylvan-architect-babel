import assert from 'node:assert/strict';
import test from 'node:test';

import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { layoutMeasuredScenes, layoutVisualFrames, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';

/* Right-to-left relation plaques and neutral role labels are the reflection of
 * their left-to-right placement (Francis, 22 October 2026), measured with the
 * bundled fonts as the offline visual audit lays them out. Each record once
 * placed its plaques or role labels right of their anchors in both directions,
 * so its right-to-left stage camera, plaques or labels were not the mirror. */
const RECORDS = ['replay-regressions/hi-correlative-landing-contour.json#',
  'replay-regressions/diverse-recovery.json#/examples/4/analysis', 'showcase/agreement-and-case.json#/cases/0',
  'replay-regressions/workspace-reservation.json#/cases/1', 'replay-regressions/retained-root-growth.json#'];
const byId = new Map(loadFixtureAnalyses().records.map(({ id, record }) => [id, record]));
const desktop = VIEWPORTS.find(({ name }) => name === 'desktop');
const close = (a, b, message) => assert(Math.abs(a - b) <= 0.01, `${message}: ${a} versus ${b}`);
const center = box => box.x + box.width / 2;

for (const id of RECORDS) test(`${id}: right-to-left plaques, role labels and camera reflect left to right`, () => {
  const record = byId.get(id), visual = direction => ({ ...prepareVisualRecord(record), direction });
  const ltr = visual('ltr'), rtl = visual('rtl');
  const scenes = { ltr: layoutMeasuredScenes(ltr, desktop), rtl: layoutMeasuredScenes(rtl, desktop) };
  // Every stage reflects about the completed stage's width (stageCoordinates.ts, rightToLeftAxis).
  const axis = scenes.ltr.sizes.get(record.derivationStages.length - 1)[0];
  const left = layoutVisualFrames(ltr, [desktop]), right = layoutVisualFrames(rtl, [desktop]);
  assert.equal(right.length, left.length);
  let plaques = 0, roles = 0;
  const screen = new Set();
  left.forEach((frame, index) => {
    const mirror = right[index], at = `frame ${frame.frame}`;
    close(mirror.zoom, frame.zoom, `${at}: zoom`);
    const mirrorPlaques = new Map(mirror.plaques.map(plaque => [plaque.id, plaque]));
    assert.deepEqual([...mirrorPlaques.keys()].sort(), frame.plaques.map(plaque => plaque.id).sort(), `${at}: the same plaques`);
    for (const plaque of frame.plaques) {
      const other = mirrorPlaques.get(plaque.id).rect;
      close(other.x + other.width, axis - plaque.rect.x, `${at}: ${plaque.id} right edge`);
      close(other.y, plaque.rect.y, `${at}: ${plaque.id} row`);
      plaques++;
    }
    const mirrorTexts = new Map(mirror.texts.map(text => [text.id, text]));
    for (const role of frame.texts.filter(text => text.kind === 'role')) {
      const other = mirrorTexts.get(role.id);
      assert(other, `${at}: ${role.id} is drawn right to left`);
      close(center(other.boxes[0]), axis - center(role.boxes[0]), `${at}: ${role.id} centre`);
      close(other.boxes[0].y, role.boxes[0].y, `${at}: ${role.id} row`);
      roles++;
    }
    // On screen a node's two x positions sum to twice the fitted view's centre.
    const stem = frame.lines.find(line => line.kind === 'stem');
    if (stem) screen.add(Math.round(((stem.paths[0][0].x - frame.chrome.canvas.x)
      + (mirror.lines.find(line => line.id === stem.id).paths[0][0].x - mirror.chrome.canvas.x)) * frame.zoom * 100));
  });
  assert(plaques + roles > 0, 'the record draws plaques or role labels');
  assert.equal(screen.size, 1, `one mirrored camera across Replay: ${[...screen]}`);
  for (const stage of record.derivationStages.keys()) {
    const a = scenes.ltr.stageCamera(stage, undefined).bounds, b = scenes.rtl.stageCamera(stage, undefined).bounds;
    if (!a) continue;
    close(b.maxX, axis - a.minX, `stage ${stage + 1} camera bounds right`);
    close(b.minX, axis - a.maxX, `stage ${stage + 1} camera bounds left`);
    close(b.minY, a.minY, `stage ${stage + 1} camera bounds top`);
    close(b.maxY, a.maxY, `stage ${stage + 1} camera bounds bottom`);
  }
});
