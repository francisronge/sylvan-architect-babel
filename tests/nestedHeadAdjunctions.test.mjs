import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkLandingAttached, checkWholeParent, frameStructure } from './helpers/replayInvariants.mjs';

// Stage 2 adjoins three heads in turn to build one nested complex:
// relativeComplexHead[relativeSubjectHead[relativeVerbHead[meetHigh relativeTHead] weHigh] himHigh].
// Each adjunction's moment introduces its own segment; the outer segments wait
// for the movements that fill them, and construction attaches the complex.
const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/nested-head-adjunctions.json', import.meta.url)));
const replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
const steps = replay.playbackSteps;
const momentOf = relationIndex => steps.findIndex(step => step.replayKind === 'relation'
  && step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === relationIndex);
const SEGMENTS = ['relativeVerbHead', 'relativeSubjectHead', 'relativeComplexHead'];

test('nested-head-adjunctions.json: each adjunction plays at its own moment with only its own segment', () => {
  const moments = [0, 1, 2].map(momentOf);
  assert(moments.every(index => index > 0) && moments[0] < moments[1] && moments[1] < moments[2], 'authored order');
  moments.forEach((index, relationIndex) => {
    const shown = frameStructure(steps[index]).displayed;
    SEGMENTS.forEach((segment, depth) => assert.equal(shown.has(segment), depth <= relationIndex,
      `${segment} at the moment of relation ${relationIndex + 1}`));
    const parent = frameStructure(steps[index]).parent;
    if (relationIndex) assert.equal(parent.get(SEGMENTS[relationIndex - 1]), SEGMENTS[relationIndex], 'the new segment wraps the complex');
  });
  assert.deepEqual(steps.flatMap(step => step.movementDiagnostics ?? []).filter(text => text.startsWith('RELATION_TIMING_CONFLICT')), []);
});

test('nested-head-adjunctions.json: every painted parent is whole and every landing is attached', () => {
  assert.deepEqual(checkWholeParent(replay), []);
  assert.deepEqual(checkLandingAttached(replay), []);
});

// A segment goes to a later movement only when that movement's own landing
// path introduces it. Otherwise the earlier movement keeps it.
const firstPainted = (prepared, id) => prepared.playbackSteps.findIndex(step => frameStructure(step).displayed.has(id));
const momentIn = (prepared, stageIndex, relationIndex) => prepared.playbackSteps.findIndex(step => step.replayKind === 'relation'
  && step.replayRelationIdentity?.stageIndex === stageIndex && step.replayRelationIdentity.relationIndex === relationIndex);

test('nested-head-adjunctions.json: a later landing no movement path introduces leaves the segment over it with the earlier movement', () => {
  // Variant: the object clitic claim keeps a registered head-movement name but
  // proves no movement (its source shares no lineage with himHigh), so its
  // landing path is empty. relativeComplexHead stays with the subject clitic's
  // moment instead of being built by construction before its own daughter.
  const variant = structuredClone(record);
  variant.derivationStages[1].relations[2] = { relation: 'head movement', anchors: { landing: 'himHigh', source: 'airportN' } };
  const prepared = prepareReplay({ ...variant, includePlayback: true });
  assert.equal(firstPainted(prepared, 'relativeComplexHead'), momentIn(prepared, 1, 1));
  assert.equal(firstPainted(prepared, 'relativeSubjectHead'), momentIn(prepared, 1, 1));
});

test('a later landing whose path is a landing wrapper keeps the wrapper, and the earlier head movement keeps its complex', () => {
  // Hand-built: stage 2 raises sees to T (complex tc) and then Mia to Spec-TP.
  // tp keeps its id, so the A-movement's path is its wrapper tbar. A wrapper
  // path needs the landing's parent to exist in the preceding stage, and an
  // earlier landing's path ends below any such parent, so this control can
  // only confirm that each movement keeps what it introduces.
  const leaf = (id, label, extra = {}) => ({ id, label, ...extra });
  const verbPhrase = (subject, verb) => ({ id: 'vp', label: 'v', children: [subject, { id: 'vbar', label: 'v', children: [
    leaf('v', 'v', { silent: true }), { id: 'bigvp', label: 'V', children: [verb, leaf('bo', 'D', { word: 'Bo' })] }] }] });
  const mia = leaf('mia', 'D', { word: 'Mia', lineageId: 'mia-chain' }), see = leaf('see', 'V', { word: 'sees', lineageId: 'see-chain' });
  const t = leaf('t', 'T', { silent: true });
  const wrapped = {
    sentence: 'Mia sees Bo',
    derivationStages: [
      { statement: 'Build the clause.', stageRecord: 'Merge the verb with its object, then v, the subject and T.', relations: [],
        workspaceForest: [{ id: 'tp', label: 'T', children: [t, verbPhrase(mia, see)] }] },
      { statement: 'Raise the verb to T and the subject to Spec-TP.', stageRecord: 'The verb adjoins to T; the subject moves above T-bar.',
        relations: [
          { relation: 'head movement', anchors: { landing: 'see', source: 'seeTrace' }, priorAnchors: { source: 'see' } },
          { relation: 'A-movement', anchors: { landing: 'mia', source: 'miaTrace' }, priorAnchors: { source: 'mia' } }],
        workspaceForest: [{ id: 'tp', label: 'T', children: [mia, { id: 'tbar', label: 'T', children: [
          { id: 'tc', label: 'T', children: [see, t] },
          verbPhrase(leaf('miaTrace', 'D', { word: 'Mia', silent: true, lineageId: 'mia-chain' }),
            leaf('seeTrace', 'V', { word: 'sees', silent: true, lineageId: 'see-chain' }))] }] }] }]
  };
  const prepared = prepareReplay({ ...structuredClone(wrapped), includePlayback: true });
  assert.equal(firstPainted(prepared, 'tc'), momentIn(prepared, 1, 0));
  assert.equal(firstPainted(prepared, 'tbar'), momentIn(prepared, 1, 1));
  assert.deepEqual([...checkWholeParent(prepared), ...checkLandingAttached(prepared)], []);
});
