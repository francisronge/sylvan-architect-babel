import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWorkspaceContourPair, workspaceContourPairCollision } from '../replay/workspaceContourPairs.ts';
import { cubicIntersectsRect } from '../replay/relations/curveClearance.ts';

const rect = (x, y, width, height) => ({ x, y, width, height });
const translated = (r, dx) => ({ ...r, x: r.x + dx, y: r.y + 0,
  ...(r.curve ? { curve: Object.fromEntries(Object.entries(r.curve).map(([id, p]) => [id, { x: p.x + dx, y: p.y + 0 }])) } : {}) });
// Frozen V9 arithmetic and contact order, retained as the differential oracle.
function legacy(left, right) {
  const pairs = [], sorted = [...right].sort((a, b) => a.y - b.y); let separation = 1;
  for (const a of left) for (const b of sorted) {
    if (b.y >= a.y + a.height) break;
    if (b.y + b.height <= a.y) continue;
    pairs.push([a, b]); separation = Math.max(separation, a.x + a.width - b.x + 16);
  }
  return { separation, pairs, collision: dx => pairs.find(([a, b]) => {
    const shifted = translated(b, dx), width = Math.min(a.x + a.width, shifted.x + shifted.width) - Math.max(a.x, shifted.x);
    return width > 1e-6 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1e-6
      && (!a.curve || cubicIntersectsRect(a.curve, shifted, a.curvePadding))
      && (!shifted.curve || cubicIntersectsRect(shifted.curve, a, shifted.curvePadding));
  }) };
}
function parity(left, right, offsets) {
  const old = legacy(left, right), pair = prepareWorkspaceContourPair(left, right);
  assert.ok(Object.is(pair.separation, old.separation));
  for (const dx of offsets) {
    const expected = old.collision(dx), actual = workspaceContourPairCollision(pair, dx);
    assert.equal(actual?.[0], expected?.[0]); assert.equal(actual?.[1], expected?.[1]);
  }
  return pair;
}

test('compact contacts preserve stable equal-Y and left order', () => {
  const left = [rect(0, 10, 100, 50), rect(0, 0, 100, 80)];
  const first = rect(10, 20, 10, 10), second = rect(20, 20, 10, 10), earlier = rect(0, -20, 10, 10);
  const right = [first, second, earlier], before = structuredClone([left, right]), pair = prepareWorkspaceContourPair(left, right);
  assert.equal(pair.separation, legacy(left, right).separation);
  const contact = workspaceContourPairCollision(pair, 0);
  assert.equal(contact[0], left[0]); assert.equal(contact[1], first);
  assert.deepEqual(workspaceContourPairCollision(pair, 0), contact);
  assert.deepEqual([left, right], before);
});

for (const axis of ['x', 'y']) test(`exact overlap threshold is unchanged on ${axis} near +/-1e-6`, () => {
  for (const overlap of [-1e-6, 0, 1e-6 - 1e-12, 1e-6, 1e-6 + 1e-12, 2e-6]) {
    const a = rect(0, 0, 1, 1), b = rect(axis === 'x' ? 1 - overlap : 0, axis === 'y' ? 1 - overlap : 0, 1, 1);
    parity([a], [b], [0, -0]);
  }
});

test('scalar rejection does not inspect or translate a distant curve', () => {
  const b = rect(1000, 0, 10, 10); Object.defineProperty(b, 'curve', { get() { throw Error('unneeded curve access'); } });
  const pair = prepareWorkspaceContourPair([rect(0, 0, 10, 10)], [b]);
  assert.equal(workspaceContourPairCollision(pair, 0), undefined);
});

test('large-coordinate cancellation retains shifted-X then shifted-right arithmetic', () => {
  const large = 2 ** 53;
  parity([rect(0, 0, 5, 10), rect(-large, 0, 4, 10)], [rect(large, 0, 1, 10)], [-large, -large + 2, -large - 2, 0]);
});

for (const sign of [1, -1]) test(`native curves retain exact contact order with RTL-like offsets (${sign})`, () => {
  const curve = { source: { x: 0, y: 0 }, control1: { x: 0, y: 107.5 }, control2: { x: sign * 2200, y: 107.5 }, target: { x: sign * 2200, y: 215 } };
  const branch = { ...rect(Math.min(0, sign * 2200) - 5, -5, 2210, 225), curve, curvePadding: 5 };
  const corner = rect(sign === 1 ? 2125 : -2275, 65, 150, 110), crossing = { ...corner, y: 85 };
  for (const dx of [-2000, -100, 0, 100, 2000]) {
    const shifted = [corner, crossing].map(r => ({ ...r, x: r.x - dx }));
    const pair = parity([branch], shifted, [dx]);
    assert.equal(workspaceContourPairCollision(pair, dx)?.[1], shifted[1]);
    parity(shifted, [branch], [-dx]);
  }
});

