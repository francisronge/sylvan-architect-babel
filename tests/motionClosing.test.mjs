import assert from 'node:assert/strict';
import test from 'node:test';
import { replayMotionFaults } from '../scripts/replayMotionContinuity.mjs';

// A phrase `s` (with its word `w`) leaves the left daughter slot of `vp` for a
// new landing under `top`; `t` stands left of it and `v` right of it.
const before = [
  { id: 'top', x: 500, y: 0, parent: null }, { id: 't', x: 0, y: 220, parent: 'top' },
  { id: 'vp', x: 1000, y: 220, parent: 'top' }, { id: 's', x: 600, y: 440, parent: 'vp' },
  { id: 'w', x: 600, y: 660, parent: 's' }, { id: 'v', x: 1400, y: 440, parent: 'vp' },
  { id: 'vw', x: 1400, y: 660, parent: 'v' },
];
const frame = (points, kind = 'relation') => ({ stage: 1, kind, operation: 'move', target: 's', links: ['s', 'copy'], points });
const after = (dx, { kind, rigid = true } = {}) => frame([
  { id: 'top', x: 500 + dx / 2, y: 0, parent: null }, { id: 't', x: 0, y: 220, parent: 'top' },
  { id: 'land', x: 300, y: 220, parent: 'top' }, { id: 's', x: 300, y: 440, parent: 'land' },
  { id: 'w', x: 300, y: 660, parent: 's' },
  { id: 'vp', x: 1000 + dx, y: 220, parent: 'top' }, { id: 'copy', x: 600 + dx, y: 440, parent: 'vp' },
  { id: 'v', x: 1400 + dx, y: 440, parent: 'vp' }, { id: 'vw', x: 1400 + dx + (rigid ? 0 : 40), y: 660, parent: 'v' },
], kind);
const faults = next => replayMotionFaults({ frames: [frame(before), next] }).map(fault => `${fault.node} ${fault.kind}`);

test('the movement step may close the gap its phrase leaves', () => {
  assert.deepEqual(faults(after(-150)), []);
});

test('closing stays a fault away from a movement, away from the gap, unevenly or beyond its room', () => {
  assert.ok(faults(after(-150, { kind: 'micro' })).some(fault => fault.startsWith('v ')), 'not a movement step');
  assert.ok(faults(after(150)).some(fault => fault.startsWith('v ')), 'moving away from the gap');
  assert.ok(faults(after(-150, { rigid: false })).some(fault => fault.startsWith('v')), 'side not moving as one');
  assert.ok(faults(after(-900)).some(fault => fault.startsWith('v ')), 'beyond the room the phrase left');
});

// A phrase `s` leaves the leftmost daughter slot for a landing further left, so
// the gap it leaves has syntax only on its right.
const leftmost = (blockShift, block = 9, sideShift = 0) => {
  const prior = [['top', 800, 0, null], ['vp', 800, 220, 'top'], ['s', 0, 440, 'vp'], ['rest', 1500, 440, 'vp'],
    ['X', 900, 660, 'rest'], ['Y', 3450, 660, 'rest']];
  const next = [['top', 800, 0, null], ['land', -400, 220, 'top'], ['s', -400, 440, 'land'], ['vp', 800, 220, 'top'],
    ['copy', 0, 440, 'vp'], ['rest', 1500 + sideShift, 440, 'vp'], ['X', 900 + blockShift, 660, 'rest'], ['Y', 3450 + sideShift, 660, 'rest']];
  for (let i = 0; i < block; i++) {
    prior.push([`x${i}`, 400 + i * 250, 880, 'X']);
    next.push([`x${i}`, 400 + i * 250 + blockShift, 880, 'X']);
  }
  for (let i = 0; i < 3; i++) {
    prior.push([`y${i}`, 3200 + i * 250, 880, 'Y']);
    next.push([`y${i}`, 3200 + i * 250 + sideShift, 880, 'Y']);
  }
  const points = list => list.map(([id, x, y, parent]) => ({ id, x, y, parent }));
  return [frame(points(prior)), frame(points(next))];
};
const faultsOf = frames => replayMotionFaults({ frames }).map(fault => `${fault.node} ${fault.kind}`);

test('a block that slides away from the gap its phrase leaves is not a closing', () => {
  assert.ok(faultsOf(leftmost(300)).some(fault => fault.startsWith('X ')), 'a block of nine leaves moving away');
  assert.ok(faultsOf(leftmost(150, 1)).some(fault => fault.startsWith('X ')), 'one leaf moving away');
  assert.deepEqual(faultsOf(leftmost(-150, 9, -150)), [], 'the whole side closing toward the gap');
});

test('both sides of the gap together close no more than the room the phrase left', () => {
  const both = d => frame([
    { id: 'top', x: 500, y: 0, parent: null }, { id: 't', x: d, y: 220, parent: 'top' }, { id: 'tw', x: d, y: 440, parent: 't' },
    { id: 'land', x: -400, y: 220, parent: 'top' }, { id: 's', x: -400, y: 440, parent: 'land' }, { id: 'w', x: -400, y: 660, parent: 's' },
    { id: 'vp', x: 1000 - d, y: 220, parent: 'top' }, { id: 'copy', x: 600 - d, y: 440, parent: 'vp' },
    { id: 'v', x: 1400 - d, y: 440, parent: 'vp' }, { id: 'vw', x: 1400 - d, y: 660, parent: 'v' }]);
  const prior = frame([
    { id: 'top', x: 500, y: 0, parent: null }, { id: 't', x: 0, y: 220, parent: 'top' }, { id: 'tw', x: 0, y: 440, parent: 't' },
    { id: 'vp', x: 1000, y: 220, parent: 'top' }, { id: 's', x: 600, y: 440, parent: 'vp' }, { id: 'w', x: 600, y: 660, parent: 's' },
    { id: 'v', x: 1400, y: 440, parent: 'vp' }, { id: 'vw', x: 1400, y: 660, parent: 'v' }]);
  assert.ok(faultsOf([prior, both(370)]).length, 'each side closing 370 against a room of 375');
  assert.deepEqual(faultsOf([prior, both(150)]), [], 'each side closing 150');
});

// A phrase `s` departs from x=600; the parent `p` of `a` (still) and `b` (closing
// from 1400 to 1250) recentres from 1200 over its daughters, to 1125.
test('a parent of a closing daughter is granted only the move that recentres it', () => {
  const prior = frame([
    { id: 'top', x: 900, y: 0, parent: null }, { id: 's', x: 600, y: 220, parent: 'top' },
    { id: 'p', x: 1200, y: 220, parent: 'top' }, { id: 'a', x: 1000, y: 440, parent: 'p' }, { id: 'b', x: 1400, y: 440, parent: 'p' }]);
  const next = parentX => frame([
    { id: 'top', x: 900, y: 0, parent: null }, { id: 'land', x: 900, y: -220, parent: null }, { id: 's', x: 900, y: 0, parent: 'land' },
    { id: 'p', x: parentX, y: 220, parent: 'top' }, { id: 'a', x: 1000, y: 440, parent: 'p' }, { id: 'b', x: 1250, y: 440, parent: 'p' }]);
  assert.deepEqual(faultsOf([prior, next(1125)]), [], 'recentring over its daughters');
  assert.deepEqual(faultsOf([prior, next(1350)]), ['p unowned-motion'], 'moving away from the gap and off its daughters');
});
