import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkStepSemantics } from './helpers/replayStepInvariants.mjs';

/* In a stage whose claims own tree changes, each relation moment applies only
 * the changes its active claims own. A node a claim names without moving it
 * still changes at that claim's moment. In GPT-6.1 Sol's Basque ergative
 * (sol-final batch, n3-25-eu-ergative, reading 1, stage 6) the subject raises
 * to T's edge and T, named as the attracting head, relabels "edge" to
 * "edge:satisfied"; Replay held the new label until the Stage Record. */

const leaf = (id, label, word, extra = {}) => ({ id, label, children: [], ...(word ? { word } : {}), ...extra });
const node = (id, label, ...children) => ({ id, label, children });
const predicate = (subject, edge) => node('finitePredicate', 'T',
  node('vP', 'v', subject, leaf('sleepV', 'V', 'slept')),
  leaf('finiteT', `T[present, ${edge}]`, 'did'));
const record = {
  sentence: 'Jonek slept did.',
  inputTokens: ['Jonek', 'slept', 'did'],
  derivationStages: [
    { statement: 'Build the finite predicate.', stageRecord: 'T has an edge feature.', relations: [],
      workspaceForest: [predicate(leaf('jonLow', 'D', 'Jon', { lineageId: 'jon' }), 'edge'), leaf('declarativeC', 'C', null, { silent: true })],
      realizations: [{ nodeIds: ['jonLow'], tokenIndices: [0] }] },
    { statement: 'Raise the subject to the clause edge.', stageRecord: 'The subject satisfies the edge feature of T.',
      relations: [
        { relation: 'subject Internal Merge', anchors: { source: 'jonLow', landing: 'jonHigh', attractingHead: 'finiteT' }, priorAnchors: { source: 'jonLow' } },
        { relation: 'copy pronunciation and realization reassociation', anchors: { pronouncedOccurrence: 'jonHigh', silentOccurrence: 'jonLow' },
          priorAnchors: { previousRealizationSource: 'jonLow' } }
      ],
      workspaceForest: [node('subjectTP', 'T', leaf('jonHigh', 'D', 'Jon', { lineageId: 'jon' }),
        predicate(leaf('jonLow', 'D', 'Jon', { lineageId: 'jon', silent: true }), 'edge:satisfied')), leaf('declarativeC', 'C', null, { silent: true })],
      realizations: [{ nodeIds: ['jonHigh'], tokenIndices: [0] }] }
  ]
};

const find = (node, id) => node?.id === id ? node : (node?.children ?? []).map(child => find(child, id)).find(Boolean);

test('a node a movement claim names but does not move relabels at that claim\'s moment', () => {
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  const steps = replay.playbackSteps;
  const movement = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 0);
  assert(movement > 0);
  assert.equal(find(steps[movement - 1].replayCanvasData, 'finiteT').label, 'T[present, edge]');
  assert.equal(find(steps[movement].replayCanvasData, 'finiteT').label, 'T[present, edge:satisfied]');
  assert.deepEqual(checkStepSemantics(replay, record), []);
});
