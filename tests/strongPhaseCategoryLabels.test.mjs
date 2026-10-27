import assert from 'node:assert/strict';
import test from 'node:test';

import { readCategoryLabel } from '../replay/categoryLabel.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';

test('a starred strong-phase category reads as its category', () => {
  for (const [label, kind, head] of [['v*', 'head', 'v'], ['v*P', 'phrase', 'v'], ["v*'", 'bar', 'v'], ['v*′', 'bar', 'v'], ['v*+T', 'head', 'v'], ['v*[transitive]', 'head', 'v']]) {
    assert.equal(readCategoryLabel(label)?.kind, kind, label);
    assert.equal(readCategoryLabel(label)?.head, head, label);
  }
  for (const label of ['*', '*V', 'v**', 'v*P*']) assert.equal(readCategoryLabel(label), undefined, label);
});

// Opus n4-13 (French long relative, opus-final-20261027, stages 1, 6 and 8):
// lexical verbs raise into v* and the v* complex raises to T. With v* unread as
// a category, none of the three head movements drew a path.
test('a verb raising into a newly merged v* is head movement', () => {
  const leaf = (id, label, extra = {}) => ({ id, label, children: [], ...extra });
  const op = leaf('op', 'Op', { silent: true, lineageId: 'op' });
  const prior = [{ id: 'vp', label: 'VP', children: [leaf('lu', 'V', { word: 'lu', lineageId: 'lu' }), op] }];
  const current = [{ id: 'vstarP', label: 'v*P', children: [
    { id: 'vcx', label: 'v*', children: [leaf('lu', 'V', { word: 'lu', lineageId: 'lu' }), leaf('vstar', 'v*', { silent: true })] },
    { id: 'vp', label: 'VP', children: [leaf('luT', 'V', { silent: true, lineageId: 'lu' }), structuredClone(op)] }] }];
  const relation = { relation: 'head-movement', anchors: { mover: 'lu', trace: 'luT', host: 'vstar' } };
  const { movement, failure } = recoverMovementEvidence(relation, current, prior);
  assert.equal(failure, undefined);
  assert.deepEqual([movement?.sourceNodeId, movement?.targetNodeId, movement?.trajectoryKind], ['luT', 'lu', 'head']);
});
