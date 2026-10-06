import assert from 'node:assert/strict';
import test from 'node:test';
import { assessRendererPerformance } from '../scripts/rendererPerformanceBudget.mjs';

test('renderer budget fails a sustained slowdown and accepts improvements', () => {
  const base = [1800, 1802, 1798, 1801, 1800];
  assert.equal(assessRendererPerformance(base, [2040, 2050, 2045, 2055, 2048]).status, 'regression');
  assert.equal(assessRendererPerformance(base, [1500, 1510, 1490, 1505, 1495]).status, 'passed');
});

test('ordinary jitter and one modest outlier do not create a false regression', () => {
  assert.equal(assessRendererPerformance([1800, 1810, 1790, 1820, 1805], [1840, 1810, 1800, 1850, 2100]).status, 'passed');
  assert.equal(assessRendererPerformance([400, 410, 390, 405, 400], [480, 485, 479, 481, 480]).status, 'passed');
});

test('unstable measurements cannot produce a passing check', () => {
  assert.equal(assessRendererPerformance([900, 1800, 1810, 1850, 2300], [1700, 1700, 1700, 1700, 1700]).status, 'unstable');
});

test('missing, zero, infinite and NaN samples fail closed', () => {
  const valid = [1000, 1000, 1000, 1000, 1000];
  for (const invalid of [[], [1000], [0, ...valid.slice(1)], [NaN, ...valid.slice(1)], [Infinity, ...valid.slice(1)]]) {
    assert.throws(() => assessRendererPerformance(valid, invalid));
  }
});
