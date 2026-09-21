import assert from 'node:assert/strict';
import test from 'node:test';
import { caseAssignmentPlaqueCurve } from '../replay/relations/overlayGeometry.ts';
import { sampleCubic } from '../replay/relations/markGeometry.ts';

test('near-aligned Case arrows retain a visible turn into either side of the plaque', () => {
  const source = { x: -75, y: -60, width: 150, height: 60 };
  for (const direction of [-1, 1]) {
    const box = { x: direction === 1 ? 11 : -491, y: 65, width: 480, height: 238 };
    const curve = caseAssignmentPlaqueCurve(source, box, box.y + 93);
    const points = sampleCubic(curve.source, curve.control1, curve.control2, curve.target, 64);
    assert(Math.max(...points.map(point => -direction * point.x)) > 25,
      'the vertical approach needs a visible bow, even when its endpoints almost align');
    assert(direction * (curve.target.x - curve.control2.x) > 50,
      'the arrow reaches the Case row with a full horizontal turn');
    assert.equal(curve.target.y, box.y + 93);
    assert(points.every(point => direction === 1 ? point.x < box.x : point.x > box.x + box.width),
      'the whole curve remains outside the plaque');
  }
});

test('ordinary Orchard side approaches and vertically aligned arrows retain their geometry', () => {
  const source = { x: 225, y: 0, width: 150, height: 60 };
  assert.deepEqual(caseAssignmentPlaqueCurve(source, { x: -200, y: 80, width: 300, height: 200 }, 173), {
    source: { x: 300, y: 68 }, target: { x: 112, y: 173, side: 'right' },
    control1: { x: 300, y: 120.5 }, control2: { x: 188, y: 173 }
  });
  assert.deepEqual(caseAssignmentPlaqueCurve(source, { x: 200, y: 200, width: 300, height: 200 }, 293), {
    source: { x: 300, y: 68 }, target: { x: 300, y: 188, side: 'vertical' },
    control1: { x: 332, y: 128 }, control2: { x: 300, y: 128 }
  });
});
