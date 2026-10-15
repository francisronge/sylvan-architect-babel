import assert from 'node:assert/strict';
import test from 'node:test';
import { BROWSER_SPECS, requiredTestSummary, selectBrowserSpecs } from '../scripts/browserSuites.mjs';

test('browser ownership keeps the existing fast gate and complete coverage distinct', () => {
  const actual = BROWSER_SPECS.map(spec => spec.file);
  assert.deepEqual(selectBrowserSpecs(actual, 'renderer').map(spec => spec.file), [
    'movementEndpointAttachment.test.mjs', 'trajectoryLabelClearance.test.mjs',
    'featureComposition.test.mjs', 'plaqueClearance.test.mjs', 'operatorBindingComposition.test.mjs'
  ]);
  assert.deepEqual(selectBrowserSpecs(actual, 'compatibility').map(spec => spec.file), ['reviewCompatibility.test.mjs']);
  assert.equal(selectBrowserSpecs(actual).length, actual.length);
  assert.throws(() => selectBrowserSpecs([...actual, 'new-unowned.test.mjs']), /unowned: new-unowned/);
  assert.throws(() => selectBrowserSpecs(actual.slice(1)), /Missing: movementEndpointAttachment/);
  assert.throws(() => selectBrowserSpecs(actual, 'unknown'), /Unknown browser suite/);
});

test('required browser coverage cannot pass with skipped, todo or unfinished tests', () => {
  const result = '# tests 6\n# pass 6\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  assert.deepEqual(requiredTestSummary(result), { tests: 6, pass: 6, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  assert.throws(() => requiredTestSummary(result.replace('# pass 6', '# pass 5').replace('# skipped 0', '# skipped 1')), /did not execute/);
  assert.throws(() => requiredTestSummary(result.replace('# pass 6', '# pass 5').replace('# todo 0', '# todo 1')), /did not execute/);
  assert.throws(() => requiredTestSummary(result.replace('# pass 6', '# pass 5').replace('# cancelled 0', '# cancelled 1')), /did not execute/);
  assert.throws(() => requiredTestSummary(result.replace('# pass 6\n', '')), /completed test denominator/);
  assert.throws(() => requiredTestSummary(result.replace('# tests 6', '# tests 7')), /completed test denominator/);
  assert.throws(() => requiredTestSummary('TAP version 13\n'), /completed test denominator/);
});
