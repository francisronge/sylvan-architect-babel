import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { adaptDerivationStagesForReplay } from '../replay/authoredFrames.ts';
import { buildPlaybackStepsFromDerivationFrames } from '../replay/replayCompiler.ts';
import { buildReplayWorkspace } from '../replay/replayWorkspace.ts';
import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';

const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word ? { word } : {}), ...extra });
const canvas = {
  id: 'root', label: 'TP', children: [
    { id: 'dp', label: 'DP', children: [leaf('d', 'D', 'the', { tokenIndex: 0 }), leaf('n', 'N', 'cat', { tokenIndex: 1 })] },
    { id: 'vp', label: 'VP', children: [leaf('v', 'V', 'slept', { tokenIndex: 2 }), leaf('pro', 'D', 'PRO', { silent: true })] }
  ]
};
const step = (visible, extra = {}) => ({ operation: 'LexicalSelect', replayKind: 'micro', replayCanvasData: canvas, replayVisibleNodeIds: visible, ...extra });
const tokens = ['The', 'cat', 'slept', '.'];

test('the workspace lists the visible syntax objects; hidden parents pass their visible children up', () => {
  const workspace = buildReplayWorkspace(step(['dp', 'd', 'n', 'v'], { targetNodeId: 'v' }), tokens);
  assert.deepEqual(workspace.objects.map(object => object.id), ['dp', 'v']);
  assert.deepEqual(workspace.objects[0].children.map(child => child.id), ['d', 'n']);
  assert.equal(workspace.currentIndex, 1, 'the object holding the step target is current');
  assert.deepEqual(workspace.lexicalArray, [], 'every word is in the workspace; punctuation never counts');
});

test('the lexical array is the sentence words no visible pronounced terminal accounts for, in sentence order', () => {
  assert.deepEqual(buildReplayWorkspace(step(['n']), tokens).lexicalArray, ['The', 'slept']);
  assert.deepEqual(buildReplayWorkspace(step(['pro', 'n']), tokens).lexicalArray, ['The', 'slept'], 'a silent terminal selects no word');
  const realized = buildReplayWorkspace(step(['n'], { replayRealizations: [{ nodeIds: ['n'], tokenIndices: [0, 1] }] }), tokens);
  assert.deepEqual(realized.lexicalArray, ['slept'], 'a word realized by a group counts once the group shows');
});

test('only construction steps with a visible workspace get one; terminals without positions select by their word', () => {
  assert.equal(buildReplayWorkspace(step(['n'], { replayKind: 'relation' }), tokens), null);
  assert.equal(buildReplayWorkspace(step(['n'], { replayKind: 'macro' }), tokens), null);
  assert.equal(buildReplayWorkspace(step([]), tokens), null);
  assert.equal(buildReplayWorkspace(null, tokens), null);
  const unpositioned = { id: 'r', label: 'X', children: [{ id: 'x', label: 'D', word: 'the' }, { id: 'y', label: 'N', word: 'cat' }, { id: 'z', label: 'D', word: 'the' }] };
  assert.deepEqual(buildReplayWorkspace(step(['x'], { replayCanvasData: unpositioned }), tokens).lexicalArray, ['cat', 'slept'],
    'matching ignores case');
  assert.deepEqual(buildReplayWorkspace(step(['x', 'z'], { replayCanvasData: unpositioned }), ['the', 'cat', 'saw', 'the', 'dog']).lexicalArray,
    ['cat', 'saw', 'dog'], 'a repeated word is used once per terminal');
});

test('a saved analysis: the lexical array only shrinks as Replay builds, and the finished tree uses every word', () => {
  const [record] = JSON.parse(readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url), 'utf8'));
  const stages = record.derivationStages;
  const words = [];
  const collect = node => { if (Number.isInteger(node.tokenIndex) && !node.silent) words[node.tokenIndex] = node.word; (node.children ?? []).forEach(collect); };
  stages.at(-1).workspaceForest.forEach(collect);
  const steps = buildPlaybackStepsFromDerivationFrames({ frames: adaptDerivationStagesForReplay(stages), replayPlan: buildDerivationReplayPlan({ derivationStages: stages }) });
  const arrays = steps.map(current => buildReplayWorkspace(current, words)).filter(Boolean).map(workspace => workspace.lexicalArray);
  assert(arrays.length > 5);
  assert.equal(arrays[0].length, words.length - 1, 'the first step selects one word');
  arrays.slice(1).forEach((array, index) => assert(array.every(word => arrays[index].includes(word)), `step ${index + 2} adds nothing back`));
  // The last construction step can precede a movement that pronounces a word (here T-to-C "did").
  assert.deepEqual(buildReplayWorkspace({ ...steps.at(-1), replayKind: 'micro' }, words).lexicalArray, []);
});

