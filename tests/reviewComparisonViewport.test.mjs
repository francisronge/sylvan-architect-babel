import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonImageFits } from '../scripts/reviewComparisonPage.mjs';

test('comparison evidence rejects a decoded but overflowing or offscreen capture', () => {
  const healthy = { decoded: true, viewport: { x: 0, y: 0, width: 1063, height: 898 },
    figure: { x: 0, y: 48, width: 1063, height: 850 }, image: { x: 0, y: 48, width: 1063, height: 850 } };
  assert.equal(comparisonImageFits(healthy), true);
  assert.equal(comparisonImageFits({ ...healthy, image: { ...healthy.image, height: 2300.4375 } }), false);
  assert.equal(comparisonImageFits({ ...healthy, image: { ...healthy.image, y: 900 } }), false);
  assert.equal(comparisonImageFits({ ...healthy, decoded: false }), false);
});
