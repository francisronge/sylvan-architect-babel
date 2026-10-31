import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';
import { convertSpelloutPayload } from '../server/babelParser/spellout.js';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { planSpelloutAttempts } from '../contractQualification/spelloutArtifacts.js';
import { createTreeBankBundleSnapshot, loadTreeBankBundleSnapshot } from '../treeBankSnapshot.js';
import { treeLabelRunsForStep } from '../replay/treeLabelRuns.ts';
import { plaqueIdentity } from '../replay/relations/plaquePlacement.ts';
import { checkOneLetterPerLabel, checkPlanIdentityUnique } from './helpers/replayInvariants.mjs';
import { checkMovementUnrendered } from './helpers/replayContractWarnings.mjs';

/* Defects of the 29 October 2026 held-out batch and the 30 October confirmation
 * batch, each reproduced from its saved analysis (tests/helpers/heldoutDefectRecords.json). */

const records = JSON.parse(readFileSync(new URL('./helpers/heldoutDefectRecords.json', import.meta.url), 'utf8'));
const prepare = key => {
  const { sentence, inputTokens, derivationStages } = records[key];
  return prepareReplay({ sentence, inputTokens, derivationStages: structuredClone(derivationStages), includePlayback: true });
};
const runsAt = (replay, step) => treeLabelRunsForStep(replay, step - 1, undefined, { includeRelationIndices: true });

test('Opus h1-030: a leaf labelled I with the word i shows its category above its word', () => {
  const replay = prepare('opus-h1-030-a1'), last = replay.playbackSteps.length;
  const runs = runsAt(replay, last);
  assert.deepEqual(runs.get('i1')?.map(run => [run.kind, run.text]), [['category', 'I']]);
  assert.deepEqual(runs.get('i1::__leaf')?.map(run => [run.kind, run.text]), [['terminal', 'i']]);
});

test('Opus h1-014: the words of a moved wh-phrase carry no operator-variable link number', () => {
  // The binding painter letters the operator and its variable; the words of
  // [DP Which cake]₂ used to show the link's position among the stage's links.
  const replay = prepare('opus-h1-014-a1');
  assert.equal(replay.playbackSteps.length, 102);
  for (const step of [101, 102]) for (const includeRelationIndices of [true, false]) {
    const runs = treeLabelRunsForStep(replay, step - 1, undefined, { includeRelationIndices });
    assert.deepEqual([...new Set(runs.get('D_which::__leaf').map(run => run.text))], ['Which'], `step ${step}`);
    assert.deepEqual([...new Set(runs.get('N_cake::__leaf').map(run => run.text))], ['cake'], `step ${step}`);
    assert.deepEqual([...new Set(runs.get('DP_wh').map(run => run.text))], ['DP₂'], `step ${step}`);
    assert.deepEqual([...new Set(runs.get('I1::__leaf').map(run => run.text))], ['did₃'], `step ${step}`);
  }
});

test('Sol h1-070: a theta letter and an equal binding letter on one trace show the letter once', () => {
  // The allocator gives the argument rop the letter i of its relative chain, so
  // its theta letter and the operator-variable letter are one index; from step
  // 44 the label read ropᵢᵢ. The binding letter now decorates the label that
  // already writes it, as it does for a written subscript.
  for (const key of ['sol-h1-070-a1', 'sol-h1-070-a2']) assert.deepEqual(checkOneLetterPerLabel(prepare(key)), [], key);
});

