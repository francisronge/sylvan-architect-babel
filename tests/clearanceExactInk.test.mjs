import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds } from '../replay/displayIdentity.ts';
import { collisionAreas, minimumClearanceShift } from '../replay/workspaceComponentLifetime.ts';
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
