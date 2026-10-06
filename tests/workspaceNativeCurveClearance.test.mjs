import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';
import { cubicIntersectsRect } from '../replay/relations/curveClearance.ts';

for (const direction of [1, -1]) test(`native branch clearance preserves padding and rejects empty sample corners, direction ${direction}`, () => {
  const root = d3.hierarchy({ id: 'parent', label: 'VP', children: [{ id: 'child', label: 'DP' }] });
  root.x = 0; root.y = 0;
  root.children[0].x = direction * 2200; root.children[0].y = 215;
  const nodes = root.descendants();
  const coarse = plaqueTreeObstacles(nodes);
  const precise = plaqueTreeObstacles(nodes, undefined, true);
  assert.deepEqual(precise.map(({ curve, curvePadding, ...box }) => box), coarse,
    'precise checks retain every reserved rectangle at its original size');
  const branches = precise.filter(box => box.curve);
  assert.equal(branches.length, 32);
  assert(branches.every(box => box.curvePadding === 5));
  const clear = { x: direction === 1 ? 2125 : -2275, y: 65, width: 150, height: 110 };
  const intersectsBox = box => box.x < clear.x + clear.width && box.x + box.width > clear.x
    && box.y < clear.y + clear.height && box.y + box.height > clear.y;
  assert(branches.some(intersectsBox), 'the broad sample boxes flag the empty corner');
  assert.equal(cubicIntersectsRect(branches[0].curve, clear, 5), false);
  assert.equal(cubicIntersectsRect(branches[0].curve, { ...clear, y: 85 }, 5), true,
    'a real branch contact is still rejected');
  assert.deepEqual(plaqueTreeObstacles([root.children[0]], undefined, true),
    plaqueTreeObstacles([root.children[0]]), 'an invisible parent supplies no native branch');
});
