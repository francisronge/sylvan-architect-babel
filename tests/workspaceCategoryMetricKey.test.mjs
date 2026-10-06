import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryTextLayout } from '../replay/categoryTextLayout.ts';
import { categoryMetricKey } from '../replay/categoryMetricKey.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';

const forest = () => {
  const canvas = { id: 'workspace', label: '', replayOrigin: { kind: 'workspace' }, children: [
    { id: 'left', label: 'AAA BBB CCC' }, { id: 'right', label: 'T (past, finite, agreement)' }
  ] };
  return { canvas, steps: [{ replayFrameIndex: 0, replayStageStepIndex: 0,
    replayKind: 'macro', operation: 'Stage', replayCanvasData: canvas,
    replayVisibleNodeIds: ['left', 'right'] }] };
};

for (const direction of ['ltr', 'rtl']) test(`${direction}: equal category metrics reuse geometry after filling a fresh collector`, () => {
  const { canvas, steps } = forest(), saved = JSON.stringify(steps), size = [500, 500];
  const measured = text => [...text].length * 45;
  const plan = measure => buildStageCoordinateReservations(steps, 0, size, () => size, direction, measure).get(canvas);
  const painted = plan(measured);
  const collected = new Map();
  const collector = text => { const width = measured(text); collected.set(text, width); return width; };
  const prepared = plan(collector);
  assert.equal(prepared, painted, 'equivalent callbacks must reuse the same reserved coordinates');
  for (const label of ['', ...canvas.children.map(node => node.label)]) {
    const layout = categoryTextLayout(label, text => {
      assert(collected.has(text), `missing worker probe ${text}`);
      return collected.get(text);
    });
    for (const line of layout.lines) assert.equal(collected.get(line), measured(line));
  }
  const changedLine = text => text === 'CCC' ? 1 : measured(text);
  assert.deepEqual(categoryTextLayout('AAA BBB CCC', changedLine), categoryTextLayout('AAA BBB CCC', measured));
  assert.notEqual(categoryMetricKey(steps, changedLine), categoryMetricKey(steps, measured),
    'a narrower wrapped line changes collision ink even when the enclosing layout matches');
  assert.notEqual(plan(changedLine), prepared, 'different line ink invalidates the cached planner');
  const changedWrap = text => [...text].length * 10;
  assert.notDeepEqual(plan(changedWrap), prepared, 'changed wrapping recalculates clearance');
  assert.equal(JSON.stringify(steps), saved);
});

test('category metric enumeration is local to immutable steps and callback identity', () => {
  const { steps } = forest();
  let calls = 0;
  const measured = text => { calls++; return text.length * 25; };
  const first = categoryMetricKey(steps, measured), count = calls;
  assert.equal(categoryMetricKey(steps, measured), first);
  assert.equal(calls, count, 'the same font callback does not repeat enumeration');
  assert.equal(categoryMetricKey(steps), first, 'an exactly matching fallback has the same geometry key');
  const other = [{ replayCanvasData: { label: 'different' } }];
  assert.notEqual(categoryMetricKey(other, measured), first);
  assert(calls > count, 'the same callback still measures a new playback vocabulary');
});

test('category metric keys preserve signed zero rather than lossy JSON number conversion', () => {
  const steps = [{ replayCanvasData: { label: '' } }];
  assert.notEqual(categoryMetricKey(steps, () => -0), categoryMetricKey(steps, () => 0));
});
