import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkNoEarlyReveal, checkRelationConstruction, frameStructure } from './helpers/replayInvariants.mjs';

/* A head movement can keep the moved head's id at its landing and rename the
 * lower copy. In GPT-6.1 Sol's Catalan partitive clitic (sol-final batch,
 * n3-43-ca-partitive-clitic, reading 1, stage 5) the stage also introduces T,
 * which an Agree claim names before the movement. Replay treated the kept-id
 * landing as a whole-stage relocation and built no structural step, so T
 * first appeared floating at Agree's moment. T is ordinary new material: it is
 * selected by its own step, and the movement still introduces the complex
 * head, its parent, the lower copy and the trajectory. */

const leaf = (id, label, word, extra = {}) => ({ id, label, children: [], ...(word ? { word } : {}), ...extra });
const node = (id, label, extra, ...children) => ({ id, label, ...extra, children });
const verbPhrase = () => node('VP', 'V', {}, leaf('verb', 'V', 'read', { silent: true, lineageId: 'verb' }), leaf('obj', 'D', 'it'));
const record = {
  sentence: 'Mia read it.',
  derivationStages: [
    { statement: 'Build vP.', stageRecord: 'The verb has raised to v.', relations: [],
      workspaceForest: [node('vP', 'v', {}, leaf('subj', 'D', 'Mia'), node('vInner', 'v', {},
        node('vHead', 'v', { lineageId: 'vchain' }, leaf('verbAtV', 'V', 'read', { lineageId: 'verb' }), leaf('lightV', 'v', null, { silent: true, lineageId: 'light' })),
        verbPhrase()))] },
    { statement: 'Merge T, agree with the subject and raise v to T.', stageRecord: 'T agrees with the subject and hosts the raised verb.',
      relations: [
        { relation: 'Agree', anchors: { probe: 'tense', goal: 'subj' }, values: { person: 'third' } },
        { relation: 'head movement', anchors: { source: 'vHeadLower', landing: 'vHead', host: 'tense', complexHead: 'finiteHead' }, priorAnchors: { source: 'vHead' } }
      ],
      workspaceForest: [node('tInner', 'T', {},
        node('finiteHead', 'T', {}, node('vHead', 'v', { lineageId: 'vchain' }, leaf('verbAtV', 'V', 'read', { lineageId: 'verb' }), leaf('lightV', 'v', null, { silent: true, lineageId: 'light' })),
          leaf('tense', 'T[past]', null, { silent: true })),
        node('vP', 'v', {}, leaf('subj', 'D', 'Mia'), node('vInner', 'v', {},
          node('vHeadLower', 'v', { silent: true, lineageId: 'vchain' }, leaf('verbLower', 'V', 'read', { silent: true, lineageId: 'verb' }), leaf('lightVLower', 'v', null, { silent: true, lineageId: 'light' })),
          verbPhrase())))] }
  ]
};

test('a kept-id head landing leaves the stage\'s new head to its own selection step', () => {
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  const steps = replay.playbackSteps;
  const stage = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.replayFrameIndex === 1);
  const first = stage.findIndex(({ step }) => frameStructure(step).displayed.has('tense'));
  assert(first >= 0, 'T is shown in its stage');
  assert.equal(stage[first].step.replayKind, 'micro', 'T appears at a structural step');
  assert.equal(stage[first].step.targetNodeId, 'tense');
  const agree = stage.findIndex(({ step }) => step.replayRelationIdentity?.relationIndex === 0);
  const movement = stage.findIndex(({ step }) => step.replayRelationIdentity?.relationIndex === 1);
  assert(first < agree && agree < movement, 'T is selected before Agree, which plays before the movement');
  const moved = frameStructure(stage[movement].step), before = frameStructure(stage[movement - 1].step);
  assert.equal(before.parent.get('vHead'), 'vInner', 'before the movement v stays in vP');
  assert(!before.displayed.has('finiteHead') && !before.displayed.has('tInner'));
  assert.equal(moved.parent.get('vHead'), 'finiteHead', 'the movement moment lands v in the complex head');
  assert(moved.displayed.has('vHeadLower') && moved.displayed.has('tInner'));
  assert.deepEqual(checkNoEarlyReveal(replay, record), []);
  assert.deepEqual(checkRelationConstruction(replay, record), []);
  assert(!JSON.stringify(steps).includes('RELATION_TIMING_CONFLICT'));
});
