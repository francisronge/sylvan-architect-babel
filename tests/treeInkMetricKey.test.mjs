import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryTextLayout } from '../replay/categoryTextLayout.ts';
import { treeInkMetricKey } from '../replay/treeInkMetricKey.ts';
import { collectTreeInkMeasurements } from '../replay/treeInkGeometry.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';

const measureCategoryText = text => [...text].length * 45;
const measureTreeInk = (text, style) => ({ width: [...text].length * 20,
  left: -2, right: [...text].length * 20 + 2,
  ascent: style.startsWith('category') ? 32 : 40,
  descent: style.endsWith('index') ? 32 : 12,
  fontAscent: 44, fontDescent: 16 });
const forest = () => {
  const canvas = { id: 'workspace', label: '', replayOrigin: { kind: 'workspace' }, children: [
    { id: 'left', label: 'AAA BBB CCC', word: 'word' },
    { id: 'right', label: 'T (past, finite, agreement)', word: 'traces₁' }
  ] };
  const steps = [{ replayFrameIndex: 0, replayStageStepIndex: 0, replayKind: 'macro', operation: 'Stage',
    replayCanvasData: canvas, replayVisibleNodeIds: ['left', 'right'] }];
  return { canvas, steps };
};
const textKey = (text, style) => JSON.stringify([text, style]);

for (const direction of ['ltr', 'rtl']) test(`${direction}: equal painted ink reuses geometry after collecting all worker probes`, () => {
  const { canvas, steps } = forest(), saved = JSON.stringify(steps), size = [500, 500];
  const plan = (measureInk, measureWidth = measureCategoryText) => buildStageCoordinateReservations(
    steps, 0, size, () => size, direction, measureWidth, measureInk).get(canvas);
  const painted = plan(measureTreeInk), widths = new Map(), glyphs = new Map();
  const collectWidths = text => { const width = measureCategoryText(text); widths.set(text, width); return width; };
  const collectGlyphs = (text, style) => {
    const metrics = measureTreeInk(text, style); glyphs.set(textKey(text, style), metrics); return metrics;
  };
  assert.equal(plan(collectGlyphs, collectWidths), painted, 'matching metric values share the reserved maps');
  const requiredWidth = text => { assert(widths.has(text), `missing category probe ${text}`); return widths.get(text); };
  const requiredGlyph = (text, style) => {
    assert(glyphs.has(textKey(text, style)), `missing glyph probe ${textKey(text, style)}`);
    return glyphs.get(textKey(text, style));
  };
  for (const node of [canvas, ...canvas.children]) {
    assert.deepEqual(collectTreeInkMeasurements(node.label, node.word, requiredWidth, requiredGlyph),
      collectTreeInkMeasurements(node.label, node.word, measureCategoryText, measureTreeInk));
  }
  assert.equal(new Set([...glyphs.keys()].map(key => JSON.parse(key)[1])).size, 4, 'both glyph and index styles reach the worker');
  assert.notEqual(plan((text, style) => ({ ...measureTreeInk(text, style), left: -22 })), painted,
    'equal text advances with different glyph edges must invalidate the planner');
  assert.notEqual(plan((text, style) => ({ ...measureTreeInk(text, style), fontAscent: 100 })), painted,
    'terminal vertical font metrics must invalidate the planner');
  assert.notEqual(plan((text, style) => ({ ...measureTreeInk(text, style), descent: style.endsWith('index') ? 100 : 12 })), painted,
    'shifted index ink must invalidate the planner');
  assert.equal(JSON.stringify(steps), saved);
});

test('ink memoization includes category wrapping and immutable callback identity', () => {
  const { steps, canvas } = forest(), calls = [];
  const measure = (text, style) => { calls.push(textKey(text, style)); return measureTreeInk(text, style); };
  const first = treeInkMetricKey(steps, measureCategoryText, measure), count = calls.length;
  assert.equal(treeInkMetricKey(steps, measureCategoryText, measure), first);
  assert.equal(calls.length, count, 'the same font state does not repeat collection');
  const narrow = text => [...text].length * 5;
  const second = treeInkMetricKey(steps, narrow, measure);
  assert.notEqual(second, first);
  for (const node of canvas.children) for (const line of categoryTextLayout(node.label, narrow).lines) {
    assert(calls.slice(count).includes(textKey(line, 'category')), `new wrapping must collect ${line}`);
  }
  assert.notEqual(treeInkMetricKey([{ replayCanvasData: { label: 'new label', word: 'another' } }], narrow, measure), second);
});

test('missing optional metrics preserve the conservative fallback and stay distinct from absent measurement', () => {
  const { steps } = forest();
  const fallback = treeInkMetricKey(steps, measureCategoryText);
  const unknown = treeInkMetricKey(steps, measureCategoryText, () => undefined);
  assert.notEqual(unknown, fallback, 'a supplied collector must still run its fallback probes');
  assert.equal(unknown, treeInkMetricKey(steps, measureCategoryText, () => undefined));
});
