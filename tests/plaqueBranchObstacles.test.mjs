import test from 'node:test';
import assert from 'node:assert/strict';
import { plaqueBranchObstacles, plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';

function original(parent, node, precise) {
  const middle = (parent.y + node.y) / 2;
  const curve = precise ? { source: { ...parent }, control1: { x: parent.x, y: middle },
    control2: { x: node.x, y: middle }, target: { ...node } } : undefined;
  const boxes = []; let previous = { ...parent };
  for (let i = 1; i <= 32; i++) {
    const t = i / 32, u = 1 - t;
    const point = { x: (u ** 3 + 3 * u * u * t) * parent.x + (3 * u * t * t + t ** 3) * node.x,
      y: u ** 3 * parent.y + (3 * u * u * t + 3 * u * t * t) * middle + t ** 3 * node.y };
    boxes.push({ x: Math.min(previous.x, point.x) - 5, y: Math.min(previous.y, point.y) - 5,
      width: Math.abs(previous.x - point.x) + 10, height: Math.abs(previous.y - point.y) + 10,
      ...(curve ? { curve, curvePadding: 5 } : {}) });
    previous = point;
  }
  return boxes;
}
test('branch-only sampling preserves every native rectangle and floating-point operation', () => {
  for (const [parent, child] of [
    [{ x: 0, y: 0 }, { x: 37.1, y: 220 }], [{ x: -0, y: -0 }, { x: 0, y: 220 }],
    [{ x: -582.1234, y: 79.124 }, { x: -984.832, y: 1520.633 }],
    [{ x: 1e8, y: -1e6 }, { x: 1e8 - .001, y: 1e8 + .333 }]
  ]) for (const precise of [false, true]) {
    const actual = plaqueBranchObstacles(parent, child, precise);
    assert.deepEqual(actual, original(parent, child, precise));
    if (precise) assert.equal(actual[0].curve, actual[31].curve);
  }
});
test('tree reservations and branch-only reservations share the same sampled geometry', () => {
  const parent = { x: 20, y: 30, data: { id: 'p', label: 'NP' } };
  const child = { x: -300, y: 290, data: { id: 'n', label: 'N', word: 'tree' }, parent };
  parent.children = [child]; child.children = [];
  assert.deepEqual(plaqueTreeObstacles([parent, child], undefined, true).filter(box => box.curve),
    plaqueBranchObstacles(parent, child, true));
});
