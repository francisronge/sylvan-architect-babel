import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkRelationMoments, frameStructure } from './helpers/replayInvariants.mjs';
import { checkMarkPersistence, checkStepSemantics } from './helpers/replayStepInvariants.mjs';

// GPT-6.1 Sol (Codex qualification batch sol-120-20261026, n4-24) moved a relative
// operator to Spec-IP inside the subject, and in the same stage raised that
// subject, authoring the operator's chain first. Both moved phrases keep their
// ids. The operator lands inside the subject's relocated phrase, so its moment
// waits for the subject's: before it, Replay showed the operator chain's moment
// with no change, and the operator then jumped with the subject at the later moment.
const leaf = (id, label, word, extra = {}) => ({ id, label, children: [], ...(word === null ? { silent: true } : { word }), ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const subject = (opPhrase, opTrace) => node('dp', 'DP', [leaf('d', 'D', 'the'), node('np', 'NP', [leaf('n', 'N', 'student'),
  node('cp', 'CP', [node('cbar', "C'", [leaf('c', 'C', null),
    node('tp2', 'TP', [...opPhrase ? [opPhrase] : [], node('tbar2', "T'", [leaf('t2', 'T', null),
      node('vp2', 'VP', [opTrace, node('vbar2', "V'", [leaf('v2', 'V', 'wrote')])])])])])])])], { lineageId: 'student' });
const operator = node('op', 'DP', [leaf('who', 'D', 'who')], { lineageId: 'operator' });
const stages = [
  { statement: 'Build the clause with the subject and the relative operator in their base positions.',
    stageRecord: 'Base positions.', relations: [{ relation: 'theta-assignment', anchors: { predicate: 'v', argument: 'dp' } }],
    workspaceForest: [node('tp', 'TP', [node('tbar', "T'", [leaf('t', 'T', null),
      node('vp', 'VP', [subject(null, operator), node('vbar', "V'", [leaf('v', 'V', 'left')])])])])] },
  { statement: 'Move the relative operator to Spec-TP of the relative clause and raise the subject.',
    stageRecord: 'Operator and subject movement.', relations: [
      { relation: 'operator-chain', anchors: { operator: 'op', trace: 'optrace' } },
      { relation: 'subject-chain', anchors: { subject: 'dp', trace: 'dptrace' } }],
    workspaceForest: [node('tp', 'TP', [subject(operator, leaf('optrace', 'DP', null, { lineageId: 'operator' })),
      node('tbar', "T'", [leaf('t', 'T', null), node('vp', 'VP', [leaf('dptrace', 'DP', null, { lineageId: 'student' }),
        node('vbar', "V'", [leaf('v', 'V', 'left')])])])])] }
];
const record = { sentence: 'the student who wrote left', derivationStages: stages };

test('a movement landing inside a phrase that a later movement of its stage relocates plays right after that movement', () => {
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true }), steps = replay.playbackSteps;
  const momentOf = relationIndex => steps.findIndex(step => step.replayKind === 'relation'
    && step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity?.relationIndex === relationIndex);
  const operatorMoment = momentOf(0), subjectMoment = momentOf(1);
  assert(subjectMoment > 0 && operatorMoment === subjectMoment + 1, `the operator chain (${operatorMoment}) plays right after the subject chain (${subjectMoment})`);
  const parentOf = (index, id) => frameStructure(steps[index]).parent.get(id);
  assert.equal(parentOf(subjectMoment, 'dp'), 'tp', 'the subject lands at its own moment');
  assert.equal(parentOf(subjectMoment, 'op'), 'vp2', 'the operator keeps its preceding position inside the moved subject');
  assert.equal(parentOf(operatorMoment, 'op'), 'tp2', 'the operator lands at its own moment');
  assert(!steps[subjectMoment].replayVisibleNodeIds.includes('optrace') && steps[operatorMoment].replayVisibleNodeIds.includes('optrace'),
    'the operator chain introduces its lower occurrence');
  for (const relationIndex of [0, 1]) assert(replay.relationRenderPlan.frames[1].items.some(item => item.kind === 'trajectory'
    && item.relationRef.relationIndex === relationIndex), `relation 1:${relationIndex} draws its path`);
  assert.deepEqual([...checkRelationMoments(replay, record), ...checkStepSemantics(replay, record), ...checkMarkPersistence(replay, record)], []);
});

test('relation-moments still reports a relation that plays after a later relocating movement without a landing inside it', () => {
  const withCase = structuredClone(record);
  withCase.derivationStages[1].relations.unshift({ relation: 'Case-assignment', anchors: { assigner: 't2', recipient: 'op' } });
  const replay = prepareReplay({ ...structuredClone(withCase), includePlayback: true });
  const momentOf = (steps, relationIndex) => steps.findIndex(step => step.replayKind === 'relation'
    && step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity?.relationIndex === relationIndex);
  assert(momentOf(replay.playbackSteps, 0) < momentOf(replay.playbackSteps, 2), 'the Case claim keeps its authored position');
  assert.deepEqual(checkRelationMoments(replay, withCase), []);
  // Play the Case claim's moment after the subject's, changing nothing: its
  // anchors move with the subject but are not introduced, so it had nothing to wait for.
  const steps = [...replay.playbackSteps], [caseStep] = steps.splice(momentOf(steps, 0), 1);
  const subjectMoment = momentOf(steps, 2);
  steps.splice(subjectMoment + 1, 0, { ...steps[subjectMoment], replayRelationIdentity: caseStep.replayRelationIdentity });
  assert.deepEqual(checkRelationMoments({ ...replay, playbackSteps: steps }, withCase).map(finding => finding.detail),
    ['relation 1:0 plays after later authored relation 1:2 without waiting for syntax it introduces']);
});
