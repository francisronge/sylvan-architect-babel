import assert from 'node:assert/strict';
import test from 'node:test';
import { sporeFrame } from '../hooks/useSporeDrift.ts';

// The retired float-spore keyframes: linear rise of 120vh with the authored drift,
// scale 1 → 0.6, opacity 0 → 0.35 over the first tenth and back to 0 over the last.
test('spore motion reproduces the float-spore keyframes', () => {
  const height = 1000, drift = 100;
  assert.deepEqual(sporeFrame(0, drift, height), { transform: 'translate3d(0px, 0px, 0) scale(1)', opacity: 0 });
  assert.ok(Math.abs(sporeFrame(0.05, drift, height).opacity - 0.175) < 1e-12);
  assert.deepEqual(sporeFrame(0.5, drift, height), { transform: 'translate3d(50px, -600px, 0) scale(0.8)', opacity: 0.35 });
  assert.ok(Math.abs(sporeFrame(0.95, drift, height).opacity - 0.175) < 1e-12);
  assert.deepEqual(sporeFrame(1, drift, height), { transform: 'translate3d(100px, -1200px, 0) scale(0.6)', opacity: 0 });
});
