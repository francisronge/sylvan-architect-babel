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
