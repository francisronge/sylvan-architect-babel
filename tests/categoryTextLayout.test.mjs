import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryTextLayout } from '../replay/categoryTextLayout.ts';
import { measureCategoryText } from './helpers/visualFontMetrics.mjs';
import { checkLabelTypography } from './helpers/visualRules.mjs';
import { authoredDeterminerHasNominalComplement } from '../replay/replayCasing.ts';
import { isPhrasalReplayMovement } from '../replay/movementLinks.ts';

// The lines spell the text in order; a break consumes only whitespace.
const assertSpells = (lines, text) => {
  let rest = text;
  lines.forEach((line, index) => {
    if (index > 0) rest = rest.trimStart();
    assert(rest.startsWith(line), `${JSON.stringify(lines)} does not spell ${JSON.stringify(text)}`);
    rest = rest.slice(line.length);
  });
  assert.equal(rest, '');
};

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

test('a closing mark hangs past the width instead of starting a line, and a word breaks before its bracket', () => {
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const measure = s => [...graphemes.segment(s)].length * 22;
  const lines = text => categoryTextLayout(text, measure).lines;
  // When only the closing mark overflows, it hangs by its own width.
  assert.deepEqual(lines('Coord[alternative]'), ['Coord[alternative]']);
  assert.equal(categoryTextLayout('Coord[alternative]', measure).width, 396);
  assert.deepEqual(lines('ChangeOfStateHead\u2032'), ['ChangeOfStateHead\u2032']);
  const comma = lines('Asp\u2070+Pred+v+V[PST, 3SG]');
  assert.equal(comma.length, 2);
  assert.equal(comma[0], 'Asp\u2070+Pred+v+V[PST,');
  // A space break needs no hanging mark.
  assert.deepEqual(lines('V [raised, finite]'), ['V [raised, ', 'finite]']);
  // A word that overflows breaks before a bracket group that fits on its own line.
  assert.deepEqual(lines('Neg[interrogatives]'), ['Neg', '[interrogatives]']);
  assert.deepEqual(lines('ChangeOfStateParticleHead'), ['ChangeOfStatePart', 'icleHead']);
  // A bracket group too wide for a line of its own keeps the existing grapheme break.
  assert.deepEqual(lines('C[interrogativeness]'), ['C[interrogativene', 'ss]']);
  // Space and comma breaks keep their existing positions.
  assert.deepEqual(lines('C[alternative question]'), ['C[alternative ', 'question]']);
  assert.deepEqual(lines('V[past, third-person feminine singular]'), ['V[past, ', 'third-person ', 'feminine ', 'singular]']);
  const accented = 'e\u0301'.repeat(17) + '\u2032';
  assert.deepEqual(lines(accented), [accented]);
  // Rather than split the word and leave a remnant, the group moves down whole
  // and its closing mark hangs.
  assert.deepEqual(lines(`X[${'e\u0301'.repeat(16)}]`), ['X', `[${'e\u0301'.repeat(16)}]`]);
});

test('a straight double quote after text closes it, so it hangs instead of starting a line', () => {
  const measure = text => [...text].length * 22;
  // Seventeen graphemes fill the 380-unit line; the eighteenth overflows.
  assert.deepEqual(categoryTextLayout('"abcdefghijklmnop"', measure).lines, ['"abcdefghijklmnop"']);
  assert.deepEqual(categoryTextLayout('abcdefghijklmnopq"', measure).lines, ['abcdefghijklmnopq"']);
  // After a space it opens, and its quotation may start the next line.
  assert.deepEqual(categoryTextLayout('abcdefghijklmnopq "x"', measure).lines, ['abcdefghijklmnopq', '"x"']);
  assert.deepEqual(categoryTextLayout('abc "defghijklmnopq"', measure).lines, ['abc ', '"defghijklmnopq"']);
});

test('a hyphenated word breaks after its hyphen rather than inside either word', () => {
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const measure = s => [...graphemes.segment(s)].length * 22;
  const lines = text => categoryTextLayout(text, measure).lines;
  assert.deepEqual(lines('T[personal-infinitive]'), ['T[personal-', 'infinitive]']);
  assert.deepEqual(lines('T[personal\u2010infinitive]'), ['T[personal\u2010', 'infinitive]']);
  assert.deepEqual(lines('V[unaccusative, personal-infinitive]'), ['V[unaccusative, ', 'personal-', 'infinitive]']);
  assert.deepEqual(lines('T[persone\u0301-infinitive]'), ['T[persone\u0301-', 'infinitive]']);
  // A later hyphen wins over an earlier bracket break.
  assert.deepEqual(lines('Asp[non-progressive]'), ['Asp[non-', 'progressive]']);
  // Both words stay whole although the hyphen break adds a line.
  assert.deepEqual(lines('T[finite, indirect-evidential, agreement]'), ['T[finite, ', 'indirect-', 'evidential, ', 'agreement]']);
  // A hyphenated word followed by the overflowing space is already a whole word.
  assert.equal(lines('Experiencer-voice head')[0], 'Experiencer-voice');
  // A minus feature value is not a word-joining hyphen, so it never ends a line on its own.
  assert.deepEqual(lines('Neg[-interrogatives]'), ['Neg', '[-interrogatives]']);
});

