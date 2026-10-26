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
