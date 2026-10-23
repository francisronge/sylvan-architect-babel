import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { orderRelationMoments } from '../replay/relationMomentOrder.ts';
import { piedPipedPhrase } from '../replay/treeTransitions.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { checkLandingAttached } from './helpers/replayInvariants.mjs';

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

test('saved relative pied-piping: the relative Internal Merge moves the PP, and the operator-variable dependency follows it', () => {
  // "This is the man to whom I gave the book." Stage 8: the relative Internal
  // Merge moves pp1 from the vP edge to pp2. "to whom" moves together: pp2's
  // daughters p2 and wh2 and the CP it joins appear whole at that movement's
  // moment, with its arrow. The operator-variable dependency names wh2, which
  // was carried inside the PP, and wh0 in the base position; it is a binding,
  // not a second movement, so it draws no arrow from the base and plays after
  // the movement that introduces its operator.
  const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/unrecognized-movement.json', import.meta.url))).cases[2];
  const original = structuredClone(record);
  const prepared = prepareReplay({ ...structuredClone(record), includePlayback: true }), steps = prepared.playbackSteps;
  assert.deepEqual(checkLandingAttached(prepared), []);
  const [merge, dependency] = relationMoments(steps, 7);
  assert.deepEqual([merge, dependency].map(step => step.replayRelationIdentity.relationIndex), [0, 1]);
  const before = steps[steps.indexOf(merge) - 1];
  for (const id of ['pp2', 'p2', 'wh2', 'cpRel']) {
    assert.ok(!visible(before, id), `${id} is not introduced early`);
    assert.ok(visible(merge, id), `${id} appears with the landing`);
  }
  for (const id of ['wh2', 'wh0', 'cpRel', 'pp0']) assert.ok(visible(dependency, id), `the dependency's ${id} is present at its moment`);
  const paths = prepared.relationRenderPlan.frames[7].items.filter(item => item.kind === 'trajectory' && item.relationRef.stageIndex === 7);
  assert.deepEqual(paths.map(item => [item.relationRef.relationIndex, item.sourceNodeId, item.targetNodeId]), [[0, 'pp1', 'pp2']]);
  assert.deepEqual(timingConflicts(steps.filter(step => step.replayFrameIndex === 7)), []);
  assert.deepEqual(record, original);
});

test('sideward movement into a new workspace pied-pipes nothing: its receiving verb keeps its own selection', () => {
  // "Which report did Nora file without reading?" Stage 2: the copy a_fdp
  // merges with a_file in the new root a_fvp, which joins no preceding
  // structure, so a_file is independently selected material, not a phrase
  // that moves with the landing.
  const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/workspace-historical-continuity.json', import.meta.url))).cases[2];
  const steps = prepareReplay({ ...structuredClone(record), includePlayback: true }).playbackSteps;
  const [sideward] = relationMoments(steps, 1), at = steps.indexOf(sideward);
  const selection = steps.findIndex(step => step.replayFrameIndex === 1 && step.replayKind === 'micro' && step.targetNodeId === 'a_file');
  assert.ok(selection >= 0 && selection < at, 'a_file is projected by its own step before the sideward moment');
  assert.ok(visible(sideward, 'a_fvp') && visible(sideward, 'a_fdp'));
});

test('only material that stood with the moved phrase before it moved is pied-piped', () => {
  const leaf = (id, label, word) => ({ id, label, word });
  const node = (id, label, ...children) => ({ id, label, children });
  // Before: [CP C [TP ... [PP P "to" DP "whom"]]]; the PP moves to the edge of CP.
  const previous = [node('cp', 'CP', leaf('c', 'C', ''), node('tp', 'TP', node('pp1', 'PP', leaf('p1', 'P', 'to'), leaf('wh1', 'DP', 'whom'))))];
  const current = (sister) => [node('cp2', 'CP', node('pp2', 'PP', sister, leaf('wh2', 'DP', 'whom')),
    node('cbar', 'C′', leaf('c', 'C', ''), node('tp', 'TP', node('pp1', 'PP', leaf('p1', 'P', ''), leaf('wh1', 'DP', '')))))];
  // "to" stood with "whom" before it moved, so the movement brings it along.
  assert.deepEqual(piedPipedPhrase(current(leaf('p2', 'P', 'to')), previous, 'wh2', ['wh1']), { hostIds: ['pp2'], nodeIds: ['p2'] });
  // A new adverb at the landing did not stand with "whom": it keeps its own step.
  assert.deepEqual(piedPipedPhrase(current(leaf('adv', 'Adv', 'only')), previous, 'wh2', ['wh1']), { hostIds: [], nodeIds: [] });
  // Without the moved phrase's earlier position there is no evidence of pied-piping.
  assert.deepEqual(piedPipedPhrase(current(leaf('p2', 'P', 'to')), previous, 'wh2', []), { hostIds: [], nodeIds: [] });
});
