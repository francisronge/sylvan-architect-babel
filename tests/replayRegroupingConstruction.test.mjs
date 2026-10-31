import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkStableConstruction, frameStructure } from './helpers/replayInvariants.mjs';

const leaf = (id, label, word) => ({ id, label, word, children: [] });
const node = (id, label, ...children) => ({ id, label, children });
const stage = (statement, ...forest) => ({ statement, stageRecord: statement, relations: [], workspaceForest: forest });
const built = node('vp', 'VP', leaf('see', 'V', 'see'), node('old', "N'", leaf('cats', 'N', 'cats')));
const replayOf = (sentence, final) => {
  const record = { sentence, framework: 'xbar', inputTokens: sentence.split(' '),
    derivationStages: [stage('Build the VP.', built), stage('Change the VP.', final)] };
  const replay = prepareReplay({ ...record, includePlayback: true });
  return { replay, steps: replay.playbackSteps.filter(step => step.replayFrameIndex === 1) };
};

// No construction step builds a new child of the VP, so none completes the
// regrouping: construction keeps the dissolved N′ and the stage's completion
// shows the completed stage.
test('a parent that takes a dissolved child\'s material directly shows its completed stage at the Stage Record', () => {
  const { replay, steps } = replayOf('will see cats',
    node('tp', 'TP', leaf('will', 'T', 'will'), node('vp', 'VP', leaf('see', 'V', 'see'), leaf('cats', 'N', 'cats'))));
  const record = steps.at(-1), { children } = frameStructure(record);
  assert.equal(record.operation, 'StageRecord');
  assert.deepEqual(children.get('vp'), ['see', 'cats']);
  assert.equal(children.has('old'), false, 'the dissolved N\u2032 is gone');
  for (const step of steps.slice(0, -1)) assert.deepEqual(frameStructure(step).children.get('vp'), ['see', 'old'],
    `construction keeps the N\u2032 at ${step.operation} ${step.targetNodeId}`);
  assert.deepEqual(checkStableConstruction(replay), []);
});

test('new syntax inside a regrouping parent\'s new child is built at its own steps', () => {
  const { replay, steps } = replayOf('see cats here',
    node('vp', 'VP', leaf('see', 'V', 'see'), node('np', 'NP', leaf('cats', 'N', 'cats'), leaf('here', 'A', 'here'))));
  const micro = steps.filter(step => step.replayKind === 'micro');
  assert.deepEqual(micro.map(step => [step.operation, step.targetNodeId]),
    [['LexicalSelect', 'here'], ['ExternalMerge', 'np']]);
  const [select] = micro.map(frameStructure);
  assert.ok(select.children.get(null).includes('here'), 'the new word stands with its category as its own workspace');
  assert.deepEqual(select.children.get('here'), ['here::__leaf']);
  assert.deepEqual(select.children.get('vp'), ['see', 'old'], 'the old N′ stays until the NP is built');
  assert.deepEqual(frameStructure(micro[1]).children.get('vp'), ['see', 'np']);
  assert.deepEqual(checkStableConstruction(replay), []);
});
