import assert from 'node:assert/strict';
import test from 'node:test';
import { animateReplayCamera } from '../components/replayCameraMotion.ts';

function clock() {
  let now = 0, next = 0;
  const pending = new Map();
  return {
    now: () => now, request: callback => { pending.set(++next, callback); return next; },
    cancel: id => pending.delete(id),
    advance(time) { now = time; const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(now)); },
    get pending() { return pending.size; }
  };
}

test('a camera fit travels continuously and reaches the exact requested transform', () => {
  const timer = clock(), poses = []; let finished = 0;
  const from = { x: -257, y: 62, k: .211 }, to = { x: 211, y: 202, k: .141 };
  animateReplayCamera(from, to, 360, pose => poses.push(pose), () => finished++, timer);
  assert.deepEqual(poses[0], from, 'the new scene starts with the currently painted camera');
  for (let time = 16; time < 360; time += 16) timer.advance(time);
  assert.equal(finished, 0);
  assert(poses.length > 20);
  for (let i = 1; i < poses.length; i++) {
    const a = poses[i - 1], b = poses[i];
    assert(b.x > a.x && b.y > a.y && b.k < a.k);
    const displacement = Math.abs((b.x + 1510 * b.k) - (a.x + 1510 * a.k));
    assert(displacement < 30, 'the reported Korean node does not jump hundreds of pixels in one paint');
  }
  timer.advance(360);
  assert.deepEqual(poses.at(-1), to);
  assert.equal(finished, 1);
  assert.equal(timer.pending, 0);
});

test('a gesture or a new Replay step cancels the old fit without a final snap', () => {
  const timer = clock(), poses = []; let finished = 0;
  const stop = animateReplayCamera({ x: 0, y: 0, k: 1 }, { x: 100, y: 50, k: .5 }, 360,
    pose => poses.push(pose), () => finished++, timer);
  timer.advance(120); stop(); const last = poses.at(-1);
  timer.advance(500);
  assert.equal(poses.at(-1), last);
  assert.equal(finished, 0);
  assert.equal(timer.pending, 0);
});

test('reduced motion and an unchanged camera finish synchronously without scheduling frames', () => {
  for (const [to, duration] of [[{ x: 100, y: 50, k: .5 }, 0], [{ x: 0, y: 0, k: 1 }, 360]]) {
    const timer = clock(), poses = []; let finished = 0;
    animateReplayCamera({ x: 0, y: 0, k: 1 }, to, duration, pose => poses.push(pose), () => finished++, timer);
    assert.deepEqual(poses, [to]); assert.equal(finished, 1); assert.equal(timer.pending, 0);
  }
});
