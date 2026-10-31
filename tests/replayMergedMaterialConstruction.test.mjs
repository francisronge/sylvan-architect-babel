import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkRelationConstruction, frameStructure } from './helpers/replayInvariants.mjs';
import { checkStepSemantics } from './helpers/replayStepInvariants.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/merged-material-construction.json', import.meta.url), 'utf8'));
const compile = record => prepareReplay({ ...structuredClone(record), includePlayback: true });
const play = index => compile(fixture.cases[index]);
const moment = (steps, stageIndex, relationIndex) => {
  const index = steps.findIndex(step => step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === stageIndex
    && step.replayRelationIdentity.relationIndex === relationIndex);
  assert.ok(index >= 0, `relation ${stageIndex}:${relationIndex} has a moment`);
  return index;
};
const firstShown = (steps, id) => steps.findIndex(step => frameStructure(step).displayed.has(id));
const describeStep = (steps, index) => `frame ${index + 1} (${steps[index]?.replayKind} ${steps[index]?.operation} ${steps[index]?.targetNodeId})`;
/** A node first appears at the construction step that builds it. */
const assertBuiltByOwnStep = (steps, id, operation) => {
  const index = firstShown(steps, id), step = steps[index];
  assert.equal(step?.replayKind, 'micro', `${id} first appears at ${describeStep(steps, index)}`);
  assert.ok([id, `${id}::__leaf`].includes(step.targetNodeId), `${id} first appears at ${describeStep(steps, index)}`);
  if (operation) assert.equal(step.operation, operation, `${id} first appears at ${describeStep(steps, index)}`);
};
/** A claim's moment shows the same syntax as the step before it. */
const assertMomentAddsNothing = (steps, at) => {
  const before = frameStructure(steps[at - 1]), after = frameStructure(steps[at]);
  assert.deepEqual([...after.displayed].filter(id => !before.displayed.has(id)), [], `${describeStep(steps, at)} adds no syntax`);
  assert.deepEqual([...after.displayed].filter(id => before.displayed.has(id) && before.parent.get(id) !== after.parent.get(id)), [],
    `${describeStep(steps, at)} attaches nothing`);
};
const emptySteps = (replay, record, stageIndex) => checkStepSemantics(replay, record)
  .filter(found => found.subtype === 'empty-step' && replay.playbackSteps[found.frame - 1].replayFrameIndex === stageIndex)
  .map(found => `frame ${found.frame}: ${found.detail}`);

test('an occurrence shared across conjuncts is selected and merged in its own conjunct, not at the identity claim', () => {
  const record = fixture.cases[0], replay = play(0), steps = replay.playbackSteps;
  for (const [stageIndex, copy, phrase] of [[1, 'whatSellObject', 'sellVP'], [4, 'didSell', 'sellTProjection']]) {
    assertBuiltByOwnStep(steps, copy);
    assertBuiltByOwnStep(steps, phrase, 'ExternalMerge');
    const at = moment(steps, stageIndex, 0);
    assert.ok(firstShown(steps, phrase) < at, `${phrase} is merged before the identity claim names its occurrence`);
    assertMomentAddsNothing(steps, at);
    assert.deepEqual(emptySteps(replay, record, stageIndex), [], `stage ${stageIndex + 1} has no empty construction step`);
  }
});

test('an occurrence shared across conjuncts stays with construction when the stage also joins the conjuncts beneath one root', () => {
  const record = fixture.cases[2], replay = play(2), steps = replay.playbackSteps;
  assertBuiltByOwnStep(steps, 'whatSellObject');
  for (const phrase of ['sellVP', 'vpCoordinationLower', 'vpCoordination']) assertBuiltByOwnStep(steps, phrase, 'ExternalMerge');
  const at = moment(steps, 1, 0);
  assert.ok(firstShown(steps, 'vpCoordination') < at, 'the coordination is merged before the identity claim names its occurrences');
  assertMomentAddsNothing(steps, at);
  assert.deepEqual(emptySteps(replay, record, 1), [], 'stage 2 has no empty construction step');
});

test('a phrase whose boundary a realization claim describes is merged by its own step before both claims', () => {
  const record = fixture.cases[1], replay = play(1), steps = replay.playbackSteps;
  assertBuiltByOwnStep(steps, 'song-dp', 'ExternalMerge');
  const restriction = moment(steps, 1, 0), realization = moment(steps, 1, 1);
  assert.ok(firstShown(steps, 'song-dp') < restriction, 'the restriction claim finds its result built');
  [restriction, realization].forEach(at => assertMomentAddsNothing(steps, at));
  assert.deepEqual(steps.filter(step => step.replayFrameIndex === 1).flatMap(step => step.movementDiagnostics ?? []), [],
    'no claim waits for structure another claim was building');
  assert.deepEqual(emptySteps(replay, record, 1), []);
});

