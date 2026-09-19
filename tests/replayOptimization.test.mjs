import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPreFrontingSentenceInitialCasing,
  hasDeterminerNominalComplement,
  maybeLowercaseSentenceInitialFunctionSurface,
  __TEST_ONLY__
} from '../replay/replayCompiler.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';

const counts = (tree, ids) => __TEST_ONLY__.collectVisibleReplayOvertTokenCounts({
  replayCanvasData: tree, replayVisibleNodeIds: ids
});
const leaf = (id, word = 'the') => ({ id, label: word, word });
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

test('casing preserves inherited silence, future layout hiding and exact target ownership', () => {
  const tree = { id: 'root', label: 'CP', children: [
    { id: 'future-copy', label: 'P', replayLayoutOnly: true, children: [{ ...leaf('future-word', 'To'), replayLayoutOnly: true }] },
    { id: 'future', label: 'P', replayOrigin: { kind: 'layout' }, children: [leaf('f', 'To')] },
    { id: 'lower', label: 'P', silent: true, children: [leaf('l', 'To')] },
    { id: 'higher', label: 'P', children: [leaf('h', 'to')] }
  ] };
  const input = freeze([{ operation: 'Select', targetNodeId: 'higher', targetLabel: 'to', replayCanvasData: tree }]);
  const [result] = applyPreFrontingSentenceInitialCasing(input, 'To town');
  assert.deepEqual(result.replayCanvasData.children.map(n => n.children[0].word), ['To', 'To', 'to', 'To']);
  assert.equal(result.targetLabel, 'To');
  assert.equal(tree.children[2].children[0].word, 'To');
  assert.equal(tree.children[3].children[0].word, 'to');
});

test('visible token counts deduplicate overlapping subtrees and preserve unnamed-leaf multiplicity', () => {
  const tree = { id: 'root', label: 'XP', children: [{ id: 'p', label: 'DP', children: [
    { ...leaf('ada', 'Ada'), aliasIds: ['alias'] }, leaf('ben', 'Ben'), leaf('', 'word')
  ] }] };
  assert.deepEqual([...counts(tree, ['root', 'p', 'ada', 'alias', 'ben'])], [['ada', 1], ['ben', 1], ['word', 2]]);
  assert.deepEqual([...counts(tree, ['p', 'ben'])], [['ben', 1], ['word', 1]]);
});

test('feature annotations do not disable position-sensitive casing or change authored labels', () => {
  for (const label of ['D', 'D[+wh]', 'D [wh] [case:acc]']) {
    const tree = { id: 'root', label: 'VP', children: [
      { id: 'verb', label: 'V', children: [leaf('v', 'buy')] },
      { id: 'object', label: 'DP', children: [
        { id: 'det', label, children: [leaf('d', 'Which')] },
        { id: 'noun', label: 'N', children: [leaf('n', 'book')] }
      ] }
    ] };
    const input = freeze([{ operation: 'Select', targetNodeId: 'd', targetLabel: 'Which', replayCanvasData: tree }]);
    const [result] = applyPreFrontingSentenceInitialCasing(input, 'Which book');
    assert.equal(result.replayCanvasData.children[1].children[0].children[0].word, 'which');
    assert.equal(result.replayCanvasData.children[1].children[0].label, label);
    assert.equal(tree.children[1].children[0].children[0].word, 'Which');
  }
});

