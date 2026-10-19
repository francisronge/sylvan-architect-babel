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
const move = id => ({ relation: 'Internal Merge', anchors: { lowerCopy: id, higherCopy: `${id}_hi` }, priorAnchors: { source: id } });
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
  // "What did Mia see?" with a claim on the wh landing authored first: the claim
  // needs wh-movement's landing, and wh-movement needs the C′ that the
  // auxiliary head movement builds.
  const bundle = JSON.parse(fs.readFileSync(new URL('../fixtures/normalized/what-did-mia-see.xbar.json', import.meta.url)));
  const analysis = structuredClone(bundle.analyses[0]);
  analysis.derivationStages[3].relations.unshift({ relation: 'Question operator', anchors: { operator: 'dp_what_high' } });
  const original = structuredClone(analysis);
  const steps = buildReplayPlayback({ ...bundle, analyses: [analysis] }).steps;
  const stage = relationMoments(steps, 3);
  assert.deepEqual(stage.map(step => step.replayRelationIdentity.relationIndex), [2, 1, 0]);
  const [head, phrase, claim] = stage;
  assert.ok(visible(head, 'cbar_question') && !visible(head, 'dp_what_high'));
  assert.ok(visible(phrase, 'dp_what_high') && visible(phrase, 'cp_question'));
  assert.ok(visible(claim, 'dp_what_high'));
  assert.ok(!visible(steps[steps.indexOf(head) - 1], 'cbar_question'), 'nothing is introduced early');
  assert.deepEqual(timingConflicts(steps), []);
  assert.deepEqual(analysis, original);
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

test('Replay: relations needing each other\'s syntax keep authored order with the timing diagnostic', () => {
  // Icelandic stage 3: continued V-to-I needs iFeatures3, which I-to-C
  // introduces, and I-to-C needs iComplex3, which continued V-to-I introduces.
  // The theta-role claim before them needs v3 from that cycle.
  const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/case-source-transfer.json', import.meta.url)));
  const original = structuredClone(record);
  const steps = buildReplayPlayback({ sentence: record.sentence, inputTokens: record.inputTokens, analyses: [record] }).steps;
  const stage = relationMoments(steps, 2);
  assert.deepEqual(stage.slice(0, 3).map(step => step.replayRelationIdentity.relationIndex), [0, 1, 2]);
  const [theta, continued, raising] = stage;
  for (const step of [theta, continued]) assert.ok(!visible(step, 'iFeatures3'), 'no syntax is introduced early');
  assert.ok(visible(raising, 'iFeatures3'));
  assert.match(theta.movementDiagnostics.join('\n'), /RELATION_TIMING_CONFLICT: Stage 3, relation 1 \(theta-role assignment\) requires v3 before relation 2/);
  assert.match(continued.movementDiagnostics.join('\n'), /RELATION_TIMING_CONFLICT: Stage 3, relation 2 .* requires iFeatures3 before relation 3/);
  assert.deepEqual(record, original);
});

test('saved relative pied-piping: the Internal Merge naming wh2 plays right after the movement that introduces it', () => {
  // "This is the man to whom I gave the book." Stage 8: the neutral relative
  // Internal Merge builds cpRel and pp2 and names wh2, which the recognized
  // operator-variable movement introduces. That movement names cpRel only as
  // context, so it does not wait and its missing context stays diagnosed.
  const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/unrecognized-movement.json', import.meta.url))).cases[2];
  const original = structuredClone(record);
  const steps = buildReplayPlayback({ sentence: record.sentence, inputTokens: record.inputTokens, analyses: [record] }).steps;
  const [dependency, merge] = relationMoments(steps, 7);
  assert.deepEqual([dependency, merge].map(step => step.replayRelationIdentity.relationIndex), [1, 0]);
  assert.equal(steps.indexOf(merge), steps.indexOf(dependency) + 1);
  assert.ok(!visible(steps[steps.indexOf(dependency) - 1], 'wh2'), 'wh2 is not introduced early');
  assert.ok(visible(dependency, 'wh2'));
  assert.ok(!visible(dependency, 'pp2') && !visible(dependency, 'cpRel'), 'the Internal Merge keeps its own new parents');
  for (const id of ['wh2', 'pp2', 'cpRel']) assert.ok(visible(merge, id), id);
  assert.ok(!merge.movementDiagnostics?.some(message => message.startsWith('RELATION_TIMING_CONFLICT')));
  assert.match(dependency.movementDiagnostics.join('\n'),
    /RELATION_TIMING_CONFLICT: Stage 8, relation 2 \(relative operator-variable dependency\) has unavailable authored context: cpRel/);
  assert.deepEqual(record, original);
});
