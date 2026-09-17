import assert from 'node:assert/strict';
import test from 'node:test';
import { identityLightSites } from '../components/identityForestLight.ts';

test('identity light follows actual terminal text and wordless witnesses through camera transforms', () => {
  let zoom = 1;
  const label = (id, kind, x, y, width = 40) => ({
    kind,
    getAttribute: name => name === (kind === 'terminal' ? 'data-node-id' : 'data-category-node-id') ? id : null,
    getBoundingClientRect: () => ({ left: 20 + x * zoom, top: 30 + y * zoom, width: width * zoom, height: 20 * zoom })
  });
  const labels = [label('the', 'terminal', 0, 100), label('parcel', 'terminal', 100, 200),
    label('trace', 'category', 300, 80), label('the', 'category', 0, 0), label('hidden', 'terminal', 0, 0, 0)];
  const svg = { querySelectorAll: selector => labels.filter(l => selector.startsWith(`.${l.kind === 'terminal' ? 'terminal' : 'category'}-label`)) };
  const pools = [['the', 'parcel', 'the'], ['trace'], ['unavailable', 'hidden']];
  assert.deepEqual(identityLightSites(svg, { left: 20, top: 30 }, pools), [
    [{ x: 20, y: 110 }, { x: 120, y: 210 }], [{ x: 320, y: 90 }], []
  ]);
  zoom = 2;
  assert.deepEqual(identityLightSites(svg, { left: 20, top: 30 }, pools), [
    [{ x: 40, y: 220 }, { x: 240, y: 420 }], [{ x: 640, y: 180 }], []
  ]);
});
