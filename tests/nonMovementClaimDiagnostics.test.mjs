import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { checkMovementUnrendered } from './helpers/replayContractWarnings.mjs';

const node = (id, label, children = [], extra = {}) => ({ id, label, children, ...extra });
const word = (id, label, text, extra = {}) => node(id, label, [], { word: text, ...extra });
const stage = (workspaceForest, relations = []) => ({ statement: 'State', stageRecord: 'Authored state.', relations, workspaceForest });
const moment = (replay, stageIndex, relationIndex) => replay.playbackSteps.find(step => step.replayKind === 'relation'
  && step.replayRelationIdentity?.stageIndex === stageIndex && step.replayRelationIdentity.relationIndex === relationIndex);
const movementCodes = step => (step?.movementDiagnostics ?? []).filter(text => /^MOVEMENT_/u.test(text));

// Sol n4-26 and n4-28 (sol-120-20261026) name the thematic Source of an
// ablative or elative phrase: "source phrase" and "source head" read like
// one end of a movement, but nothing in the claim has a second occurrence.
const ablative = (lineageId) => {
  const phrase = node('ppS', 'PP', [node('npS', 'NP', [word('nS', 'N', 'kütüphaneden')]), node('pS', 'P', [], { silent: true })]);
  const verb = word('vR', 'V', 'al', lineageId ? { lineageId } : {});
  return [node('vp', 'VP', [phrase, verb])];
};
const sourceClaim = { relation: 'source-and-ablative-licensing',
  anchors: { predicate: 'vR', sourcePhrase: 'ppS', caseLicensor: 'pS', caseBearer: 'npS' }, values: { case: 'ablative' } };

test('a claim naming one end alone, with no second occurrence, states no movement', () => {
  const result = recoverMovementEvidence(sourceClaim, ablative(), []);
  assert.deepEqual(result, { diagnostics: [] });
  const record = { sentence: 'kütüphaneden al', derivationStages: [stage(ablative(), [sourceClaim])] };
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  assert.deepEqual(movementCodes(moment(replay, 0, 0)), []);
  assert.deepEqual(checkMovementUnrendered(replay, record), []);
});

test('one end of a lineage with another occurrence, or a movement name, still asserts movement', () => {
  const copied = ablative('take');
  copied.push(word('vHigh', 'V', 'al', { lineageId: 'take' }));
  assert.equal(recoverMovementEvidence({ ...sourceClaim, anchors: { ...sourceClaim.anchors } }, copied, []).failure,
    'MOVEMENT_ENDPOINTS_UNRESOLVED', 'the anchored verb has another occurrence the claim leaves unnamed');
  assert.equal(recoverMovementEvidence({ ...sourceClaim, relation: 'wh-movement' }, ablative(), []).failure,
    'MOVEMENT_ENDPOINTS_UNRESOLVED');
});

// Sol n3-78 (sol-120-20261026, stage 3): after V-to-I movement, a government
// claim restates the head chain beside the unchanged object trace of another
// chain. Read with that trace as its witness, it asserted a second movement
// with no shared lineage; the earlier claim already draws the chain.
const headChain = (withMovement = true) => {
  const objectTrace = node('objectTrace', 'NP [t]', [], { lineageId: 'operator', silent: true });
  const before = node('ip', 'IP', [node('ibar', 'I′', [word('i', 'I⁰', 'ni-li'),
    node('vp', 'VP', [node('vbar', 'V′', [word('readV', 'V⁰', 'soma', { lineageId: 'read' }), structuredClone(objectTrace)])])])]);
  const after = node('ip', 'IP', [node('ibar', 'I′', [node('complexI', 'I⁰', [word('i', 'I⁰', 'ni-li'), word('readV', 'V⁰', 'soma', { lineageId: 'read' })]),
    node('vp', 'VP', [node('vbar', 'V′', [node('verbTrace', 'V⁰ [t]', [], { lineageId: 'read', silent: true }), structuredClone(objectTrace)])])])]);
  const movement = { relation: 'V-to-I-head-movement', anchors: { landingVerb: 'readV', sourceTrace: 'verbTrace', targetInflection: 'i', resultingHead: 'complexI' },
    priorAnchors: { sourceVerb: 'readV' } };
  const government = { relation: 'head-chain-government', anchors: { raisedHead: 'readV', lowerHeadTrace: 'verbTrace', objectTrace: 'objectTrace' } };
  return { sentence: 'ni-li soma', derivationStages: [stage([before]), stage([after], withMovement ? [movement, government] : [government])] };
};

test('a claim restating a head chain an earlier claim draws, beside another chain\'s trace, asserts no second movement', () => {
  const record = headChain(), replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  assert.deepEqual(movementCodes(moment(replay, 1, 1)), []);
  assert.deepEqual(checkMovementUnrendered(replay, record), []);
  assert.equal(replay.relationRenderPlan.frames[1].items.filter(item => item.kind === 'trajectory'
    && item.sourceNodeId === 'verbTrace' && item.targetNodeId === 'readV').length, 1, 'the chain is drawn once');
});

test('without the earlier movement claim the restating claim keeps its refusal and the audit reports it', () => {
  const record = headChain(false), replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  assert.ok(movementCodes(moment(replay, 1, 0)).some(text => text.startsWith('MOVEMENT_LINEAGE_UNPROVEN')));
  assert.ok(checkMovementUnrendered(replay, record).some(found => found.subject === '1:0'));
});
