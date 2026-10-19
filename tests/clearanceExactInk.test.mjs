import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds } from '../replay/displayIdentity.ts';
import { collisionAreas, ForbiddenShifts, minimumClearanceShift } from '../replay/workspaceComponentLifetime.ts';
function node(id, x) { const root = d3.hierarchy({ id, label: id }); applyVizIds(root); return Object.assign(root, { x, y: 0 }); }
for (const direction of [1, -1]) {
  test(`${direction}: source clearance measures the same styled label bounds as validation`, () => {
    const a = node('a', 0), b = node('b', 500 * direction), labels = new Map([['a', [{ kind: 'category' }]], ['b', [{ kind: 'category' }]]]);
    const metrics = { treeLabelRuns: labels, measureTreeLabel: () => ({ x: -400, y: -40, width: 800, height: 80 }) };
    assert.equal(collisionAreas([a], [b]).size, 0);
    const measured = collisionAreas([a], [b], undefined, metrics);
    assert(measured.get(JSON.stringify(['a', 'b'])) > 0);
    assert.deepEqual(collisionAreas([a], [b], undefined, metrics), measured, 'unchanged measured ink is not a new collision');
    assert.equal(a.x, 0); assert.equal(b.x, 500 * direction);
  });
  test(`${direction}: unavailable styled bounds preserve the existing footprint`, () => {
    const a = node('a', 0), b = node('b', 30 * direction);
    const metrics = { treeLabelRuns: new Map([['a', [{ kind: 'category' }]]]), measureTreeLabel: () => undefined };
    assert.deepEqual(collisionAreas([a], [b], undefined, metrics), collisionAreas([a], [b]));
  });
}

test('a missing opposing component cannot require native ink measurement', () => {
  const a = node('a', 0);
  const measure = () => { throw Error('No collision pair exists to measure'); };
  assert.equal(collisionAreas([a], [], measure).size, 0);
  assert.equal(collisionAreas([], [a], measure).size, 0);
});

test('clearance preserves connected unions and endpoint ties when zero is uncovered', () => {
  assert.equal(minimumClearanceShift([{ low: -10, high: -1 }, { low: 1, high: 10 }]), undefined);
  assert.equal(minimumClearanceShift([{ low: -10, high: 0 }, { low: 0, high: 10 }]), 11);
  assert.equal(minimumClearanceShift([{ low: -10, high: 0 }]), undefined);
  assert.equal(minimumClearanceShift([{ low: 0, high: 10 }]), undefined);
  assert.equal(minimumClearanceShift([{ low: -10, high: 1 }, { low: 1, high: 2 }]), 3);
  assert.equal(minimumClearanceShift([{ low: -Infinity, high: -1 }, { low: 1, high: Infinity }]), undefined);
});

test('lazily collected forbidden shifts give the shift of every interval, built or not', () => {
  let seed = 4111;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2**32);
  // Coarse rows and columns so boxes touch exactly, plus fractional strays.
  const ink = (count, x) => Array.from({ length: count }, () => ({ x: x + Math.floor(random() * 12) * 10 + (random() < 0.2 ? random() : 0),
    y: Math.floor(random() * 8) * 20, width: Math.floor(random() * 4) * 10, height: Math.floor(random() * 3) * 20 }));
  const exhaustive = pairs => {
    const intervals = [];
    for (const [own, other] of pairs) for (const a of own) for (const b of other)
      if (!(a.y + a.height <= b.y || a.y >= b.y + b.height) && !(Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y)))
        intervals.push({ low: b.x - a.x - a.width, high: b.x + b.width - a.x });
    return minimumClearanceShift(intervals);
  };
  let shifted = 0, clear = 0;
  for (let trial = 0; trial < 300; trial++) {
    const pairs = Array.from({ length: 1 + (trial % 3) }, () => [ink(12, 0), ink(16, Math.floor(random() * 5) * 40)]);
    const shifts = new ForbiddenShifts();
    for (const [own, other] of pairs) shifts.add(own, other);
    const expected = exhaustive(pairs);
    assert.equal(shifts.minimum(), expected);
    assert.equal(shifts.minimum(), expected, 'a repeated request returns the same shift');
    if (expected === undefined) clear++; else shifted++;
  }
  assert.ok(shifted > 20 && clear > 20, `${shifted} shifted, ${clear} clear`);
});