test('saved labels end lines between words and never leave a remnant line', () => {
  const lines = text => categoryTextLayout(text, measureCategoryText).lines;
  const findings = wrapped => checkLabelTypography({ texts: [{ id: 'label', kind: 'category', lines: wrapped, boxes: [] }] });
  // These saved labels were split inside a word or left at most two graphemes on their last line.
  for (const [text, expected] of [
    ['D\u2070 [relative, class 7]', ['D\u2070 [relative, ', 'class 7]']],
    ['DP [relative, class 7]', ['DP [relative, ', 'class 7]']],
    ['T: perfect/completive', ['T: perfect/', 'completive']],
    ['Num\u2070 [cardinal\u2013classifier]', ['Num\u2070 [cardinal\u2013', 'classifier]']],
    ['Asp[perfect/completive]', ['Asp[perfect/', 'completive]']],
    ['Appl[recipient/beneficiary]', ['Appl[recipient/', 'beneficiary]']],
    ['T [anterior/perfective, adnominal]', ['T [anterior/', 'perfective, ', 'adnominal]']],
    ['v: external-argument constituent', ['v: external-', 'argument ', 'constituent']]
  ]) {
    assert.deepEqual(lines(text), expected, text);
    assert.deepEqual(findings(expected), [], text);
  }
});

test('a word that fits on a line stays whole even when that adds a line', () => {
  const lines = text => categoryTextLayout(text, measureCategoryText).lines;
  const findings = wrapped => checkLabelTypography({ texts: [{ id: 'label', kind: 'category', lines: wrapped, boxes: [] }] });
  // Each saved label split a word, because keeping it whole needs one more line.
  for (const [text, expected] of [
    ['V[gerund-participle, transitive]', ['V[gerund-', 'participle, ', 'transitive]']],
    ['V[gerund-participle, absolute]', ['V[gerund-', 'participle, ', 'absolute]']],
    ['Mod[circumstantial possibility]', ['Mod', '[circumstantial ', 'possibility]']],
    ['NP[supplementary CP adjunction]', ['NP', '[supplementary ', 'CP adjunction]']],
    ['v[transitive, external-argument-introducing]', ['v[transitive, ', 'external-', 'argument-', 'introducing]']],
    ['v [transitive; external-argument introducer]', ['v [transitive; ', 'external-', 'argument ', 'introducer]']]
  ]) {
    assert.deepEqual(lines(text), expected, text);
    assert.deepEqual(findings(expected), [], text);
  }
  // Only a word wider than a line on its own splits, and it adds no line for that.
  assert.deepEqual(lines('ChangeOfStateParticleHead'), ['ChangeOfStatePa', 'rticleHead']);
  assert.deepEqual(lines('Mod[circumstantialpossibility]'), ['Mod[circumstanti', 'alpossibility]']);
});

test('no line is blank: spaces that would fill a line alone are the break between its neighbours', () => {
  const inked = (text, measure) => {
    const { lines } = categoryTextLayout(text, measure);
    assertSpells(lines, text);
    assert(lines.every(line => line.trim()), `${JSON.stringify(lines)} has a blank line`);
    return lines;
  };
  // Each of these left a line holding only a space.
  assert.deepEqual(inked('Mod[circumstantial interpretation]'), ['Mod', '[circumstantial', 'interpretation]']);
  assert.deepEqual(inked('Mod[circumstantial interpretations]'), ['Mod', '[circumstantial ', 'interpretations]']);
  assert.deepEqual(inked('C [declarative, topic-compatible]'), ['C [declarative, ', 'topic-', 'compatible]']);
  assert.deepEqual(inked('C[interrogativeness, uninterpretability]', measureCategoryText),
    ['C', '[interrogativeness,', 'uninterpretability]']);
  // Spaces at either end of a label stay on the line next to them.
  assert.deepEqual(inked('interrogatives  '), ['interrogatives  ']);
  assert.deepEqual(inked('  interrogatives'), ['  interrogatives']);
});

