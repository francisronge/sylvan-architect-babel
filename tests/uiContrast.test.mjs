import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { contrast } from './helpers/contrast.mjs';
import { UI_CONTRAST_PAIRS } from './helpers/uiContrastPairs.mjs';

test('contrast math matches WCAG reference values', () => {
  assert.equal(contrast('white', ['black']).toFixed(2), '21.00');
  assert.equal(contrast('#777777', ['#ffffff']).toFixed(2), '4.48');
  // Translucent text is composited over its background first.
  assert.equal(contrast('white/50', ['black']).toFixed(2), contrast('rgb(127.5,127.5,127.5)', ['black']).toFixed(2));
});

for (const pair of UI_CONTRAST_PAIRS) {
  test(`WCAG AA contrast: ${pair.where}`, () => {
    assert(readFileSync(new URL(`../${pair.file}`, import.meta.url), 'utf8').includes(pair.snippet),
      `${pair.file} no longer contains "${pair.snippet}"; update tests/helpers/uiContrastPairs.mjs to the new color and measure it`);
    const ratio = contrast(pair.fg, pair.bg, pair.opacity ?? 1);
    assert(ratio >= pair.min, `${pair.fg} measures ${ratio.toFixed(2)}:1, below ${pair.min}:1`);
  });
}
