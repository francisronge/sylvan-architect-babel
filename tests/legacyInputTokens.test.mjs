import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverLegacyInputTokens } from '../services/legacyInputTokens.ts';

const leaf = (id, word, extra = {}) => ({ id, label: 'X', word, ...extra });
const analysis = (words, extra = {}) => ({
  finalForest: [{ id: 'root', label: 'XP', children: words.map((word, index) => leaf(`w${index}`, word)) }],
  derivationStages: [{ statement: '', stageRecord: '', relations: [], workspaceForest: [] }], ...extra
});

test('a record without saved tokens recovers them from its own words, spelled as in the sentence', () => {
  assert.deepEqual(recoverLegacyInputTokens(analysis(['which', 'book', 'did', 'John', 'buy']), 'Which book did John buy?'),
    ['Which', 'book', 'did', 'John', 'buy']);
  assert.deepEqual(recoverLegacyInputTokens(analysis(['太郎', 'は', '読ん', 'だ']), '太郎は読んだ。'), ['太郎', 'は', '読ん', 'だ']);
  assert.deepEqual(recoverLegacyInputTokens(analysis(['John', "'s", 'book']), "John's book"), ['John', "'s", 'book']);
});

test('records whose words cannot be recovered keep the legacy fallback', () => {
  assert.equal(recoverLegacyInputTokens(analysis(['colour']), 'color'), undefined);
  assert.equal(recoverLegacyInputTokens(analysis(['b', 'a']), 'a b'), undefined, 'words must appear in order');
  const grouped = analysis(['太郎']);
  grouped.derivationStages[0].realizations = [{ nodeIds: ['w0'], tokenIndices: [0, 1] }];
  assert.equal(recoverLegacyInputTokens(grouped, '太郎'), undefined, 'realization groups need the original token list');
  assert.equal(recoverLegacyInputTokens(null, 'text'), undefined);
  assert.equal(recoverLegacyInputTokens(analysis([]), 'text'), undefined);
});
