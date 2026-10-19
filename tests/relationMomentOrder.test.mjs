import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { orderRelationMoments } from '../replay/relationMomentOrder.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';

const needs = entries => new Map(Object.entries(entries).map(([index, others]) => [Number(index), new Set(others)]));

test('moments keep authored order unless a relation needs a later one, then play right after it', () => {
  assert.deepEqual(orderRelationMoments([0, 1, 2], needs({})), [0, 1, 2]);
  assert.deepEqual(orderRelationMoments([0, 1, 2], needs({ 1: [0], 2: [0, 1] })), [0, 1, 2], 'earlier needs change nothing');
  assert.deepEqual(orderRelationMoments([0, 1], needs({ 0: [1] })), [1, 0]);
  assert.deepEqual(orderRelationMoments([0, 1, 2, 3], needs({ 0: [2] })), [1, 2, 0, 3], 'other relations keep their order');
  assert.deepEqual(orderRelationMoments([0, 1, 2], needs({ 0: [2], 1: [2] })), [2, 0, 1], 'relations waiting together keep authored order');
  assert.deepEqual(orderRelationMoments([0, 1, 2, 3], needs({ 0: [1, 3] })), [1, 2, 3, 0], 'a relation needing several waits for the last');
  assert.deepEqual(orderRelationMoments([2, 0, 1], needs({ 0: [1] })), [1, 0, 2], 'the input order is irrelevant');
});

test('a chain of needs resolves in turn', () => {
  assert.deepEqual(orderRelationMoments([0, 1, 2], needs({ 0: [1], 1: [2] })), [2, 1, 0]);
  assert.deepEqual(orderRelationMoments([0, 1, 2, 3, 4], needs({ 0: [1, 2], 1: [2], 3: [4] })), [2, 1, 0, 4, 3]);
  // A relation needing an earlier relation follows it wherever that relation waits.
  assert.deepEqual(orderRelationMoments([0, 1, 2], needs({ 0: [2], 1: [0] })), [2, 0, 1]);
});

test('cycles keep authored order among their members and for relations needing them', () => {
  assert.deepEqual(orderRelationMoments([0, 1], needs({ 0: [1], 1: [0] })), [0, 1]);
  assert.deepEqual(orderRelationMoments([0, 1, 2], needs({ 1: [2], 2: [1] })), [0, 1, 2]);
  assert.deepEqual(orderRelationMoments([0, 1, 2], needs({ 0: [1], 1: [2], 2: [1] })), [0, 1, 2],
    'a cycle member\'s moment may lack what it introduces, so a relation needing it is not moved');
  assert.deepEqual(orderRelationMoments([0, 1, 2, 3], needs({ 0: [3], 1: [2], 2: [1] })), [1, 2, 3, 0], 'needs outside the cycle still apply');
  assert.deepEqual(orderRelationMoments([0, 1, 2], needs({ 0: [1, 2], 1: [0] })), [2, 0, 1],
    'a cycle member waiting outside the cycle holds back its later members');
  assert.deepEqual(orderRelationMoments([0, 1, 2], needs({ 0: [1], 1: [2], 2: [0] })), [0, 1, 2]);
});

const phrase = (id, lineageId, silent = false) => ({ id, label: 'DP', lineageId, word: lineageId.toLowerCase(), ...(silent ? { silent: true } : {}) });
const host = id => ({ id: `host_${id}`, label: 'XP', children: [phrase(`${id}_hi`, id.toUpperCase()), phrase(id, id.toUpperCase(), true)] });
/** Three phrases a, b and c each move to a new host in the second stage. */
const movements = relations => ({ derivationStages: [
  { statement: 'Three phrases.', stageRecord: 'Three phrases are built.', relations: [],
    workspaceForest: [phrase('a', 'A'), phrase('b', 'B'), phrase('c', 'C')] },
  { statement: 'Three movements.', stageRecord: 'Each phrase moves.', relations,
    workspaceForest: [{ id: 'root', label: 'XP', children: ['a', 'b', 'c'].map(host) }] }
] });
const move = (id, context) => ({ relation: 'Internal Merge',
  anchors: { lowerCopy: id, higherCopy: `${id}_hi`, ...(context ? { context } : {}) }, priorAnchors: { source: id } });
const claim = (...ids) => ({ relation: 'Observation', anchors: Object.fromEntries(ids.map((id, index) => [`participant${index + 1}`, id])) });
const play = record => buildReplayPlayback({ sentence: 'a b c', analyses: [record] }).steps;
const relationMoments = (steps, stage = 1) => steps.filter(step => step.replayFrameIndex === stage && step.replayKind === 'relation');
const order = steps => relationMoments(steps).map(step => step.replayRelationIdentity.relationIndex);
const visible = (step, id) => step.replayVisibleNodeIds.includes(id);
const timingConflicts = steps => steps.flatMap(step => step.movementDiagnostics ?? []).filter(message => message.startsWith('RELATION_TIMING_CONFLICT'));
const momentOf = (steps, relationIndex) => relationMoments(steps).find(step => step.replayRelationIdentity.relationIndex === relationIndex);

