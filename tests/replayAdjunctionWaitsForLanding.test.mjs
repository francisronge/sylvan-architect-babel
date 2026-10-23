import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

const records = loadFixtureAnalyses().records;
const stageSteps = (id, stageIndex) => {
  const { record } = records.find(entry => entry.id === id);
  return prepareReplay({ sentence: record.sentence, inputTokens: record.inputTokens,
    derivationStages: record.derivationStages, includePlayback: true }).playbackSteps
    .filter(step => step.replayFrameIndex === stageIndex);
};
const relationAt = (stage, relationIndex) => stage.findIndex(step => step.replayKind === 'relation'
  && step.replayRelationIdentity?.relationIndex === relationIndex);
const mergeAt = (stage, nodeId) => stage.findIndex(step => step.replayKind === 'micro' && step.operation === 'ExternalMerge'
  && step.targetNodeId === nodeId);

// "Only those two students seem to have been invited", stage 5: raising lands the subject in
// Spec,IP[finite], and "only" adjoins to that IP. The adjunction's new IP segment takes the IP
// as its daughter, so it builds forward only once the movement has completed that IP.
test('a merge whose daughter a movement completes plays after the movement', () => {
  const stage = stageSteps('replay-regressions/workspace-attachment-continuity.json#/cases/0', 4);
  const raising = relationAt(stage, 0), adjunction = mergeAt(stage, 'bOuterIP');
  assert.ok(raising >= 0 && adjunction >= 0);
  assert.ok(raising < adjunction, `the adjunction (step ${adjunction + 1}) precedes the raising that completes its daughter (step ${raising + 1})`);
  const landed = stage[raising];
  assert.ok(landed.replayVisibleNodeIds.includes('bSubject') && !landed.replayVisibleNodeIds.includes('bOuterIP'),
    'the movement moment shows the landed subject and not yet the adjunction segment');
  assert.deepEqual(stage.slice(raising + 1).filter(step => step.replayKind === 'relation').map(step => step.replayRelationIdentity.relationIndex), [1, 2, 3],
    'the remaining relations keep authored order after the adjunction');
});

// Stage 2 of the Hungarian clause: V-to-I lands the verb inside I⁰, which does not contain the
// verb's source in VP, so I⁰ and VP merge first and the verb then moves up into I⁰.
test('a head landing does not make its head wait to merge with the phrase containing the source', () => {
  const stage = stageSteps('replay-regressions/later-occupant-source-beside-ancestor-sister.json#', 1);
  const headMovement = relationAt(stage, 0), merge = mergeAt(stage, 'a-ibar');
  assert.ok(headMovement >= 0 && merge >= 0);
  assert.ok(merge < headMovement, `V-to-I (step ${headMovement + 1}) plays before I⁰ merges with the VP containing its source (step ${merge + 1})`);
});

// Stage 2 of the Chinese 把 clause: object movement completes VP, which Ba⁰ then takes as its
// complement, but theta assignment is authored first and relates the subject and Ba⁰ outside
// that VP. Playing the movement before Ba′ would move that claim ahead of the structure it
// relates, so both relations keep their authored place after the construction.
test('a completing movement does not pull an earlier claim ahead of the structure it relates', () => {
  const stage = stageSteps('replay-regressions/unrecognized-movement.json#/cases/5', 1);
  const theta = relationAt(stage, 0), movement = relationAt(stage, 1);
  const baBar = mergeAt(stage, 'bBaBar'), baP = mergeAt(stage, 'bBaP');
  assert.ok(theta >= 0 && movement >= 0 && baBar >= 0 && baP >= 0);
  assert.ok(baP < theta && theta < movement, 'theta assignment plays after BaP, before the object movement');
});
