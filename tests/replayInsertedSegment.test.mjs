import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkContinuedOccurrences, checkWholeParent, frameStructure } from './helpers/replayInvariants.mjs';

/* A stage can keep a phrase's id on a new node above it and give the phrase
 * itself a new id: the new node takes over the phrase's daughters and gains a
 * new sister. The phrase under its new id is the same occurrence, already
 * built; the node above it is new and appears at the merge that creates it.
 * Replay used to build the phrase again under its new id while the kept id
 * stood over it alone, a unary parent that no stage authors. */

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/inserted-adjunction-segment.json', import.meta.url), 'utf8'));

const stageSteps = (steps, stage) => steps.map((step, index) => ({ step, index })).filter(({ step }) => step.replayFrameIndex === stage);
const shownAs = (structure, authored) => [...structure.displayed].filter(id => id === authored
  || structure.nodes.get(id).data.aliasIds?.includes(authored));

function assertRaisedContinuation(record, { stage, kept, continuation, sister }) {
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true }), steps = replay.playbackSteps;
  const own = stageSteps(steps, stage), previous = frameStructure(steps[own[0].index - 1]);
  assert.deepEqual(checkWholeParent(replay), []);
  assert.deepEqual(checkContinuedOccurrences(replay, record), []);
  assert.deepEqual(shownAs(previous, kept), [continuation], `the preceding ${kept} is painted as ${continuation}`);
  assert.deepEqual(shownAs(frameStructure(own[0].step), continuation), [continuation]);
  assert.equal(own.find(({ step }) => step.replayKind === 'micro' && step.targetNodeId === continuation), undefined,
    `${continuation} is not built again`);
  const merge = own.findIndex(({ step }) => frameStructure(step).displayed.has(kept));
  assert(merge > 0, `${kept} is new in its stage`);
  assert.equal(own[merge].step.replayKind, 'micro');
  assert.equal(own[merge].step.targetNodeId, kept, `${kept} appears at its own merge`);
  const merged = frameStructure(own[merge].step);
  assert.deepEqual([...merged.children.get(kept)].sort(), [continuation, sister].sort());
  for (const { step } of own.slice(0, merge)) assert.equal(frameStructure(step).parent.get(continuation), null);
}

test('an adjoined relative clause: the DP built in stage 1 stays, and the higher DP segment appears at its merge', () => {
  assertRaisedContinuation(fixture, { stage: 1, kept: 'hdp', continuation: 'hcore', sister: 'rcp' });
});

const leaf = (id, label, word, extra = {}) => ({ id, label, children: [], ...(word ? { word } : { silent: true }), ...extra });
const node = (id, label, ...children) => ({ id, label, children });
const nominal = () => node('pr', 'D', leaf('md', 'D', 'the'), leaf('mn', 'N', 'manager'));
// The shape of GPT-6.1 Sol's it-cleft (sol-120 batch, n4-07-en-cleft-relative,
// reading 2, stage 7): the copula raises to T, and the expletive merges with
// the T projection, whose id moves to the new projection above it.
const cleft = {
  sentence: 'It was the manager.',
  derivationStages: [
    {
      statement: 'Build the copular clause.',
      stageRecord: 'Past T selects the copula and its nominal.',
      relations: [],
      workspaceForest: [node('mt', 'T', leaf('mh', 'T[past]'),
        node('vc', 'V', leaf('was0', 'V[copula, past]', 'was', { lineageId: 'copula' }), nominal()))]
    },
    {
      statement: 'Raise the copula and merge the expletive.',
      stageRecord: 'The copula sits in T and the expletive is its subject.',
      relations: [{ relation: 'head_movement', anchors: { source: 'was0', landing: 'wasH', target: 'mh' } }],
      workspaceForest: [node('mc', 'C', leaf('mdecl', 'C[declarative]'),
        node('mt', 'T', leaf('it', 'D[expletive]', 'It'),
          node('mtm', 'T', node('mcomplex', 'T', leaf('wasH', 'V[copula, past]', 'was', { lineageId: 'copula' }), leaf('mh', 'T[past]')),
            node('vc', 'V', leaf('was0', 'V[trace]', null, { lineageId: 'copula' }), nominal()))))]
    }
  ]
};

test('a raised copula and a new expletive subject: T stays built, and the T above it appears with the expletive', () => {
  assertRaisedContinuation(cleft, { stage: 1, kept: 'mt', continuation: 'mtm', sister: 'it' });
  const steps = prepareReplay({ ...structuredClone(cleft), includePlayback: true }).playbackSteps;
  const movement = stageSteps(steps, 1).find(({ step }) => step.replayKind === 'relation');
  assert.equal(movement.step.operation, 'head_movement');
  assert.deepEqual(frameStructure(movement.step).children.get('mtm'), ['mcomplex', 'vc'], 'the head moves inside the continuing T');
});
