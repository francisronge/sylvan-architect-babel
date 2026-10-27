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

// Sol n3-49 (sol-parts-20261026, stage 6): do-support pronounces T raised
// across the board a stage earlier and lists its lower copies. Nothing of the
// chain moves in that stage; the earlier stage's claim draws the movement.
const doSupportRecord = () => {
  const clause = (suffix, verb) => node(`tp${suffix}`, 'T', [word(`t${suffix}`, 'T[past]', '', { lineageId: 'past', silent: true }), word(`v${suffix}`, 'V', verb)]);
  const coordination = () => node('coord', '&', [clause('Buy', 'buy'), word('and', '&', 'and'), clause('Sell', 'sell')]);
  const before = [node('cp', 'C', [word('cQ', 'C[Q]', '', { silent: true }), coordination()])];
  const raised = spelled => [node('cp', 'C', [node('cHead', 'C', [word('tHigh', 'T[past]', spelled, { lineageId: 'past', ...(spelled ? {} : { silent: true }) }),
    word('cQ', 'C[Q]', '', { silent: true })]), coordination()])];
  const doSupport = { relation: 'do-support', anchors: { finiteHead: 'tHigh', interrogativeHost: 'cQ', lowerTenseOccurrences: ['tBuy', 'tSell'] },
    values: { exponent: 'did' } };
  return { before, raised: raised(''), pronounced: raised('did'), doSupport };
};

test('a later stage listing the unchanged lower copies of an earlier chain asserts no movement', () => {
  const { before, raised, pronounced, doSupport } = doSupportRecord();
  assert.equal(recoverMovementEvidence(doSupport, pronounced, raised).failure, 'MOVEMENT_ENDPOINTS_UNRESOLVED',
    'the resolver refusal remains inspectable');
  const record = { sentence: 'did buy and sell', derivationStages: [stage(before), stage(raised), stage(pronounced, [doSupport])] };
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  assert.deepEqual(movementCodes(moment(replay, 2, 0)), []);
  assert(!checkMovementUnrendered(replay, record).some(found => found.subject === '2:0'));
});

test('the same claim at the stage that raises T, or listing a copy twice, keeps its refusal', () => {
  const { before, raised, pronounced, doSupport } = doSupportRecord();
  const atRaising = { sentence: 'buy and sell', derivationStages: [stage(before), stage(raised, [doSupport])] };
  const raisingReplay = prepareReplay({ ...structuredClone(atRaising), includePlayback: true });
  assert.ok(movementCodes(moment(raisingReplay, 1, 0)).some(text => text.startsWith('MOVEMENT_ENDPOINTS_UNRESOLVED')));
  assert.ok(checkMovementUnrendered(raisingReplay, atRaising).some(found => found.subject === '1:0'));
  const repeated = { ...doSupport, anchors: { ...doSupport.anchors, lowerTenseOccurrences: ['tBuy', 'tBuy'] } };
  const twice = { sentence: 'did buy and sell', derivationStages: [stage(before), stage(raised), stage(pronounced, [repeated])] };
  assert.ok(movementCodes(moment(prepareReplay({ ...structuredClone(twice), includePlayback: true }), 2, 0))
    .some(text => text.startsWith('MOVEMENT_ENDPOINTS_UNRESOLVED')));
});

// Sol n4-20 (sol-parts-20261026, stage 3): a pied-piping claim names the
// relative phrase the stage's earlier claim moves, and material inside it.
const piedPiping = (withMovement = true) => {
  const subject = () => node('subj', 'NP', [node('poss', 'NP', [word('rel', 'N', 'której')]), word('n', 'N', 'syn')], { lineageId: 'son' });
  const verbPhrase = () => node('ibar', 'I′', [word('i', 'I', '', { silent: true }), word('v', 'V', 'wyjechał')]);
  const before = [node('ip', 'IP', [subject(), verbPhrase()])];
  const after = [node('cp', 'CP', [subject(), node('cbar', 'C′', [word('c', 'C', '', { silent: true }),
    node('ip', 'IP', [node('subjTrace', 'NP', [], { lineageId: 'son', silent: true }), verbPhrase()])])])];
  const movement = { relation: 'A_bar_movement', anchors: { landing: 'subj', sourceTrace: 'subjTrace', landingClause: 'cp' }, priorAnchors: { source: 'subj' } };
  const piped = { relation: 'pied_piping', anchors: { relativeOperator: 'poss', movedPhrase: 'subj', possessedHead: 'n' } };
  return { sentence: 'której syn wyjechał', derivationStages: [stage(before), stage(after, withMovement ? [movement, piped] : [piped])] };
};

test('a claim naming only the landing an earlier claim of its stage moves asserts no second movement', () => {
  const record = piedPiping(), replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  assert.deepEqual(movementCodes(moment(replay, 1, 1)), []);
  assert.deepEqual(checkMovementUnrendered(replay, record), []);
  assert.equal(replay.relationRenderPlan.frames[1].items.filter(item => item.kind === 'trajectory'
    && item.sourceNodeId === 'subjTrace' && item.targetNodeId === 'subj').length, 1, 'the movement is drawn once');
});

test('without the earlier movement claim the landing-only claim keeps its refusal and the audit reports it', () => {
  const record = piedPiping(false), replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  assert.ok(movementCodes(moment(replay, 1, 0)).some(text => text.startsWith('MOVEMENT_ENDPOINTS_UNRESOLVED')));
  assert.ok(checkMovementUnrendered(replay, record).some(found => found.subject === '1:0'));
});

// Opus n4-16 (opus-parts, stage 7): antecedent government names the moved
// operator, its trace and the C head it lands beside; the stage's earlier
// claim draws that hop. C has no other occurrence, so it lands nowhere.
const government = (withMovement = true) => {
  const lowerClause = () => node('ibar', 'I′', [word('i', 'I', '', { silent: true }),
    node('vp', 'VP', [word('v', 'V', 'morava'), node('tOp1', 'DP', [], { lineageId: 'op', silent: true })])]);
  const before = [node('ip', 'IP', [word('op', 'DP', 'que', { lineageId: 'op' }), lowerClause()])];
  const after = [node('cp', 'CP', [word('op', 'DP', 'que', { lineageId: 'op' }), node('cbar', 'C′', [word('c', 'C', '', { silent: true }),
    node('ip', 'IP', [node('tOp2', 'DP', [], { lineageId: 'op', silent: true }), lowerClause()])])])];
  const movement = { relation: 'A-bar-movement', anchors: { moved: 'op', trace: 'tOp2' } };
  const governs = { relation: 'antecedent-government', anchors: { antecedent: 'op', head: 'c', trace: 'tOp2' } };
  return { sentence: 'que morava', derivationStages: [stage(before), stage(after, withMovement ? [movement, governs] : [governs])] };
};

test('a government claim citing the head beside a hop an earlier claim draws asserts no second movement', () => {
  const record = government(), replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  assert.ok(replay.relationRenderPlan.frames[1].items.some(item => item.kind === 'trajectory'
    && item.sourceNodeId === 'tOp2' && item.targetNodeId === 'op'), 'the earlier claim draws the hop');
  assert.deepEqual(movementCodes(moment(replay, 1, 1)), []);
  assert(!checkMovementUnrendered(replay, record).some(found => found.subject === '1:1'));
});

test('without the earlier movement claim the government claim keeps its refusal and the audit reports it', () => {
  const record = government(false), replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  assert.ok(movementCodes(moment(replay, 1, 0)).some(text => text.startsWith('MOVEMENT_')));
  assert.ok(checkMovementUnrendered(replay, record).some(found => found.subject === '1:0'));
});