test('no wrapped line starts with the space that overflowed the line before', () => {
  const lines = text => {
    const wrapped = categoryTextLayout(text, measureCategoryText);
    assert(wrapped.lines.every((line, index) => index === 0 || !/^\s/u.test(line)), `${JSON.stringify(wrapped.lines)} starts a line with a space`);
    assertSpells(wrapped.lines, text);
    assert.equal(wrapped.width, Math.max(...wrapped.lines.map(measureCategoryText)));
    return wrapped.lines;
  };
  // Saved labels whose later line began with the space after a comma or a word.
  assert.deepEqual(lines('I\u2070[+finite, present, nominative]'), ['I\u2070[+finite, present,', 'nominative]']);
  assert.deepEqual(lines('Neg[interpretable negation]'), ['Neg[interpretable', 'negation]']);
  assert.deepEqual(lines('AgrO, abstract object-agreement head'), ['AgrO, abstract ', 'object-agreement', 'head']);
  assert.deepEqual(lines('I\u2070 [finite, nonpast, progressive, agreement 3SG]'),
    ['I\u2070 [finite, nonpast,', 'progressive, ', 'agreement 3SG]']);
  // The whole run of spaces is the break, not only the one that overflowed.
  assert.deepEqual(lines('Neg[interpretable  negation]'), ['Neg[interpretable', 'negation]']);
});

test('joining blank lines takes no measurements beyond the lines it paints', () => {
  let probes = 0;
  const measure = text => { probes++; return measureCategoryText(text); };
  assert.deepEqual(categoryTextLayout('T[uninterpretable, perfect/completive]', measure).lines,
    ['T[uninterpretable,', 'perfect/', 'completive]']);
  assert.equal(probes, 50);
});

test('a slash or dash break replaces a split word, even when it adds a line', () => {
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const measure = s => [...graphemes.segment(s)].length * 22;
  const lines = text => categoryTextLayout(text, measure).lines;
  assert.deepEqual(lines('Asp[perfective/imperfective]'), ['Asp[perfective/', 'imperfective]']);
  assert.deepEqual(lines('Num[cardinal\u2014classifier]'), ['Num[cardinal\u2014', 'classifier]']);
  assert.deepEqual(lines('T[finite/nonfinite, agreement]'), ['T[finite/', 'nonfinite, ', 'agreement]']);
  assert.deepEqual(lines('Num[cardinal\u2014classifier, plural]'), ['Num[cardinal\u2014', 'classifier, ', 'plural]']);
  // A later break after the slash fills the first line instead of leaving the head symbol alone.
  assert.deepEqual(lines('T: perfect/completive'), ['T: perfect/', 'completive']);
  // A line never ends on a slash that does not join two words.
  assert.deepEqual(lines('Neg[/interrogativeness]'), ['Neg[/interrogativ', 'eness]']);
  // Clean wrappings keep their established breaks.
  assert.deepEqual(lines('V[past, third-person feminine singular]'), ['V[past, ', 'third-person ', 'feminine ', 'singular]']);
});

test('a label that would need more than four lines widens them, up to twice the width, instead of pushing its sisters down a row', () => {
  const lines = text => categoryTextLayout(text, measureCategoryText).lines;
  // Both saved labels took five lines at the normal width, which lowered their sisters' row.
  assert.deepEqual(lines('T[finite; evidential-anterior; agreement:3sg; subject-edge]'),
    ['T[finite; ', 'evidential-anterior; ', 'agreement:3sg; ', 'subject-edge]']);
  assert.deepEqual(lines('I\u2070 [finite, perfective/past, third-person masculine singular]'),
    ['I\u2070 [finite, ', 'perfective/past, ', 'third-person ', 'masculine singular]']);
  // Four lines at the normal width stay as they are.
  assert.deepEqual(lines('v[transitive, external-argument-introducing]'), ['v[transitive, ', 'external-', 'argument-', 'introducing]']);
  // A wider wrapping is taken only if it splits no more words than the normal one.
  assert.deepEqual(lines('Fin(antipassivization\u00b7causative\u00b7irrealis\u00b7+definite\u00b7agreement:3sg\u27e9'),
    ['Fin', '(antipassivization\u00b7caus', 'ative\u00b7irrealis\u00b7+definite\u00b7', 'agreement:3sg\u27e9']);
  // A label that needs more than four lines even at twice the width keeps its
  // normal wrapping, without measuring widths four lines could never fill.
  let probes = 0;
  const measure = s => { probes++; return [...s].length * 20; };
  const long = `V[${Array.from({ length: 24 }, (_, index) => `feature${index}`).join(', ')}]`;
  const kept = categoryTextLayout(long, measure);
  assertSpells(kept.lines, long);
  assert(kept.lines.length > 4);
  assert(kept.lines.every(line => measure(line.trimEnd()) <= 380));
  assert(probes < 400, `${probes} measurements`);
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
  assertSpells(wider.lines, text);
  assert.notDeepEqual(wider.lines, expected.lines);
});