test('Replay: a claim naming a later movement\'s landing plays right after it; the others keep authored order', () => {
  const record = movements([claim('b_hi'), move('a'), move('b'), move('c')]), original = structuredClone(record);
  const steps = play(record);
  assert.deepEqual(order(steps), [1, 2, 0, 3]);
  const landing = momentOf(steps, 2), waiting = momentOf(steps, 0);
  assert.equal(steps.indexOf(waiting), steps.indexOf(landing) + 1, 'right after the movement');
  assert.ok(!visible(steps[steps.indexOf(landing) - 1], 'b_hi'), 'the landing is not revealed early');
  assert.ok(visible(waiting, 'b_hi'));
  assert.ok(!visible(waiting, 'c_hi'), 'a later movement keeps its own moment');
  assert.deepEqual(timingConflicts(steps), []);
  assert.deepEqual(record, original, 'the authored relation order is not rewritten');
});

test('Replay: a chain of needs resolves in turn', () => {
  // The claim needs b's landing; b's movement names c's landing as context.
  const steps = play(movements([claim('b_hi'), move('b', 'c_hi'), move('c'), move('a')]));
  assert.deepEqual(order(steps), [2, 1, 0, 3]);
  const [c, b, waiting] = [2, 1, 0].map(index => momentOf(steps, index));
  assert.ok(visible(c, 'c_hi') && !visible(c, 'b_hi'));
  assert.ok(visible(b, 'b_hi') && visible(b, 'c_hi'));
  assert.ok(visible(waiting, 'b_hi'));
  assert.ok(!visible(waiting, 'a_hi'));
  assert.deepEqual(timingConflicts(steps), []);
});

test('Replay: one relation with several anchors stays one moment after every movement it needs', () => {
  const steps = play(movements([claim('a_hi', 'c_hi'), move('a'), move('b'), move('c')]));
  assert.deepEqual(order(steps), [1, 2, 3, 0]);
  assert.equal(relationMoments(steps).filter(step => step.replayRelationIdentity.relationIndex === 0).length, 1);
  const waiting = momentOf(steps, 0);
  for (const id of ['a_hi', 'c_hi']) assert.ok(visible(waiting, id), id);
  assert.ok(!visible(momentOf(steps, 2), 'c_hi'), 'c\'s landing waits for its own movement');
  assert.deepEqual(timingConflicts(steps), []);
});

test('Replay: claims waiting for the same movement keep authored order', () => {
  const steps = play(movements([claim('c_hi'), claim('a'), claim('c_hi', 'b'), move('c')]));
  assert.deepEqual(order(steps), [1, 3, 0, 2]);
  assert.deepEqual(timingConflicts(steps), []);
});

test('Replay: movements needing each other\'s landing keep authored order with the timing diagnostic', () => {
  const record = movements([claim('a_hi'), move('a', 'b_hi'), move('b', 'a_hi'), move('c')]);
  const original = structuredClone(record), steps = play(record);
  assert.deepEqual(order(steps), [0, 1, 2, 3], 'the cycle and the claim needing it keep authored order');
  const [waiting, a, b] = [0, 1, 2].map(index => momentOf(steps, index));
  assert.ok(!visible(waiting, 'a_hi'), 'no landing is introduced early');
  assert.ok(visible(a, 'a_hi') && !visible(a, 'b_hi'));
  assert.ok(visible(b, 'b_hi'));
  assert.match(waiting.movementDiagnostics.join('\n'), /RELATION_TIMING_CONFLICT: Stage 2, relation 1 \(Observation\) requires a_hi before relation 2/);
  assert.match(a.movementDiagnostics.join('\n'), /RELATION_TIMING_CONFLICT: Stage 2, relation 2 \(Internal Merge\) has unavailable authored context: b_hi before relation 3/);
  assert.deepEqual(record, original);
});

test('saved relative pied-piping: two claims that each need the other keep authored order with the diagnostic', () => {
  // "This is the man to whom I gave the book." Stage 8: the neutral relative
  // Internal Merge builds cpRel and pp2 and names wh2; the recognized
  // operator-variable movement introduces wh2 inside pp2 and names cpRel.
  const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/unrecognized-movement.json', import.meta.url))).cases[2];
  const steps = buildReplayPlayback({ sentence: record.sentence, inputTokens: record.inputTokens, analyses: [record] }).steps;
  assert.deepEqual(relationMoments(steps, 7).map(step => step.replayRelationIdentity.relationIndex), [0, 1]);
  const [merge, dependency] = relationMoments(steps, 7);
  assert.ok(visible(merge, 'pp2') && visible(merge, 'cpRel'));
  assert.ok(!visible(merge, 'wh2'), 'wh2 is not introduced early');
  assert.ok(visible(dependency, 'wh2'));
  assert.match(merge.movementDiagnostics.join('\n'),
    /RELATION_TIMING_CONFLICT: Stage 8, relation 1 \(relative Internal Merge\) requires wh2 before relation 2/);
});
