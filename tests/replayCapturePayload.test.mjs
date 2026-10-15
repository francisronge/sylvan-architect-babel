import assert from 'node:assert/strict';
import test from 'node:test';
import { assertReplayCapturePayload } from '../scripts/replayCapturePayload.mjs';

const payload = () => ({ operation: 'Project', replayVisibleNodeIds: ['n'],
  replayCanvasData: { id: 'n', label: 'N', word: 'Mia' } });

test('capture validates exact payloads without modifying their evidence', () => {
  const input = payload(), original = structuredClone(input);
  assert.doesNotThrow(() => assertReplayCapturePayload(input, 0));
  assert.deepEqual(input, original);
  for (const corrupt of [
    p => { p.replayVisibleNodeIds.push('n'); },
    p => { p.replayVisibleNodeIds = ['missing']; },
    p => { p.replayCanvasData.replayLayoutOnly = true; },
    p => { p.replayCanvasData = { id: 'root', children: [p.replayCanvasData, { id: 'n', label: 'N' }] }; }
  ]) {
    const bad = payload(); corrupt(bad); const before = structuredClone(bad);
    assert.throws(() => assertReplayCapturePayload(bad, 3), /Frame 4:/);
    assert.deepEqual(bad, before, 'invalid data is retained rather than repaired by the verifier');
  }
});
