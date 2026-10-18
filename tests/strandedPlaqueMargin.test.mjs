import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { nearbyPlaqueReach, placeStagePlaques, plaqueAnchorPoint, plaqueIdentity } from '../replay/relations/plaquePlacement.ts';

const nodes = d3.tree().nodeSize([600, 300])(d3.hierarchy({ id: 'cp', label: 'CP', children: [
  { id: 'subject', label: 'DP', children: [{ id: 'd', label: 'D', word: 'Ingen' }] }] })).descendants();
const anchor = plaqueAnchorPoint(nodes.find(node => node.data.id === 'subject'));
const feature = { kind: 'node-plaque', plaqueStyle: 'feature', anchorNodeIds: ['subject'], title: 'Features',
  rows: [{ label: 'case', value: 'nominative' }], relationRef: { stageIndex: 0, relationIndex: 0 } };
const width = 360, height = 129, reach = nearbyPlaqueReach({ width, height });
// Everything below `top` is taken, so the nearest pocket sits above it at the kept margin.
const top = -335;
const place = (obstacle, previous = new Map()) => {
  const obstacles = [{ x: anchor.x - 3000, y: anchor.y + top, width: 6000, height: 6000, ...obstacle }];
  return placeStagePlaques([feature], nodes, obstacles, previous, undefined, {
    sizes: new Map([[plaqueIdentity(feature), { width, height }]]),
    spaceFor: () => ({ obstacles, acceptsConnector: () => true }) }).get(0);
};
const distance = box => Math.hypot(box.x + width / 2 - anchor.x, box.y + height / 2 - anchor.y);

test('a plaque that would strand keeps half the margin from syntax instead', () => {
  assert(-top + 24 + height / 2 > reach && -top + 12 + height / 2 <= reach, 'only the half margin is within reach');
  const box = place({});
  assert.equal(box.inkMargin, 12);
  assert(Math.abs(distance(box) - (-top + 12 + height / 2)) < 1e-6);
  assert.deepEqual(place({}, new Map([[plaqueIdentity(feature), box]])), box, 'the narrower pocket is carried unchanged');
});

test('another plaque keeps the full margin in both directions', () => {
  const box = place({ blocksConnectors: true });
  assert.equal(box.inkMargin, undefined);
  assert(distance(box) > reach, 'no pocket within reach clears the other plaque by the full margin');
});
