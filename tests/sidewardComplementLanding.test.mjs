import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { frameStructure } from './helpers/replayInvariants.mjs';
import { checkMovementUnrendered } from './helpers/replayContractWarnings.mjs';

// Opus n3-49 (What did John buy and Mary sell?, claude-review-opus, 26 Oct
// 2026) copies "what" sideward out of the second conjunct into a new
// workspace, where "buy" selects it. Bare labels write the new [V buy what]
// exactly like a complex head with "what" adjoined to "buy".
const leaf = (id, label, word, lineageId) => ({ id, label, word, ...(lineageId ? { lineageId } : {}), children: [] });
const node = (id, label, children, lineageId) => ({ id, label, ...(lineageId ? { lineageId } : {}), children });
const sellPhrase = () => node('vP-2', 'v', [leaf('Mary', 'D', 'Mary'), node('v-2-bar', 'v', [{ ...leaf('v-2', 'v'), silent: true },
  node('VP-sell', 'V', [leaf('sell', 'V', 'sell'), leaf('what-1', 'D', 'what', 'what')])])]);
const sideward = { relation: 'sideward-movement', anchors: { source: 'what-1', copy: 'what-2' } };
const stage = (workspaceForest, relations = []) => ({ statement: 'stage', stageRecord: 'stage', relations, workspaceForest });
const stages = () => [
  stage([node('VP-sell', 'V', [leaf('sell', 'V', 'sell'), leaf('what-1', 'D', 'what', 'what')])]),
  stage([sellPhrase()]),
  stage([sellPhrase(), node('VP-buy', 'V', [leaf('buy', 'V', 'buy'), leaf('what-2', 'D', 'what', 'what')])], [sideward])
];
const recover = (relation, derivation = stages()) =>
  recoverMovementEvidence(relation, derivation[2].workspaceForest, derivation[1].workspaceForest);

test('a one-word copy selected by a head in a new workspace moved as a phrase', () => {
  const { movement, failure } = recover(sideward);
  assert.equal(failure, undefined);
  assert.deepEqual([movement?.sourceNodeId, movement?.targetNodeId, movement?.trajectoryKind], ['what-1', 'what-2', 'phrasal']);
});

test('the sideward landing and its new parent appear at the movement moment with its path', () => {
  const record = { sentence: 'Mary sell what buy what', derivationStages: stages() };
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true }), steps = replay.playbackSteps;
  assert.deepEqual(checkMovementUnrendered(replay, record), []);
  const at = steps.findIndex(step => step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === 2
    && step.replayRelationIdentity.relationIndex === 0);
  assert.ok(at > 0);
  for (const id of ['what-2', 'VP-buy']) {
    assert.equal(steps.findIndex(step => frameStructure(step).displayed.has(id)), at, `${id} first appears at the moment`);
  }
  assert.ok(replay.relationRenderPlan.frames.flatMap(frame => frame.items).some(item => item.kind === 'trajectory'
    && item.relationRef.stageIndex === 2 && item.sourceNodeId === 'what-1' && item.targetNodeId === 'what-2'));
});

test('a head adjoined over its lower occurrence in the same tree stays a head', () => {
  // A clitic leaves its lower occurrence beside the complex it forms
  // (fixtures/replay-regressions/reserved-wrapper-fork.json, stage 4).
  const verbPhrase = children => node('VP0', 'V', children);
  const prior = [verbPhrase([leaf('V0', 'V', 'vi', 'verb'), leaf('D0', 'D', 'o', 'object')])];
  const current = [verbPhrase([node('VH', 'V', [leaf('V0', 'V', 'vi', 'verb'), leaf('D0', 'D', 'o', 'object')], 'verb-clitic-complex'),
    { ...leaf('D1', 'D', 'o', 'object'), silent: true }])];
  const relation = { relation: 'clitic movement', anchors: { landing: 'D0', source: 'D1' } };
  assert.equal(recoverMovementEvidence(relation, current, prior).movement?.trajectoryKind, 'head');
});

test('a receiving head named explicitly keeps a cross-workspace landing a head', () => {
  const derivation = stages();
  const relation = { relation: 'sideward head movement', anchors: { source: 'what-1', landing: 'what-2', 'host head': 'buy', 'complex head': 'VP-buy' } };
  assert.equal(recover(relation, derivation).movement?.trajectoryKind, 'head');
});
