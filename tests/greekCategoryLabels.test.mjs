import assert from 'node:assert/strict';
import test from 'node:test';

import { readCategoryLabel } from '../replay/categoryLabel.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';

test('Greek category symbols read as category notation, other scripts stay words', () => {
  for (const [label, kind, head] of [['Σ', 'head', 'Σ'], ['ΣP', 'phrase', 'Σ'], ['Σ′', 'bar', 'Σ'], ['Σ⁰', 'head', 'Σ'], ['Σ+C', 'head', 'Σ']]) {
    assert.equal(readCategoryLabel(label)?.kind, kind, label);
    assert.equal(readCategoryLabel(label)?.head, head, label);
  }
  for (const label of ['洗', 'mú', 'Σ phrase of negation']) assert.equal(readCategoryLabel(label), undefined, label);
});

// Opus n4-35 (Basque long ergative, claude-final-review opus-parts, stage 9):
// the polarity complex Σ raises to C. With Σ unread as a category, the moved
// complex had no head reading and the claim drew no path.
test('a Σ complex raising to C is head movement', () => {
  const leaf = (id, label, extra = {}) => ({ id, label, children: [], ...extra });
  const sigma = (id, silent) => silent ? leaf(id, 'Σ', { lineageId: 'sigma', silent: true })
    : { id, label: 'Σ', lineageId: 'sigma', children: [leaf('neg', 'Σ', { word: 'ez' }), leaf('aux', 'T', { word: 'du', lineageId: 'tense' })] };
  const tense = { id: 'tp', label: 'T', children: [leaf('v', 'V', { word: 'irakurri' }), leaf('aux2', 'T', { silent: true, lineageId: 'tense' })] };
  const prior = [{ id: 'c1', label: 'C', children: [leaf('c', 'C', { word: 'ela' }), { id: 'sigP', label: 'Σ', children: [sigma('sig'), tense] }] }];
  const current = [{ id: 'c1', label: 'C', children: [{ id: 'cx', label: 'C', children: [sigma('sig'), leaf('c', 'C', { word: 'ela' })] },
    { id: 'sigP', label: 'Σ', children: [sigma('sigT', true), structuredClone(tense)] }] }];
  const relation = { relation: 'head-movement', anchors: { mover: 'sig', lowerCopy: 'sigT', host: 'c', complex: 'cx' } };
  const { movement, failure } = recoverMovementEvidence(relation, current, prior);
  assert.equal(failure, undefined);
  assert.deepEqual([movement?.sourceNodeId, movement?.targetNodeId, movement?.trajectoryKind], ['sigT', 'sig', 'head']);
});
