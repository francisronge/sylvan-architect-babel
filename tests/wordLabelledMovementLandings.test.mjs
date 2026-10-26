import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { checkMovementUnrendered } from './helpers/replayContractWarnings.mjs';

// Opus n3-03 (他把衣服洗干净了, claude-review-opus, 26 Oct 2026) labels every node
// with its lexical item, as the prompt allows: 干净 adjoins to 洗, then 衣服
// moves to the edge of the 洗 projection. Neither claim names its landing in a
// known role, and the phrasal claim's target is the projection it merges with.
const word = (id, text, lineageId, silent) => ({ id, label: text, word: text, ...(lineageId ? { lineageId } : {}), ...(silent ? { silent } : {}), children: [] });
const smallClause = (silentGan, silentYifu) => ({ id: 'res1', label: '干净',
  children: [word('yifu', '衣服', 'L-yifu', silentYifu), word('gan', '干净', 'L-gan', silentGan)] });
const complex = () => ({ id: 'xiCx', label: '洗', children: [word('xi', '洗'), word('gan2', '干净', 'L-gan')] });
const stage = (workspaceForest, relations = []) => ({ statement: 'stage', stageRecord: 'stage', relations, workspaceForest });
const headMovement = { relation: 'head-movement', anchors: { mover: 'gan2', source: 'gan', host: 'xi', complexHead: 'xiCx' } };
const internalMerge = { relation: 'internal-merge', anchors: { mover: 'yifu2', source: 'yifu', target: 'vp1' } };
const stages = () => [
  stage([smallClause(false, false)]),
  stage([{ id: 'vp1', label: '洗', children: [word('xi', '洗'), smallClause(false, false)] }]),
  stage([{ id: 'vp1', label: '洗', children: [complex(), smallClause(true, false)] }], [headMovement]),
  stage([{ id: 'vp2', label: '洗', children: [word('yifu2', '衣服', 'L-yifu'),
    { id: 'vp1', label: '洗', children: [complex(), smallClause(true, true)] }] }], [internalMerge])
];
const recover = (index, relation, derivation = stages()) =>
  recoverMovementEvidence(relation, derivation[index].workspaceForest, derivation[index - 1].workspaceForest);

test('a head adjoined among word labels is recovered from its anchored host and complex', () => {
  const { movement, failure } = recover(2, headMovement);
  assert.equal(failure, undefined);
  assert.deepEqual([movement?.sourceNodeId, movement?.targetNodeId, movement?.trajectoryKind], ['gan', 'gan2', 'head']);
  assert.deepEqual(movement.context.map(({ key, kind }) => `${key}:${kind}`), ['host:head-landing', 'complexHead:head-complex']);
});

test('a specifier among word labels is phrasal, and the projection it merges with names its site', () => {
  const { movement, failure } = recover(3, internalMerge);
  assert.equal(failure, undefined);
  assert.deepEqual([movement?.sourceNodeId, movement?.targetNodeId, movement?.trajectoryKind], ['yifu', 'yifu2', 'phrasal']);
  assert.deepEqual(movement.context, [{ key: 'target', nodeId: 'vp1', kind: 'site' }]);
});

test('a target that does not project the landing\'s parent is not its site', () => {
  // Neither the small clause nor the complex head is the landing's sister.
  for (const target of ['res1', 'xiCx']) {
    const { movement } = recover(3, { ...internalMerge, anchors: { ...internalMerge.anchors, target } });
    assert.notEqual(movement?.targetNodeId, 'yifu2', target);
  }
  const relabelled = stages();
  relabelled[3].workspaceForest[0].label = '把';
  assert.notEqual(recover(3, internalMerge, relabelled).movement?.targetNodeId, 'yifu2', 'a parent that repeats no daughter\'s label projects from neither');
});

test('both word-labelled movements draw their paths at their own moments', () => {
  const record = { sentence: '衣服洗干净', inputTokens: ['衣服', '洗', '干净'], derivationStages: stages() };
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  assert.deepEqual(checkMovementUnrendered(replay, record), []);
  const paths = replay.relationRenderPlan.frames.flatMap(frame => frame.items).filter(item => item.kind === 'trajectory');
  for (const [stageIndex, sourceNodeId, targetNodeId] of [[2, 'gan', 'gan2'], [3, 'yifu', 'yifu2']]) {
    assert.ok(paths.some(item => item.relationRef.stageIndex === stageIndex && item.sourceNodeId === sourceNodeId
      && item.targetNodeId === targetNodeId), `stage ${stageIndex + 1} draws ${sourceNodeId} -> ${targetNodeId}`);
  }
});

// Prose labels are not category notation either: a landing beside a sister
// that repeats its parent's label exactly ("T-projection" over "T-projection")
// is a specifier (movement-id-ab pt-enclisis.astra.B, stage 6).
test('a landing beside a sister repeating its parent\'s prose label is a specifier', () => {
  const lower = (silent) => ({ id: 'tenseComplement', label: 'T-projection', children: [{ id: 't', label: 'T', word: 'vou', children: [] },
    { id: 'vp', label: 'V-projection', children: [{ id: 'subjectBase', label: 'D[pro, 1sg]', lineageId: 'subject', ...(silent ? { silent } : {}), word: 'eu', children: [] },
      { id: 'v', label: 'V', word: 'cantar', children: [] }] }] });
  const relation = { relation: 'subject Internal Merge', anchors: { landingCopy: 'subjectAtT', sourceCopy: 'subjectBase', result: 'finiteClause' } };
  const current = [{ id: 'finiteClause', label: 'T-projection', children: [
    { id: 'subjectAtT', label: 'D[pro, 1sg]', lineageId: 'subject', word: 'eu', children: [] }, lower(true)] }];
  const { movement, failure } = recoverMovementEvidence(relation, current, [lower(false)]);
  assert.equal(failure, undefined);
  assert.deepEqual([movement?.sourceNodeId, movement?.targetNodeId, movement?.trajectoryKind], ['subjectBase', 'subjectAtT', 'phrasal']);
});
