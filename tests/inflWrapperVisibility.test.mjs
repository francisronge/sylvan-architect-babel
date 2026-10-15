import assert from 'node:assert/strict';
import test from 'node:test';
import { hidePendingInflSpecifierWrappersInStep } from '../replay/playbackVisibility.ts';

test('a complete authored unary parent stays visible at its construction step', () => {
  for (const label of ['TP', 'T', 'IP', 'Infl', 'XP']) {
    const step = { replayKind: 'micro', operation: 'Project', targetNodeId: 'parent', sourceNodeIds: ['child'],
      replayVisibleNodeIds: ['parent', 'child'], replayCanvasData: {
        id: 'parent', label, children: [{ id: 'child', label }]
      } };
    const original = structuredClone(step);
    assert.equal(hidePendingInflSpecifierWrappersInStep(step), step, label);
    assert.deepEqual(step, original);
  }
});

test('a future first daughter still withholds its inflection wrapper until that daughter is current', () => {
  const step = { replayKind: 'micro', operation: 'ExternalMerge', targetNodeId: 'parent',
    replayVisibleNodeIds: ['parent', 'spine'], replayCanvasData: {
      id: 'parent', label: 'TP', children: [
        { id: 'future', label: 'DP', replayLayoutOnly: true }, { id: 'spine', label: 'TP' }
      ]
    } };
  const original = structuredClone(step);
  const pending = hidePendingInflSpecifierWrappersInStep(step);
  assert.deepEqual(pending.replayVisibleNodeIds, ['spine']);
  assert.equal(pending.replayCanvasData.replayLayoutOnly, true);
  assert.deepEqual(step, original);
  const complete = { ...step, replayVisibleNodeIds: ['parent', 'future', 'spine'], replayCanvasData: {
    ...step.replayCanvasData, children: [{ id: 'future', label: 'DP' }, { id: 'spine', label: 'TP' }]
  } };
  assert.equal(hidePendingInflSpecifierWrappersInStep(complete), complete);
});