test('a terminal its realization group accounts for is not matched by text a second time', () => {
  const sentenceCanvas = { id: 'r', label: 'X', children: [
    { id: 'd', label: 'D', word: 'The' }, { id: 'n', label: 'N', word: 'cat' }, { id: 'v', label: 'V', word: 'chased' }
  ] };
  const workspace = buildReplayWorkspace(step(['n'], { replayCanvasData: sentenceCanvas, replayRealizations: [{ nodeIds: ['n'], tokenIndices: [1] }] }),
    ['The', 'cat', 'chased', 'the', 'cat']);
  assert.deepEqual(workspace.lexicalArray, ['The', 'chased', 'the', 'cat'], 'only the realized cat is selected');
});

test('words beneath a silent phrase are silent: they select nothing and are drawn dimmed', () => {
  const silentCanvas = { id: 'r', label: 'X', children: [
    { id: 'gap', label: 'DP', silent: true, children: [{ id: 'gapN', label: 'N', word: 'cat' }] },
    { id: 'n', label: 'N', word: 'cat' }
  ] };
  const workspace = buildReplayWorkspace(step(['gap', 'gapN', 'n'], { replayCanvasData: silentCanvas }), ['cat', 'chased', 'cat']);
  assert.deepEqual(workspace.lexicalArray, ['chased', 'cat'], 'only the pronounced cat is selected');
  assert.equal(workspace.objects[0].children[0].silent, true, 'the silent phrase marks its word silent for drawing');
  const hiddenParent = buildReplayWorkspace(step(['gapN', 'n'], { replayCanvasData: silentCanvas }), ['cat', 'chased', 'cat']);
  assert.deepEqual(hiddenParent.lexicalArray, ['chased', 'cat'], 'silence passes down through a phrase not yet drawn');
});

test("a word Replay draws under its category takes the category's token position", () => {
  const drawn = { id: 'r', label: 'X', children: [{ id: 'd2', label: 'D', tokenIndex: 3, children: [{ id: 'd2::word', label: 'the', word: 'the' }] }] };
  assert.deepEqual(buildReplayWorkspace(step(['d2', 'd2::word'], { replayCanvasData: drawn }), ['the', 'cat', 'chased', 'the', 'dog']).lexicalArray,
    ['the', 'cat', 'chased', 'dog'], 'the second the is selected, not the first');
});

test("the step's own realization groups name its drawn nodes, after Replay renames occurrences", () => {
  const renamed = { id: 'r', label: 'X', children: [{ id: 'later', label: 'V', word: 'go' }] };
  const workspace = buildReplayWorkspace(step(['later'], { replayCanvasData: renamed, replayRealizations: [{ nodeIds: ['later'], tokenIndices: [1] }] }), ['They', 'went']);
  assert.deepEqual(workspace.lexicalArray, ['They'], 'went is realized by the renamed occurrence');
});

test('every word inside a phrase a realization group names is accounted for by the group', () => {
  const phrase = { id: 'r', label: 'X', children: [{ id: 'np', label: 'NP', children: [{ id: 'n', label: 'N', children: [{ id: 'n::word', label: 'cat', word: 'cat' }] }] }] };
  const groups = [{ nodeIds: ['np'], tokenIndices: [0] }];
  assert.deepEqual(buildReplayWorkspace(step(['np', 'n', 'n::word'], { replayCanvasData: phrase, replayRealizations: groups }), ['cats', 'saw', 'cat']).lexicalArray,
    ['saw', 'cat'], 'the group selects cats; the final cat stays');
  assert.deepEqual(buildReplayWorkspace(step(['n', 'n::word'], { replayCanvasData: phrase, replayRealizations: groups }), ['cats', 'saw', 'cat']).lexicalArray,
    ['saw', 'cat'], 'also while the named phrase itself is not yet drawn');
});

test('text matching compares words as the parser does, ignoring edge punctuation', () => {
  const punctuated = { id: 'r', label: 'X', children: [{ id: 'n', label: 'N', word: 'cat.' }] };
  assert.deepEqual(buildReplayWorkspace(step(['n'], { replayCanvasData: punctuated }), ['the', 'cat']).lexicalArray, ['the']);
});

test('a symbol word stays in the lexical array until selected; punctuation never appears', () => {
  const symbolCanvas = { id: 'r', label: 'X', children: [{ id: 'v', label: 'V', word: 'go' }] };
  assert.deepEqual(buildReplayWorkspace(step(['v'], { replayCanvasData: symbolCanvas }), ['go', '🙂', '!']).lexicalArray, ['🙂']);
});
