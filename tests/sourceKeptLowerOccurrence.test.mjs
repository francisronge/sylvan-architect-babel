// A movement may let the landing or the lower occurrence keep the moved
// phrase's id (systemInstruction.js). The camera carry reads the same movement
// alike in both spellings: a lower occurrence that keeps the id while the
// movement takes its material is no more a reference than a new one would be.
import assert from 'node:assert/strict';
import test from 'node:test';
import { carryReference, paintedShift } from '../replay/cameraCarry.ts';

const painted = list => new Map(list.map(([id, x, y, parentId]) => [id, { x, y, parentId }]));
// A phrase `s` with its word `w` leaves the left daughter slot of `vp` for a
// landing under `top`; `v` right of it closes the room by 150.
const before = painted([['top', 500, 0, null], ['t', 0, 220, 'top'], ['vp', 1000, 220, 'top'], ['s', 600, 440, 'vp'],
  ['w', 600, 660, 's'], ['v', 1400, 440, 'vp'], ['vw', 1400, 660, 'v']]);
// The same picture after the movement, spelled with the landing keeping `s` (the
// lower occurrence is the new `copy`) or with the lower occurrence keeping it
// (the landing is the new `L`, holding `w`).
const after = spelling => {
  const landing = spelling === 'landing' ? 's' : 'L', lower = spelling === 'landing' ? 'copy' : 's';
  return painted([['top', 500, 0, null], ['t', 0, 220, 'top'], ['land', 300, 220, 'top'], [landing, 300, 440, 'land'],
    ['w', 300, 660, landing], ['vp', 925, 220, 'top'], [lower, 600, 440, 'vp'], ['v', 1250, 440, 'vp'], ['vw', 1250, 660, 'v']]);
};

test('the camera carry leaves out a lower occurrence its movement emptied, as it never holds a new one', () => {
  assert.ok(!carryReference(before, after('source')).includes('s'), 'the emptied lower occurrence is no reference');
  assert.ok(carryReference(before, after('landing')).includes('v'), 'the rest is still held');
  assert.deepEqual(paintedShift(before, after('source')), paintedShift(before, after('landing')));
});
