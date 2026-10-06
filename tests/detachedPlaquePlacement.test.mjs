import test from 'node:test';
import assert from 'node:assert/strict';
import { detachedPlaqueOrigin } from '../components/detachedPlaquePlacement.ts';

const clear = (a, b, gap) => a.x + a.width + gap <= b.x || a.x >= b.x + b.width + gap
  || a.y + a.height + gap <= b.y || a.y >= b.y + b.height + gap;
const phone = { left: 12, right: 378, top: 88, bottom: 542 };
const tree = { x: 100, y: 230, width: 230, height: 186 };

for (const [width, height] of [[300, 112], [290, 66], [150, 84]]) {
  test(`${width} by ${height}: a detached panel clears the tree and both phone controls`, () => {
    const preferred = { x: phone.right - width, y: 310, width, height };
    assert(!clear(preferred, tree, 12), 'the old clamped position covers the tree');
    const original = structuredClone({ preferred, phone, tree });
    const result = detachedPlaqueOrigin(preferred, phone, [tree], 12);
    assert(result);const actual = { ...preferred, ...result };
    assert(clear(actual, tree, 12));
    assert(actual.x >= phone.left && actual.x + width <= phone.right);
    assert(actual.y >= phone.top && actual.y + height <= phone.bottom);
    assert.deepEqual({ preferred, phone, tree }, original);
  });
}

test('a clear desktop placement is exactly preserved', () => {
  const preferred = { x: 1210, y: 310, width: 300, height: 112 };
  assert.deepEqual(detachedPlaqueOrigin(preferred, { left: 28, top: 90, right: 1572, bottom: 790 },
    [{ x: 420, y: 150, width: 750, height: 550 }], 12), { x: 1210, y: 310 });
});

test('all obstacles constrain placement, including an already placed panel', () => {
  const obstacles = [tree, { x: 12, y: 428, width: 366, height: 114 }];
  const panel = { x: 78, y: 310, width: 300, height: 112 };
  const result = detachedPlaqueOrigin(panel, phone, obstacles, 12);assert(result);
  assert(obstacles.every(rect => clear({ ...panel, ...result }, rect, 12)));
  assert(result.y < tree.y);
});

test('an infeasible viewport reports no position without hiding or shrinking content', () => {
  assert.equal(detachedPlaqueOrigin({ x: 20, y: 20, width: 100, height: 100 },
    { left: 0, top: 0, right: 90, bottom: 90 }, [], 12), null);
  assert.equal(detachedPlaqueOrigin({ x: 0, y: 0, width: 300, height: 112 }, phone,
    [{ x: 0, y: 0, width: 400, height: 600 }], 12), null);
});

test('placement commutes with a common camera scale and translation', () => {
  const panel = { x: 78, y: 310, width: 300, height: 112 };
  const result = detachedPlaqueOrigin(panel, phone, [tree], 12);assert(result);
  for (const scale of [0.25, 2, 4]) {
    const rect = r => ({ x: r.x * scale + 32, y: r.y * scale - 16, width: r.width * scale, height: r.height * scale });
    const viewport = { left: phone.left * scale + 32, right: phone.right * scale + 32,
      top: phone.top * scale - 16, bottom: phone.bottom * scale - 16 };
    assert.deepEqual(detachedPlaqueOrigin(rect(panel), viewport, [rect(tree)], 12 * scale),
      { x: result.x * scale + 32, y: result.y * scale - 16 });
  }
});
