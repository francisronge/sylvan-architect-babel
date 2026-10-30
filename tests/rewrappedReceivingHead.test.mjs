import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import * as invariants from './helpers/replayInvariants.mjs';
import { checkMarkPersistence, checkStepSemantics } from './helpers/replayStepInvariants.mjs';
import { canonicalId } from './helpers/canonicalIds.mjs';

// A receiving head that keeps its id while a new inner head re-wraps its old
// daughters: I⁰ 'inflection' [agreement, present] becomes
// [inflectionBase [agreement, present], verb]. The shape is Sol's isiZulu
// "Abafana bayadlala ibhola." (sol-parts-20261026, n3-22-zu-noun-class a1,
// stage 3), reduced to the head movement. The inner head is part of the
// movement's landing, so the moment shows it with the moved verb instead of a
// never-authored three-daughter I⁰, and no later step reveals it.
const node = (id, label, children, extra = {}) => ({ id, label, ...extra, ...(children ? { children } : {}) });
const inflectionBefore = () => [node('agreement', 'Agr⁰', null, { silent: true }), node('present', 'T⁰', null, { silent: true })];
const record = {
  sentence: 'Mia sings.',
  inputTokens: ['Mia', 'sings'],
  derivationStages: [{
    statement: 'Build the clause.',
    stageRecord: 'Merge the verb phrase with I, whose agreement and tense heads are silent, and the subject.',
    relations: [],
    workspaceForest: [node('ip', 'IP', [node('subject', 'NP', null, { word: 'Mia' }), node('ibar', 'I′', [
      node('inflection', 'I⁰', inflectionBefore()),
      node('vp', 'VP', [node('verb', 'V⁰', null, { word: 'sings', lineageId: 'verb-chain' })])])])]
  }, {
    statement: 'Raise the verb to I.',
    stageRecord: 'The verb adjoins to I; the former I becomes the inner head of the complex.',
    // A later claim of the stage restates the verb chain, as Sol's did, so the
    // movement does not own the whole stage difference alone.
    relations: [{ relation: 'V-to-I-head-movement', anchors: { movedHead: 'verb', trace: 'verbTrace', landingHead: 'inflection' } },
      { relation: 'trace-government', anchors: { raisedGovernor: 'verb', governorTrace: 'verbTrace' }, priorAnchors: { governor: 'verb' } }],
    workspaceForest: [node('ip', 'IP', [node('subject', 'NP', null, { word: 'Mia' }), node('ibar', 'I′', [
      node('inflection', 'I⁰', [node('inflectionBase', 'I⁰', inflectionBefore()), node('verb', 'V⁰', null, { word: 'sings', lineageId: 'verb-chain' })]),
      node('vp', 'VP', [node('verbTrace', 'V⁰', null, { silent: true, lineageId: 'verb-chain' })])])])]
  }]
};

test('a re-wrapped receiving head shows its new inner head at the movement', () => {
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
  const steps = replay.playbackSteps;
  // The verb's lower occurrence, authored verbTrace, as Replay names it (the source keeps "verb").
  const lower = canonicalId(replay, 'verbTrace', 1);
  const moment = steps.findIndex(step => step.replayKind === 'relation' && (step.replayRelationLinks ?? [])
    .some(link => link.renderFamily === 'trajectory' && link.priorSourceNodeId === 'verb' && link.witnessNodeId === lower));
  assert.ok(moment > 0, 'the head movement has its moment');
  assert.ok(!steps[moment - 1].replayVisibleNodeIds.includes('inflectionBase'), 'the inner head waits for the movement');
  assert.ok(steps[moment].replayVisibleNodeIds.includes('inflectionBase'), 'the movement shows the inner head');
  const structural = Object.entries(invariants)
    .filter(([name, check]) => typeof check === 'function' && /^check/.test(name) && !['checkInputUnchanged', 'checkOneLetterPerLabel'].includes(name))
    .flatMap(([, check]) => check(replay, record));
  const violations = [...structural, ...checkStepSemantics(replay, record), ...checkMarkPersistence(replay, record)];
  assert.deepEqual(violations.map(violation => `${violation.rule}${violation.subtype ? `:${violation.subtype}` : ''} ${violation.frame} ${violation.detail}`), []);
});
