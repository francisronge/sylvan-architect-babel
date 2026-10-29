import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { assessRendererPerformance, describeRendererPreparation } from '../scripts/rendererPerformanceBudget.mjs';
import { observeRendererOpening } from '../scripts/rendererPerformanceObservation.mjs';

test('renderer budget fails a sustained slowdown and accepts improvements', () => {
  const base = [1800, 1802, 1798, 1801, 1800, 1799, 1803];
  assert.equal(assessRendererPerformance(base, [2040, 2050, 2045, 2055, 2048, 2052, 2043]).status, 'regression');
  assert.equal(assessRendererPerformance(base, [1500, 1510, 1490, 1505, 1495, 1502, 1498]).status, 'passed');
});

test('a delay after first paint appears in preparation without changing the opening measurement', () => {
  const observe = completionDelay => {
    let clock = 0, nextFrame;
    class Worker {
      addEventListener(type, callback) { if (type === 'message') this.message = callback; }
      terminate() {}
    }
    const svg = { dataset: { babelRenderedStep: '0' }, querySelector: selector => selector === ':scope > g'
      ? { getAttribute: () => 'translate(0,0) scale(1)' } : { textContent: 'Mara' } };
    const context = { window: { Worker }, document: { fonts: { status: 'loaded' }, querySelector: () => svg },
      performance: { now: () => clock }, Map, requestAnimationFrame: callback => { nextFrame = callback; } };
    vm.runInNewContext(`(${observeRendererOpening.toString()})()`, context);
    const worker = new context.window.Worker();
    clock = 100; nextFrame();
    clock = 116; nextFrame();
    clock = 200 + completionDelay;
    worker.message({ data: { result: { coordinates: new Map([[0, new Map([[0, new Map([['node', { x: 1, y: 2 }]])]])]]) } } });
    worker.terminate();
    const state = context.window.__rendererBenchmark;
    assert.equal(state.complete.points, 1);
    assert.equal(state.complete.invalid, 0);
    assert.equal(state.workers[0].terminated, true);
    return { readyMs: state.readyMs, completeMs: state.complete.at };
  };
  const baseline = observe(0), delayed = observe(750);
  assert.equal(baseline.readyMs, 116);
  assert.equal(delayed.readyMs, baseline.readyMs);
  assert.equal(delayed.completeMs - baseline.completeMs, 750);
  const before = Array.from({ length: 7 }, () => baseline), after = Array.from({ length: 7 }, () => delayed);
  assert.equal(assessRendererPerformance(before.map(item => item.readyMs), after.map(item => item.readyMs)).status, 'passed');
  const report = describeRendererPreparation(before, after);
  assert.equal(report.complete.medianIncreaseMs, 750);
  assert.equal(report.remainingAfterFirstPaint.medianIncreaseMs, 750);
  assert.deepEqual(report.complete.pairedDeltasMs, [750, 750, 750, 750, 750, 750, 750]);
  assert.equal(report.blockingBudget, null, 'uncalibrated completion reports cannot introduce a new blocking threshold');
});

test('ordinary jitter and one modest outlier do not create a false regression', () => {
  assert.equal(assessRendererPerformance([1800, 1810, 1790, 1820, 1805, 1795, 1815], [1840, 1810, 1800, 1850, 2100, 1830, 1820]).status, 'passed');
  assert.equal(assessRendererPerformance([400, 410, 390, 405, 400, 395, 402], [480, 485, 479, 481, 480, 478, 483]).status, 'passed');
});

test('a slow phase in three of seven rounds does not move the median past the budget', () => {
  // CI run 39526110050 (first attempt): a server-only change whose candidate hit the
  // runner's slow phase in three of five rounds and failed as a regression.
  const base = [2806, 2799, 2859, 2811, 2847, 2820, 2830];
  assert.equal(assessRendererPerformance(base, [3320, 3227, 2807, 3180, 2855, 2840, 2826]).status, 'passed');
  assert.equal(assessRendererPerformance(base, [3320, 3227, 3190, 3180, 3210, 2840, 2826]).status, 'regression');
});

test('unstable measurements cannot produce a passing check', () => {
  assert.equal(assessRendererPerformance([900, 1800, 1810, 1850, 2300, 1820, 1830], [1700, 1700, 1700, 1700, 1700, 1700, 1700]).status, 'unstable');
  // Two stray samples on one side, slow or fast, remain unstable.
  const base = [1638, 1668, 1665, 1771, 1929, 1765, 1757];
  assert.equal(assessRendererPerformance(base, [1656, 1701, 1710, 1736, 1949, 2220, 2210]).status, 'unstable');
  assert.equal(assessRendererPerformance(base, [1250, 1701, 1710, 1736, 1749, 1260, 1696]).status, 'unstable');
  assert.equal(assessRendererPerformance([1250, 1668, 1665, 1771, 1729, 2220, 1757], base).status, 'unstable');
});

test('one stray sample cannot make equal medians unstable, and is still judged by the median', () => {
  // CI run 40803967830 (first attempt): equal medians, and one slow candidate
  // round stretched max - min to 33% of the median.
  const base = [1638, 1668, 1665, 1771, 1929, 1765, 1757];
  assert.equal(assessRendererPerformance(base, [1656, 1701, 1710, 1736, 1949, 2220, 1696]).status, 'passed');
  assert.equal(assessRendererPerformance(base, [1300, 1701, 1710, 1736, 1749, 1720, 1696]).status, 'passed');
  // A stray sample does not hide a regression the other six show.
  assert.equal(assessRendererPerformance(base, [1300, 2001, 2010, 2036, 2049, 2020, 1996]).status, 'regression');
});

test('missing, zero, infinite and NaN samples fail closed', () => {
  const valid = [1000, 1000, 1000, 1000, 1000, 1000, 1000];
  for (const invalid of [[], [1000], [0, ...valid.slice(1)], [NaN, ...valid.slice(1)], [Infinity, ...valid.slice(1)]]) {
    assert.throws(() => assessRendererPerformance(valid, invalid));
  }
});
