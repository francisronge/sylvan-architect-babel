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

test('wrapping reuse is isolated by font state and returned line arrays cannot corrupt later views', () => {
  const text = 'V[perfect, third-person feminine singular]';
  let probes = 0;
  const measure = value => { probes++; return [...value].length * 20; };
  const first = categoryTextLayout(text, measure), measured = probes;
  const expected = structuredClone(first);
  first.lines[0] = 'changed by caller'; first.width = -1;
  assert.deepEqual(categoryTextLayout(text, measure), expected);
  assert.equal(probes, measured, 'same immutable font state needs no repeated wrapping probes');
  let newProbes = 0;
  const wider = categoryTextLayout(text, value => { newProbes++; return [...value].length * 30; });
  assert.ok(newProbes > 0);
  assert.equal(wider.lines.join(''), text);
  assert.notDeepEqual(wider.lines, expected.lines);
});
