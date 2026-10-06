import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceContourPairPreparer, prepareWorkspaceContourPair, workspaceContourPairCollision } from '../replay/workspaceContourPairs.ts';

const compare = (prepare, left, right) => {
  const expected = prepareWorkspaceContourPair(left, right), actual = prepare(left, right);
  assert.ok(Object.is(actual.separation, expected.separation));
  assert.deepEqual(actual.rightByY, expected.rightByY);
  for (const dx of [-100, -0, 0, 1 / 3, 10, 1e6]) {
    const a = workspaceContourPairCollision(actual, dx), b = workspaceContourPairCollision(expected, dx);
    assert.deepEqual(a, b);
    if (a) { assert.equal(a[0], b[0]); assert.equal(a[1], b[1]); }
  }
  return actual;
};

test('vertical index reuse preserves current horizontal arithmetic and exact ordered contact identities', () => {
  const prepare = createWorkspaceContourPairPreparer();
  const curve = { source: { x: 0, y: 0 }, control1: { x: 0, y: 50 }, control2: { x: 100, y: 50 }, target: { x: 100, y: 100 } };
  const left = Array.from({ length: 21 }, (_, i) => ({ x: i / 3 - 50, y: (i % 4) * 20, width: 30, height: 31 }));
  const right = Array.from({ length: 26 }, (_, i) => ({ x: 35 - i / 7, y: ((i * 3) % 5) * 20, width: 25, height: 26 }));
  right.splice(6, 0, { x: -5, y: -5, width: 110, height: 110, curve, curvePadding: 5 });
  const before = compare(prepare, left, right);
  const movedLeft = left.map(rect => ({ ...rect, x: rect.x + 2 ** 53, width: rect.width + 1 }));
  const movedRight = right.map(rect => ({ ...rect, x: rect.x + 2 ** 53 }));
  const after = compare(prepare, movedLeft, movedRight);
  assert.notEqual(after.rightByY, before.rightByY);
  assert.notEqual(after.maximumBottomByPrefix, before.maximumBottomByPrefix);
  assert.notEqual(after.answers, before.answers);
  before.maximumBottomByPrefix.fill(NaN);
  before.rightByY.reverse();
  compare(prepare, movedLeft, movedRight);
});

test('duplicate source objects and equal vertical values retain stable original-index sorting', () => {
  const prepare = createWorkspaceContourPairPreparer();
  const shared = { x: 0, y: 1, width: 10, height: 10 };
  const left = [{ x: 0, y: 0, width: 10, height: 20 }];
  compare(prepare, left, [shared, shared, { ...shared }]);
  const next = compare(prepare, left, [{ ...shared, x: 100 }, { ...shared, x: 200 }, { ...shared, x: 5 }]);
  assert.equal(workspaceContourPairCollision(next, 0)[1].x, 5);
});

test('in-place vertical edits invalidate; horizontal edits reuse; signed zero remains an exact input', () => {
  const prepare = createWorkspaceContourPairPreparer();
  const left = [{ x: 0, y: 0, width: 10, height: 20 }], right = [{ x: 0, y: 5, width: 10, height: 20 }];
  compare(prepare, left, right);
  right[0].x = 99;
  compare(prepare, left, right);
  right[0].y = -10;
  compare(prepare, left, right);
  right[0].y = 5;
  compare(prepare, left, right);
  left[0].y = -0;
  compare(prepare, left, right);
  compare(createWorkspaceContourPairPreparer(), left, right);
});

test('nonfinite vertical inputs retain the original sort and scan without reuse', () => {
  for (const y of [NaN, Infinity, -Infinity]) {
    const prepare = createWorkspaceContourPairPreparer();
    const left = [{ x: 0, y, width: 20, height: 10 }], right = [{ x: 10, y: 0, width: 20, height: 10 }];
    compare(prepare, left, right);
  }
  const overflow = [{ x: 0, y: Number.MAX_VALUE, width: 10, height: Number.MAX_VALUE }];
  compare(createWorkspaceContourPairPreparer(), overflow, overflow);
});

test('touching, negative heights, empty collections and large coordinates match the original scan', () => {
  const prepare = createWorkspaceContourPairPreparer();
  const rectangles = [-20, -0, 0, 1e-6, 1, 2 ** 53].flatMap(y => [-1, 0, 1, 20].map(height => ({ x: y, y, width: 10, height })));
  compare(prepare, rectangles, rectangles);
  compare(prepare, [], rectangles);
  compare(prepare, rectangles, []);
});

test('crossing entry and contact limits preserves outputs and previously returned pairs', () => {
  const prepare = createWorkspaceContourPairPreparer();
  const make = y => [{ x: 0, y, width: 10, height: 10 }];
  const first = compare(prepare, make(0), make(0));
  const snapshot = structuredClone(first);
  for (let i = 1; i <= 64; i++) prepare(make(i), make(i));
  compare(prepare, make(0), make(0));
  assert.deepEqual(first, snapshot);
  const large = (y, count = 200) => Array.from({ length: count }, () => ({ x: 0, y, width: 10, height: 10 }));
  compare(prepare, large(100), large(100));
  prepare(large(200), large(200));
  compare(prepare, large(100), large(100));
  const oversized = compare(prepare, large(300, 257), large(300, 256));
  assert.equal(oversized.separation, prepareWorkspaceContourPair(large(300, 257), large(300, 256)).separation);
});