test('two curved obstacles keep both legacy curve checks and answer-map ownership', () => {
  const curve = y => ({ source: { x: 0, y }, control1: { x: 0, y: y + 20 }, control2: { x: 40, y: y + 20 }, target: { x: 40, y: y + 40 } });
  const a = { ...rect(-5, -5, 50, 50), curve: curve(0), curvePadding: 5 };
  const b = { ...rect(-5, 5, 50, 50), curve: curve(10), curvePadding: 5 };
  const pair = parity([a], [b], [-100, -20, 0, 20, 100]);
  assert.equal(pair.answers.size, 0); pair.answers.set(0, false); workspaceContourPairCollision(pair, 0); assert.equal(pair.answers.get(0), false);
});

test('prefix skips completed rows without changing equal-Y contact order', () => {
  const earlier = rect(0, -40, 10, 5), touching = rect(0, -20, 10, 10);
  const first = rect(0, -10, 10, 10), second = rect(1, -10, 10, 10);
  const left = [rect(0, -10, 10, 5), rect(0, -9, 10, 5)];
  const pair = parity(left, [first, earlier, second, touching], [0, -10, 10]);
  assert.equal(workspaceContourPairCollision(pair, 0)[1], first);
});

test('a long early rectangle remains eligible behind completed short rows', () => {
  const long = rect(0, -100, 40, 500);
  const right = [long, ...Array.from({ length: 40 }, (_, index) => rect(5, index * 5, 10, 1))];
  const pair = parity([rect(0, 300, 40, 10)], right, [-50, 0, 50]);
  assert.equal(workspaceContourPairCollision(pair, 0)[1], long);
});

test('negative coordinates, exact touches and inverted vertical extents retain the original scan', () => {
  const left = [rect(-30, -20, 10, 10), rect(-30, -10, 10, 0), rect(-30, -5, 10, -10), rect(-30, -0, 10, 10)];
  const right = [rect(-25, -100, 10, 80), rect(-25, -20, 10, 5), rect(-25, -10, 10, 10), rect(-25, 0, 10, -10)];
  parity(left, right, [-20, -0, 0, 20]);
});

test('nonfinite right extents preserve the original ordered scan and pair identities', () => {
  for (const field of ['y', 'height']) for (const value of [NaN, Infinity, -Infinity]) {
    const invalid = { ...rect(1, 2, 3, 4), [field]: value };
    parity([rect(0, 0, 10, 10), rect(-10, -20, 30, 40)], [rect(0, -10, 10, 5), invalid, rect(0, 3, 10, 5)], [-10, -0, 0, 10]);
  }
  parity([rect(0, 0, 10, 10)], [rect(0, Number.MAX_VALUE, 10, Number.MAX_VALUE), rect(0, 0, 10, 10)], [0]);
});

test('nonfinite left extents preserve the original ordered scan and separation arithmetic', () => {
  for (const field of ['y', 'height']) for (const value of [NaN, Infinity, -Infinity]) {
    const invalid = { ...rect(1, 2, 3, 4), [field]: value };
    parity([invalid], [rect(0, -10, 10, 5), rect(0, 0, 10, 10), rect(0, 20, 10, 10)], [-10, -0, 0, 10]);
  }
  parity([rect(0, Number.MAX_VALUE, 10, Number.MAX_VALUE)], [rect(0, 0, 10, 10)], [0]);
});

test('separation and lazy contacts avoid rescanning a fully completed vertical prefix', () => {
  let reads = 0;
  const count = 128;
  const right = Array.from({ length: count }, (_, index) => ({
    x: 0, get y() { reads++; return index * 2; }, width: 10, height: 1
  }));
  const left = Array.from({ length: count }, () => rect(0, 1000, 10, 10));
  const pair = prepareWorkspaceContourPair(left, right);
  assert.equal(pair.separation, 1);
  assert.equal(workspaceContourPairCollision(pair, 0), undefined);
  assert.ok(reads < count * 10, `expected one index build instead of repeated scans, got ${reads} reads`);
});

test('a previously prepared pair without a prefix keeps the legacy scan', () => {
  const left = [rect(0, 0, 10, 10)], right = [rect(0, -10, 10, 30), rect(1, 0, 10, 10)];
  const old = legacy(left, right);
  const pair = { left, rightByY: [...right].sort((a, b) => a.y - b.y), separation: old.separation, answers: new Map() };
  const contact = workspaceContourPairCollision(pair, 0);
  assert.equal(contact[0], old.pairs[0][0]);
  assert.equal(contact[1], old.pairs[0][1]);
});
