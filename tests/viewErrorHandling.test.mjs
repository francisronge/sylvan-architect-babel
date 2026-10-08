import assert from 'node:assert/strict';
import test from 'node:test';
import { describeViewError, guardViewCallback, rethrowViewError } from '../components/viewErrorHandling.ts';

test('owned callback guards preserve arguments, receiver and successful return values', () => {
  const receiver = { base: 3 };
  const guarded = guardViewCallback(function (extra) { return this.base + extra; }, () => assert.fail('Unexpected failure'));
  assert.equal(guarded.call(receiver, 4), 7);
});

test('a failed scheduled draw reports its original error and stops that draw', () => {
  const error = new Error('Failed SVG measurement');
  const events = [];
  const draw = guardViewCallback(() => {
    events.push('start');
    throw error;
  }, failure => events.push(failure));
  assert.equal(draw(), undefined);
  assert.deepEqual(events, ['start', error]);
});

test('callbacks without an owning boundary do not swallow errors', () => {
  const error = new Error('Unowned callback');
  const draw = guardViewCallback(() => { throw error; }, rethrowViewError);
  assert.throws(draw, failure => failure === error);
});

test('an error while reporting is not converted into apparent success', () => {
  const reportingFailure = new Error('No boundary');
  const draw = guardViewCallback(() => { throw new Error('Draw failed'); }, () => { throw reportingFailure; });
  assert.throws(draw, failure => failure === reportingFailure);
});

test('error details describe Error and string throws without trusting object coercion', () => {
  assert.equal(describeViewError(new Error('Missing node')), 'Missing node');
  assert.equal(describeViewError('Worker did not return'), 'Worker did not return');
  assert.equal(describeViewError({ toString() { throw new Error('Unsafe coercion'); } }), 'Unexpected rendering error.');
  assert.equal(describeViewError(null), 'Unexpected rendering error.');
});
