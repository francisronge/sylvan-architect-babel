import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedStringTransform } from '../replay/boundedStringTransform.ts';
import { normalizeTier2Synonym } from '../replay/relations/tier2Synonyms.ts';

test('string cache keeps exact keys and empty results, with bounded retention', () => {
  const calls = [];
  const normalize = boundedStringTransform(value => { calls.push(value); return value.trim(); }, 2);
  assert.equal(normalize(' '), '');
  assert.equal(normalize(' '), '');
  assert.equal(normalize(' a '), 'a');
  assert.deepEqual(calls, [' ', ' a ']);
  assert.equal(normalize('a'), 'a', 'different input strings remain distinct cache keys');
  assert.equal(normalize('a'), 'a');
  assert.equal(normalize(' '), '', 'eviction changes work, never the result');
  assert.deepEqual(calls, [' ', ' a ', 'a', ' '], 'exceeding capacity releases earlier entries');
  for (const capacity of [0, -1, 1.5, Infinity])
    assert.throws(() => boundedStringTransform(value => value, capacity), RangeError);
});

test('synonym memoization preserves Unicode normalization and each input coercion', () => {
  const cases = new Map([
    ['  ＣａｓｅAssignment  ', 'case assignment'], ['HTTPServer_ID', 'http server id'],
    ['nominal-genitive_licensing', 'nominal genitive licensing'], ['  ΦValue\tAGREE  ', 'φ value agree'],
    ['', ''], [null, ''], [undefined, ''], [12, '12']
  ]);
  for (let pass = 0; pass < 2; pass++) for (const [input, expected] of cases)
    assert.equal(normalizeTier2Synonym(input), expected);
  let coercions = 0;
  const value = { toString: () => (++coercions === 1 ? 'CaseAssignment' : 'PhiAgree') };
  assert.equal(normalizeTier2Synonym(value), 'case assignment');
  assert.equal(normalizeTier2Synonym(value), 'phi agree');
  for (let i = 0; i < 2050; i++) normalizeTier2Synonym(`authoredRole${i}`);
  for (const [input, expected] of cases) assert.equal(normalizeTier2Synonym(input), expected);
});


test('oversized string keys and results do not occupy cache capacity', () => {
  let calls = 0;
  const oversized = 'X'.repeat(4097);
  const transform = boundedStringTransform(value => { calls++; return value === 'expand' ? oversized : value; }, 1);
  assert.equal(transform('kept'), 'kept');
  for (let pass = 0; pass < 2; pass++) {
    assert.equal(transform(oversized), oversized);
    assert.equal(transform('expand'), oversized);
    assert.equal(transform('kept'), 'kept');
  }
  assert.equal(calls, 5, 'oversized results are recalculated while the small entry remains cached');
  assert.equal(normalizeTier2Synonym(oversized), oversized.toLowerCase());
});
