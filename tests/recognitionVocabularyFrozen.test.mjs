import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  directoryVocabulary,
  regexAlternatives,
  sourceVocabulary,
  vocabularyGrowth
} from './helpers/recognitionVocabulary.mjs';

const relations = fileURLToPath(new URL('../replay/relations/', import.meta.url));
const frozen = JSON.parse(readFileSync(new URL('./helpers/recognitionVocabulary.frozen.json', import.meta.url), 'utf8'));
const synonymsSource = readFileSync(new URL('../replay/relations/tier2Synonyms.ts', import.meta.url), 'utf8');
const counts = (fileName, source) => ({
  [fileName]: sourceVocabulary(fileName, source).reduce((all, { kind, text }) => {
    all[`${kind}: ${text}`] = (all[`${kind}: ${text}`] ?? 0) + 1;
    return all;
  }, {})
});

test('the Tier-2 recognition word list does not gain entries', () => {
  const growth = vocabularyGrowth(frozen.files, directoryVocabulary(relations));
  assert.deepEqual(growth, [], 'the word list is frozen; recognise from structure instead. New entries in '
    + 'replay/relations/:\n' + growth.map(({ file, entry, count, allowed }) =>
      `  ${file}  ${entry}  (${count} found, ${allowed} frozen)`).join('\n')
    + '\nRemoving an entry is allowed. An entry moved between files keeps the total, so move its line in '
    + 'tests/helpers/recognitionVocabulary.frozen.json with it.');
});

test('the frozen inventory covers synonym groups, Sets, regex alternatives and name checks', () => {
  const entries = file => Object.keys(frozen.files[file] ?? {});
  assert(entries('tier2Synonyms.ts').includes('list: landing site'));
  assert(entries('tier2Synonyms.ts').includes('regex: landings'));
  assert(entries('movementEvidence.ts').includes('list: landings'));
  assert(entries('tier2RelationDispatch.ts').includes('comparison: coordinate gapping'));
  assert(entries('thematicAssignment.ts').includes('comparison: experiencer interpretation'));
  assert(entries('thematicAssignment.ts').includes('comparison: recipient interpretation and dative licensing'));
  assert(entries('thematicAssignment.ts').includes('regex: passive agent'));
  assert(entries('explicitCoreference.ts').includes('comparison: interrogative binding'));
  assert(entries('qualifiedAgreement.ts').includes('comparison: raised finite features'));
  assert(entries('qualifiedAgreement.ts').includes('list: participle'));
});

test('the freeze rejects the landings alternative that #111 added and accepts removals', () => {
  const beforeAddition = synonymsSource.replace('|targets|landings|goals|', '|targets|goals|');
  assert.notEqual(beforeAddition, synonymsSource);
  const growth = vocabularyGrowth(counts('tier2Synonyms.ts', beforeAddition), counts('tier2Synonyms.ts', synonymsSource));
  assert.deepEqual(growth, [{ file: 'tier2Synonyms.ts', entry: 'regex: landings', count: 1, allowed: 0 }]);
  assert.deepEqual(vocabularyGrowth(counts('tier2Synonyms.ts', synonymsSource), counts('tier2Synonyms.ts', beforeAddition)), []);
});

test('a new alias, Set member, regex alternative or name check is growth', () => {
  const base = `const g = [group('role', 'probe', ['probe', 'searcher'])];
const names = new Set(['controller']);
const known = (name: string) => /^(?:agree|concord)$/u.test(name) || normalizeTier2Synonym(name) === 'case licensing';`;
  for (const [changed, entry] of [
    [base.replace("'searcher'", "'searcher', 'seeker'"), 'list: seeker'],
    [base.replace("'controller'", "'controller', 'controllers'"), 'list: controllers'],
    [base.replace('agree|concord', 'agree|concord|accord'), 'regex: accord'],
    [base.replace("=== 'case licensing'", "=== 'case licensing' || name === 'dative licensing'"), 'comparison: dative licensing'],
    [base.replace("'searcher'", "'searcher', 'probe'"), 'list: probe']
  ]) {
    const growth = vocabularyGrowth(counts('fixture.ts', base), counts('fixture.ts', changed));
    assert.deepEqual(growth.map(item => item.entry), [entry]);
  }
});

test('internal ids and notation are not vocabulary', () => {
  const entries = sourceVocabulary('fixture.ts', `const ids = ['movement.source', 'fallback-mark', 'priorAnchors', 'Movement curve', 'x'];
const kind = (item: { kind: string }) => item.kind === 'trajectory';`).map(item => item.text);
  assert.deepEqual(entries, []);
  assert.deepEqual(regexAlternatives(String.raw`^(?:(?:matrix|embedded) )?thematic interpretation\b[–—]?\p{L}+$`),
    ['matrix', 'embedded', 'thematic interpretation']);
});
