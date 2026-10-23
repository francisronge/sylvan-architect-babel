import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { nearbyPlaqueReach, PLAQUE_GAP, placeStagePlaques, plaqueAnchorPoint, plaquesOverlap, plaqueTreeObstacles }
  from '../replay/relations/plaquePlacement.ts';

// Francis, 23 October 2026: some plaques sat "hugging very tightly" to their node.
// The fixed nearby pockets keep slack; the nearest-pocket scan slid plaques flush
// against the plain gap from tree text. A small nudge now keeps 10 units more.
const SCAN_TEXT_GAP = PLAQUE_GAP + 10;

const tree = () => d3.tree().nodeSize([600, 300])(d3.hierarchy({ id: 'root', label: 'TP', children: [
  { id: 'tense', label: 'I', children: [{ id: 'tenseWord', label: 'I', word: 'will' }] }, { id: 'subject', label: 'DP' }
]}));
const feature = { kind: 'node-plaque', plaqueStyle: 'feature', anchorNodeIds: ['tense'], title: 'Features',
  rows: [{ label: 'number', value: 'plural' }], relationRef: { stageIndex: 0, relationIndex: 0 } };
const isText = obstacle => obstacle.connectorAttachment !== undefined && !obstacle.curve;
/** The clearance between two boxes, negative when they overlap. */
const clearance = (a, b) => Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height));
/** Four blockers covering a wide square except `window`. */
const frame = window => {
  const far = 4000, right = window.x + window.width, bottom = window.y + window.height;
  return [{ x: -far, y: -far, width: 2 * far, height: window.y + far }, { x: -far, y: bottom, width: 2 * far, height: far - bottom },
    { x: -far, y: window.y, width: window.x + far, height: window.height }, { x: right, y: window.y, width: far - right, height: window.height }];
};

test('a plaque the nearest-pocket scan places keeps a wider gap from tree text', () => {
  const nodes = tree().descendants();
  const anchor = nodes.find(node => node.data.id === 'tense');
  // Block every fixed nearby pocket, leaving one open field on the open left
  // side whose nearest edge is a tall word.
  const base = plaqueTreeObstacles(nodes);
  const { width, height } = placeStagePlaques([feature], nodes, base).get(0);
  const field = { x: anchor.x - 130 - 20 - width - 300, y: anchor.y - height - 300, width: 20 + width + 300, height: 2 * height + 600 };
  const wall = { x: anchor.x - 150, y: field.y, width: 20, height: field.height, blocksConnectors: true, connectorAttachment: 'wall:terminal' };
  const fixed = [-height - 60, -height / 2, 55, 115, 175, 235].flatMap(dy => [anchor.x + 110, anchor.x - width - 110, anchor.x - width / 2]
    .map(x => ({ x, y: anchor.y + dy, width, height })));
  const obstacles = [...base, wall, ...frame(field)];
  const placement = placeStagePlaques([feature], nodes, obstacles).get(0);
  assert.equal(placement.location, 'local');
  assert(fixed.every(box => box.x !== placement.x || box.y !== placement.y), 'the scan, not a fixed pocket, placed it');
  assert(obstacles.every(obstacle => !plaquesOverlap(placement, obstacle)), 'it keeps the plain gap from everything');
  const nearestText = Math.min(...obstacles.filter(isText).map(text => clearance(placement, text)));
  assert(nearestText >= SCAN_TEXT_GAP - 1e-6, `it keeps ${SCAN_TEXT_GAP} units from tree text, not ${nearestText}`);
});

test('a scanned pocket stays at the plain gap when no nudge keeps the wider one', () => {
  const nodes = tree().descendants();
  const anchor = nodes.find(node => node.data.id === 'tense'), point = plaqueAnchorPoint(anchor);
  const base = plaqueTreeObstacles(nodes);
  const { width, height } = placeStagePlaques([feature], nodes, base).get(0);
  // One pocket within reach, open at the plain gap only, with a word 30 units above it.
  const pocket = { x: point.x + 200, y: point.y + 40, width, height };
  const word = { x: pocket.x, y: pocket.y - 30 - 40, width: 120, height: 40, blocksConnectors: true, connectorAttachment: 'other:terminal' };
  const window = { x: pocket.x - PLAQUE_GAP, y: pocket.y - PLAQUE_GAP, width: width + 2 * PLAQUE_GAP + 1, height: height + 2 * PLAQUE_GAP + 1 };
  const obstacles = [...base.filter(obstacle => !plaquesOverlap(pocket, obstacle)), word, ...frame(window)];
  const placement = placeStagePlaques([feature], nodes, obstacles).get(0);
  const distance = Math.hypot(placement.x + width / 2 - point.x, placement.y + height / 2 - point.y);
  assert(distance <= nearbyPlaqueReach({ width, height }), `the plaque stays nearby, not ${distance} away`);
  assert(obstacles.every(obstacle => !plaquesOverlap(placement, obstacle)));
  assert(clearance(placement, word) < SCAN_TEXT_GAP, 'it takes the pocket open only at the plain gap');
});
