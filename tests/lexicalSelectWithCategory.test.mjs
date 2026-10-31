import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { formatPlaybackOperationTitle } from '../replay/replayPanelFormatting.ts';

// One authored lexical node {label, word} is one lexical item: Replay selects
// it with its category in one step. Only authored one-child nodes above it
// (N′, NP) project.
const noun = { id: 'n', label: 'N', word: 'teachers', children: [] };
const subject = () => ({ id: 'dp', label: 'DP', children: [{ id: 'd', label: 'D', silent: true, children: [] },
  { id: 'np', label: 'NP', children: [{ id: 'nbar', label: 'N′', children: [structuredClone(noun)] }] }] });
const verb = () => ({ id: 'v', label: 'V', word: 'sleep', children: [] });
const stage = (statement, workspaceForest) => ({ statement, stageRecord: statement, relations: [], workspaceForest });
const replay = prepareReplay({
  sentence: 'teachers sleep',
  includePlayback: true,
  derivationStages: [
    stage('Build the subject.', [subject()]),
    stage('Select the verb.', [subject(), verb()]),
    stage('Merge the clause.', [{ id: 's', label: 'S', children: [subject(), verb()] }])
  ]
});
const steps = replay.playbackSteps.filter(step => step.replayKind === 'micro');
const shown = (step, id) => step.replayVisibleNodeIds.includes(id);

test('a pronounced lexical item appears once, with its word and category together', () => {
  for (const [id, word, category] of [['n', 'teachers', 'N'], ['v', 'sleep', 'V']]) {
    const introducing = steps.filter(step => step.targetNodeId === id || step.targetNodeId === `${id}::__leaf`);
    assert.deepEqual(introducing.map(step => step.operation), ['LexicalSelect'], `${id} has one structural step`);
    const [select] = introducing;
    assert.equal(select.targetNodeId, id, 'the step selects the authored node');
    assert.equal(formatPlaybackOperationTitle(select), `Select ${word}`);
    assert.ok(shown(select, id) && shown(select, `${id}::__leaf`), `${category} and ${word} appear at the same step`);
    for (const step of replay.playbackSteps)
      assert.equal(shown(step, id), shown(step, `${id}::__leaf`), `${id}: label and word are never shown apart`);
  }
});

test('authored one-child nodes above the head still project, and a silent head is still selected', () => {
  const operations = new Map(steps.filter(step => step.sourceFrameIndex === 0).map(step => [step.targetNodeId, step.operation]));
  assert.deepEqual([...operations], [['d', 'LexicalSelect'], ['n', 'LexicalSelect'], ['nbar', 'Project'], ['np', 'Project'],
    ['dp', 'ExternalMerge']]);
});