test('Opus h1-093: a word that spells its token across a space times alike on every load path, never at an unrelated relation', () => {
  // Erg1's word inw spells the token "in w". The spelling conversion records
  // that as a single-leaf group; it used to add it to the final stage only, so
  // Replay reported REALIZATION_MISSING_OWNER and activated it at the stage's
  // last relation, which says nothing about it.
  const { sentence, authoredPayload } = records['opus-h1-093-a1'];
  const [converted] = convertSpelloutPayload(structuredClone(authoredPayload), sentence);
  assert.ok(converted.ok, JSON.stringify(converted.diagnostics));
  const group = { nodeIds: ['Erg1'], tokenIndices: [1] }, key = JSON.stringify(group);
  assert.deepEqual(converted.spellingGroups, [group]);
  // Erg1 first stands, pronounced inw, in stage 7.
  assert.deepEqual(converted.analysis.derivationStages.map(stage => (stage.realizations ?? []).some(entry => JSON.stringify(entry) === key)),
    [false, false, false, false, false, false, true, true]);
  const live = normalizeParseBundle(structuredClone(authoredPayload), 'minimalism', sentence, 'claude', true, { spellout: true });
  const [attempt] = planSpelloutAttempts(authoredPayload, [converted]).attempts;
  const qualification = normalizeParseBundle(structuredClone(attempt.payload), 'minimalism', sentence, 'claude', true,
    { inputTokens: attempt.inputTokens });
  const saved = loadTreeBankBundleSnapshot(createTreeBankBundleSnapshot({ ...live, sentence }));
  const timing = bundle => buildReplayPlayback({ ...bundle, sentence, inputTokens: bundle.inputTokens ?? converted.inputTokens }).steps
    .map(step => [(step.replayRealizations ?? []).some(entry => JSON.stringify(entry) === key), step.replayRealizationDiagnostics ?? []]);
  const expected = timing(live);
  assert.deepEqual(timing(qualification), expected, 'qualification normalization');
  assert.deepEqual(timing(saved), expected, 'Tree Bank snapshot');
  assert.deepEqual(expected.flatMap(([, diagnostics]) => diagnostics), []);
  // It turns on only where a stage starts or at a relation that covers Erg1.
  const steps = buildReplayPlayback({ ...live, sentence }).steps;
  const stages = live.analyses[0].derivationStages;
  steps.forEach((step, index) => {
    if (!expected[index][0] || expected[index - 1]?.[0] || steps[index - 1]?.replayFrameIndex !== step.replayFrameIndex) return;
    const relation = stages[step.replayFrameIndex].relations[step.replayRelationIdentity?.relationIndex];
    assert.ok(step.replayKind === 'relation' && Object.values(relation.anchors).flat().includes('Erg1'), `step ${index + 1}`);
  });
  // The saved record, which holds the group in the final stage only, has it from that stage's start.
  const old = prepare('opus-h1-093-a1');
  assert.deepEqual(old.playbackSteps.flatMap(step => step.replayRealizationDiagnostics ?? []), []);
  old.playbackSteps.forEach((step, index) => assert.equal((step.replayRealizations ?? []).some(entry => JSON.stringify(entry) === key),
    step.replayFrameIndex === 7, `saved step ${index + 1}`));
});

test('Sol c1-013: a relation recovered as Case and as agreement with the same Case draws one Case path', () => {
  // wil agrees with jan and licenses its Case. Both recoveries drew the same
  // nominative path and plaque under one identity, and from frame 19 one
  // plaque took its twin's pocket. The agreement claim owns every authored
  // item of the Case claim, so it alone draws.
  const replay = prepare('sol-c1-013-a1');
  assert.deepEqual(checkPlanIdentityUnique(replay), []);
  const paths = (stageIndex, from) => replay.relationRenderPlan.frames[stageIndex].items
    .filter(item => item.kind === 'directed-path' && item.relationRef.stageIndex === stageIndex && item.fromNodeId === from)
    .map(item => `${item.pathStyle} ${item.toNodeId}`);
  assert.deepEqual(paths(3, 'wil').filter(path => path.startsWith('case-assignment')), ['case-assignment jan']);
  assert.deepEqual(paths(8, 'mt').filter(path => path.startsWith('case-assignment')), ['case-assignment ik']);
});

test('Sol c1-028: a fused head landing over a VP the same stage built draws its head movement', () => {
  // In bare labels látta moves from V to v as the fused head v+V, which
  // projects v over a VP that the same stage first joined with the locative
  // adjunct. That complement did not exist before the stage, so no landing
  // was read and the V-to-v hop drew nothing (MOVEMENT_CONTEXT_UNRESOLVED).
  for (const [key, source, landing] of [['sol-c1-028-a1', 'fV', 'fvHead'], ['sol-c1-028-a2', 'tV', 'tvHead']]) {
    const replay = prepare(key), record = records[key];
    const hops = replay.relationRenderPlan.frames.flatMap(frame => frame.items)
      .filter(item => item.kind === 'trajectory' && item.relationRef.stageIndex === 1 && item.relationRef.relationIndex === 3)
      .map(item => `${item.trajectoryKind} ${item.sourceNodeId}->${item.targetNodeId}`);
    assert.deepEqual([...new Set(hops)], [`head ${source}->${landing}`], key);
    assert.deepEqual(checkMovementUnrendered(replay, record), [], key);
  }
});

test('marks that request no plaque may share an identity, as two trajectories to one shared landing do', () => {
  const { sentence, inputTokens, analyses } = JSON.parse(readFileSync(new URL('../fixtures/movement/shared-landing.json', import.meta.url), 'utf8'));
  const replay = prepareReplay({ sentence, inputTokens, derivationStages: structuredClone(analyses[0].derivationStages), includePlayback: true });
  const shared = replay.relationRenderPlan.frames.some(frame => {
    const identities = frame.items.map(plaqueIdentity);
    return identities.length !== new Set(identities).size;
  });
  assert.equal(shared, true, 'the fixture still has marks sharing an identity');
  assert.deepEqual(checkPlanIdentityUnique(replay), []);
});