/* Synthetic end-to-end controls. */

const leaf = (id, label, extra = {}) => ({ id, label, children: [], ...extra });
const branch = (id, label, ...children) => ({ id, label, children });
const words = forest => forest.flatMap(node => node.children?.length ? words(node.children) : node.word && !node.silent ? [node.word] : []);
const twoStages = (before, after, relations) => ({ sentence: words(after).join(' '), derivationStages: [
  { statement: 'Preceding state', stageRecord: 'The earlier material is built.', relations: [], workspaceForest: before },
  { statement: 'Completed state', stageRecord: 'The stage is complete.', relations, workspaceForest: after }] });
const firstStepOf = (steps, id) => {
  const index = firstShown(steps, id);
  return steps[index].replayKind === 'relation' ? `relation ${steps[index].replayRelationIdentity.relationIndex}` : `${steps[index].operation} ${steps[index].targetNodeId}`;
};

test('a repeat of an occurrence\'s material is its claim\'s copy only inside the syntactic object that holds the occurrence', () => {
  const object = () => leaf('old', 'D', { word: 'it', lineageId: 'shared' });
  const verb = id => leaf(id, 'V', { word: id });
  const claim = [{ relation: 'shared occurrence', anchors: { first: 'old', second: 'new' } }];
  const apart = compile(twoStages([object(), verb('buy'), verb('sell')], [branch('buyVP', 'VP', verb('buy'), object()),
    branch('sellVP', 'VP', verb('sell'), leaf('new', 'D', { word: 'it', lineageId: 'shared' }))], claim)).playbackSteps;
  assert.deepEqual(['new::__leaf', 'new', 'sellVP'].map(id => firstStepOf(apart, id)),
    ['LexicalSelect new', 'LexicalSelect new', 'ExternalMerge sellVP'], 'it is selected with its D, then merged with sell');
  assertMomentAddsNothing(apart, moment(apart, 1, 0));
  // Joining the conjuncts gives the repeat its occurrence's root, but it was
  // still merged with sell, not beside an object that holds the occurrence.
  const joined = compile(twoStages([object(), verb('buy'), verb('sell')], [branch('both', '&P', branch('buyVP', 'VP', verb('buy'), object()),
    branch('sellVP', 'VP', verb('sell'), leaf('new', 'D', { word: 'it', lineageId: 'shared' })))], claim)).playbackSteps;
  assert.deepEqual(['new::__leaf', 'new', 'sellVP', 'both'].map(id => firstStepOf(joined, id)),
    ['LexicalSelect new', 'LexicalSelect new', 'ExternalMerge sellVP', 'ExternalMerge both']);
  assertMomentAddsNothing(joined, moment(joined, 1, 0));
  const remerged = twoStages([branch('vp', 'VP', verb('buy'), object())], [branch('top', 'XP',
    leaf('new', 'D', { word: 'it', lineageId: 'shared' }), branch('vp', 'VP', verb('buy'), object()))], claim);
  const inside = compile(remerged);
  assert.deepEqual(['new', 'top'].map(id => firstStepOf(inside.playbackSteps, id)), ['relation 0', 'relation 0'],
    'a copy re-merged inside its occurrence\'s object stays the claim\'s, with the parent that attaches it');
  assert.deepEqual(checkRelationConstruction(inside, remerged), [], 'that re-merge is displacement');
});

test('a claim whose prior anchors are only merged leaves their phrase to construction, and one that changes them keeps it', () => {
  const pieces = () => [leaf('det', 'D', { word: 'that' }), leaf('noun', 'N', { word: 'song' })];
  const claim = [{ relation: 'boundary realization', anchors: { first: 'det', second: 'noun', domain: 'dp' }, priorAnchors: { first: 'det', second: 'noun' } }];
  const merged = compile(twoStages(pieces(), [branch('dp', 'DP', ...pieces())], claim)).playbackSteps;
  assert.equal(firstStepOf(merged, 'dp'), 'ExternalMerge dp');
  assertMomentAddsNothing(merged, moment(merged, 1, 0));
  const [det, noun] = pieces();
  const changed = compile(twoStages([branch('np', 'NP', det, noun)], [branch('dp', 'DP', structuredClone(det), structuredClone(noun))],
    claim)).playbackSteps;
  assert.equal(firstStepOf(changed, 'dp'), 'relation 0', 'inputs that leave their parent are the claim\'s rewrite');
});