test('a standalone nominal preserves authored capitals before and after movement, even with tokenIndex zero', () => {
  for (const word of ['Mia', 'I', 'Which']) {
    for (const tokenIndex of [undefined, 0]) {
      const nominal = { id: 'nominal', label: 'D[person:3]', children: [{ ...leaf('name', word), tokenIndex }] };
      const verb = { id: 'verb', label: 'V', children: [leaf('v', 'seems')] };
      const input = freeze([
        { operation: 'Select', targetNodeId: 'name', targetLabel: word, sourceLabels: [word],
          replayCanvasData: { id: 'root', label: 'VP', children: [verb, nominal] } },
        { operation: 'Move', targetNodeId: 'name', targetLabel: word,
          replayCanvasData: { id: 'root', label: 'TP', children: [nominal, verb] } }
      ]);
      const result = applyPreFrontingSentenceInitialCasing(input, `${word} seems ...`);
      assert.equal(result[0].replayCanvasData.children[1].children[0].word, word);
      assert.equal(result[0].targetLabel, word);
      assert.deepEqual(result[0].sourceLabels, [word]);
      assert.equal(result[1].replayCanvasData.children[0].children[0].word, word);
      assert.equal(maybeLowercaseSentenceInitialFunctionSurface({
        surface: word, sentenceInitialSurface: word, parentLabel: nominal.label,
        visibleOvertLeafIds: ['v', 'name'], nodeId: 'name'
      }), word, 'the renderer uses the same lexical-casing rule');
    }
  }
});

test('a determiner with a nominal complement still loses sentence casing before fronting in either notation', () => {
  for (const label of ['D', 'DP', "D'"]) {
    const determiner = { id: 'd', label: 'D[wh]', children: [leaf('w', 'Which')] };
    const phrase = { id: 'p', label, children: [determiner, { id: 'n', label: 'NP', children: [leaf('book', 'book')] }] };
    assert.equal(hasDeterminerNominalComplement(determiner, phrase), true);
    const [before, after] = applyPreFrontingSentenceInitialCasing([
      { replayCanvasData: { id: 'root', label: 'V', children: [leaf('buy', 'buy'), phrase] } },
      { replayCanvasData: { id: 'root', label: 'CP', children: [phrase, leaf('buy', 'buy')] } }
    ], 'Which book');
    assert.equal(before.replayCanvasData.children[1].children[0].children[0].word, 'which');
    assert.equal(after.replayCanvasData.children[0].children[0].children[0].word, 'Which');
  }
});

test('visible token lookup preserves first-preorder ID and alias matches', () => {
  const tree = { id: 'root', children: [
    { ...leaf('first', 'Ada'), aliasIds: ['second'] }, leaf('second', 'Ben')
  ] };
  assert.deepEqual([...counts(tree, ['second'])], []);
  assert.deepEqual([...counts(tree, ['root', 'first', 'second'])], [['ada', 1], ['ben', 1]]);
});

test('visible token accounting does bounded lookup work across a deep tree', () => {
  let reads = 0, tree;
  const ids = [];
  const node = (id, extra) => {
    ids.push(id);
    return { ...extra, get id() { reads++; return id; } };
  };
  for (let i = 0; i < 80; i++) {
    const word = node(`w${i}`, { label: 'word', word: 'word' });
    tree = tree ? node(`p${i}`, { label: 'XP', children: [tree, word] }) : word;
  }
  const result = counts(tree, ids);
  assert.equal(result.get('word'), 80);
  assert.ok(reads < ids.length * 8, `${reads} ID reads for ${ids.length} nodes`);
});

test('interpreted relations are reused only within their own preparation', () => {
  const tree = { id: 'n', label: 'N', word: 'word' };
  const stages = [0, 1, 2].map(i => ({
    statement: `Stage ${i}`, stageRecord: 'Test record.', workspaceForest: [tree],
    relations: [{ relation: 'Context', anchors: { participant: 'n' }, values: { note: 'original' } }]
  }));
  const input = { derivationStages: stages, sentence: 'word', includePlayback: true };
  const first = prepareReplay(input);
  stages[0].relations[0].values.note = 'changed';
  const saved = JSON.stringify(first);
  const second = prepareReplay(input);
  assert.notDeepEqual(first.playbackSteps, second.playbackSteps);
  assert.equal(JSON.stringify(first), saved, 'a later preparation cannot mutate the earlier result');
  assert.ok(second.committedDerivationVisualLinks.some(link => link.values?.note === 'changed'));
});
