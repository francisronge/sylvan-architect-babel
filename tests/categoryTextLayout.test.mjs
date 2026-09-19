import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryTextLayout } from '../replay/categoryTextLayout.ts';
import { authoredDeterminerHasNominalComplement, isPhrasalReplayMovement } from '../replay/replayCompiler.ts';

test('long categories wrap to measured width without losing text or changing short notation', () => {
  const measure = s => [...s].length * 20;
  for (const text of ['V[past, third-person feminine singular]', 'D[proper name, third-person feminine singular]', '日本語のとても長いラベルをここに書きます'.repeat(2), 'N[e\u0301e\u0301e\u0301]'.repeat(8)]) {
    const layout = categoryTextLayout(text, measure);
    assert.equal(layout.lines.join(''), text);
    assert(layout.lines.every(line => measure(line) <= 380));
    assert(layout.lines.every(line => !/^\p{M}/u.test(line)), 'never split a combining sequence');
    assert(layout.lines.length > 1);
  }
  assert.deepEqual(categoryTextLayout('V′', measure).lines, ['V′']);
  const unevenMeasure = s => [...s].reduce((n, c) => n + (c === 'W' ? 50 : 5), 0);
  const uneven = categoryTextLayout('x WWWWWWWWWWWWWWWW', unevenMeasure);
  assert.equal(uneven.lines.join(''), 'x WWWWWWWWWWWWWWWW');
  assert(uneven.lines.every(line => unevenMeasure(line) <= 380));
});

test('a selected determiner retains its authored nominal context before its projection exists', () => {
  const forest = [{ id: 'phrase', label: 'D', children: [
    { id: 'determiner', label: 'D[negative]', word: 'No' }, { id: 'noun', label: 'N', word: 'student' }
  ] }];
  const selected = { id: 'selected', label: 'No', word: 'No', replayOrigin: { kind: 'lexical', authoredId: 'determiner' } };
  const projected = { id: 'terminal', label: 'No', word: 'No', replayOrigin: { kind: 'word', ownerId: 'determiner' } };
  assert.equal(authoredDeterminerHasNominalComplement(forest, selected), true);
  assert.equal(authoredDeterminerHasNominalComplement(forest, projected), true);
  assert.equal(authoredDeterminerHasNominalComplement([{ id: 'determiner', label: 'D', word: 'Mia' }], selected), false);
});


test('casing follows resolved phrasal movement regardless of the authored operation name', () => {
  for (const operation of ['subject Internal Merge', 'A previously unseen description']) {
    assert.equal(isPhrasalReplayMovement({ operation, trajectoryKind: 'phrasal' }), true);
    assert.equal(isPhrasalReplayMovement({ operation, trajectoryKind: 'head' }), false);
    assert.equal(isPhrasalReplayMovement({ operation }), false);
  }
});
