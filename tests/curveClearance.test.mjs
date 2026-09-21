import assert from 'node:assert/strict';
import test from 'node:test';
import { cubicIntersectsRect } from '../replay/relations/curveClearance.ts';
import { preparePlaqueObstacleIndex } from '../replay/relations/plaqueObstacleIndex.ts';

test('a long diagonal connector does not occupy the empty corners of its sample rectangles', () => {
  const curve = { source: { x: 0, y: 0 }, control1: { x: 1000, y: 1000 },
    control2: { x: 2000, y: 2000 }, target: { x: 3000, y: 3000 } };
  const clear = { x: 65, y: 20, width: 10, height: 10 };
  const blocked = { x: 45, y: 45, width: 10, height: 10 };
  assert.equal(cubicIntersectsRect(curve, clear, 6), false);
  assert.equal(cubicIntersectsRect(curve, blocked, 6), true);
  assert.equal(preparePlaqueObstacleIndex([clear]).some({ x: 0, y: 0, width: 3000, height: 3000 },
    rect => cubicIntersectsRect(curve, rect, 6)), false);
  assert.equal(preparePlaqueObstacleIndex([clear, blocked]).some({ x: 0, y: 0, width: 3000, height: 3000 },
    rect => cubicIntersectsRect(curve, rect, 6)), true);
});

test('curve clearance catches the bowed middle, tangent contact, and the stroke margin', () => {
  const curve = { source: { x: 0, y: 0 }, control1: { x: 0, y: 100 },
    control2: { x: 100, y: 100 }, target: { x: 100, y: 0 } };
  assert.equal(cubicIntersectsRect(curve, { x: 49, y: 74, width: 2, height: 2 }, 0), true);
  assert.equal(cubicIntersectsRect(curve, { x: 49, y: 75, width: 2, height: 2 }, 0), true);
  assert.equal(cubicIntersectsRect(curve, { x: 49, y: 78, width: 2, height: 2 }, 4), true);
  assert.equal(cubicIntersectsRect(curve, { x: 49, y: 78, width: 2, height: 2 }, 2), false);
  assert.equal(cubicIntersectsRect(curve, { x: 45, y: 0, width: 10, height: 10 }, 0), false);
});
