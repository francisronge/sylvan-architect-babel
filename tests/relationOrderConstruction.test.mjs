import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import {
  checkAttachAtMerge, checkLandingAttached, checkNoEarlyReveal, checkParentAfterChildren, checkRelationConstruction,
  checkRelationMoments, checkStableConstruction, checkStageCompletion
} from './helpers/replayInvariants.mjs';

/* Authored relation order decides moment order, never whether construction
 * builds forward. Each case authors one stage's relations in an order that
 * once broke construction and expects the guarantees every order has. */

const corpus = loadFixtureAnalyses();
const fixture = id => structuredClone(corpus.records.find(entry => entry.id === id).record);
const reorder = (record, stage, order) => {
  const relations = record.derivationStages[stage].relations;
  record.derivationStages[stage].relations = order.map(index => relations[index]);
  return record;
};
const prepare = record => prepareReplay({ ...structuredClone(record), includePlayback: true });
const CHECKS = [checkLandingAttached, checkNoEarlyReveal, checkParentAfterChildren, checkRelationMoments,
  checkStableConstruction, checkAttachAtMerge, checkRelationConstruction, checkStageCompletion];
const violations = (replay, record) => CHECKS.flatMap(check => check(replay, record))
  .map(violation => `${violation.rule}@${violation.frame}: ${violation.detail}`);
const stageSteps = (replay, stage) => replay.playbackSteps.filter(step => step.replayFrameIndex === stage);
const relationMoment = (steps, relationIndex) => steps.findIndex(step => step.replayKind === 'relation'
  && step.replayRelationIdentity.relationIndex === relationIndex);
// Category names are open: renaming them changes no visibility.
const renameTense = (record, labels) => {
  const rename = node => ({ ...node, ...(labels.includes(node.label) ? { label: `Tns${node.label}` } : {}),
    ...(node.children ? { children: node.children.map(rename) } : {}) });
  const renamed = structuredClone(record);
  renamed.derivationStages.forEach(stage => { stage.workspaceForest = stage.workspaceForest.map(rename); });
  return renamed;
};
const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word ? { word } : { silent: true }), ...extra, children: [] });
const node = (id, label, children, extra = {}) => ({ id, label, ...extra, children });
const stage = (workspaceForest, relations = []) => ({ statement: 'Authored state.', stageRecord: 'Authored state.', relations, workspaceForest });
const parentOf = (tree, id, parent = null) => tree?.id === id ? parent?.id
  : (tree?.children || []).reduce((found, child) => found ?? parentOf(child, id, tree), undefined);
const conflicts = replay => replay.playbackSteps.flatMap(step => step.movementDiagnostics ?? []).filter(message => message.includes('RELATION_TIMING_CONFLICT'));
const children = (step, id) => {
  const find = node => node?.id === id ? node : (node?.children || []).map(find).find(Boolean);
  return (find(step.replayCanvasData)?.children || []).map(child => child.id);
};
/** No one-child shells (decision 1, approved 23 Oct): the projection a landing creates arrives at that movement's
 * moment with all its daughters, never earlier as a unary projection, and a claim naming it plays after. */
const assertProjectionArrivesWithMovement = (record, stage, projectionId, movementIndex, claimIndex, labels) => {
  const replay = prepare(record);
  assert.deepEqual(violations(replay, record), []);
  assert.deepEqual(conflicts(replay), []);
  const steps = stageSteps(replay, stage), moment = relationMoment(steps, movementIndex);
  assert.ok(moment >= 0);
  assert.ok(!steps.some(step => step.replayKind === 'micro' && step.targetNodeId === projectionId), `${projectionId} has no construction step of its own`);
  steps.slice(0, moment).forEach(step => assert.ok(!step.replayVisibleNodeIds.includes(projectionId),
    `${projectionId} is not shown before the movement, at ${step.replayKind} ${step.operation}`));
  const daughters = children(steps[moment], projectionId);
  assert.ok(daughters.length === 2 && daughters.every(id => steps[moment].replayVisibleNodeIds.includes(id)),
    `${projectionId} arrives with both daughters: ${daughters}`);
  steps.slice(moment).forEach(step => assert.ok(step.replayVisibleNodeIds.includes(projectionId), `${projectionId} stays visible`));
  assert.ok(relationMoment(steps, claimIndex) > moment, `the claim naming ${projectionId} plays after the movement`);
  if (labels) {
    // Category names are open: renaming them changes no step and no visibility.
    const shape = steps => steps.map(step => [step.replayKind, step.operation, step.targetNodeId, step.replayVisibleNodeIds.includes(projectionId)]);
    assert.deepEqual(shape(stageSteps(prepare(renameTense(record, labels)), stage)), shape(steps));
  }
  return steps;
};

test('a projection a later specifier landing creates arrives with that landing whatever its label', () => {
  // "Mary persuaded John to leave.": with clause typing authored first, matrix TP arrives with the subject's
  // movement and the clause typing plays after it.
  assertProjectionArrivesWithMovement(reorder(fixture('showcase/movement.json#/cases/6'), 8, [1, 0]), 8, 'matrixTP', 1, 0, ['T', 'TP', "T'"]);
});

test('a claim on the clause a later raising lands in plays after the raising that creates that clause', () => {
  // "There seem to be cats.": clause typing names matrix TP before the
  // expletive raises into its specifier.
  const embedded = there => ({ id: 'embeddedTP', label: 'TP', children: [there, { id: 'embeddedTProjection', label: 'TP', children: [
    leaf('to', 'T', 'to'), { id: 'beVP', label: 'VP', children: [leaf('be', 'V', 'be'), leaf('cats', 'N', 'cats')] }
  ] }] });
  const record = { sentence: 'There seem to be cats.', derivationStages: [
    stage([embedded(leaf('thereLower', 'D', 'There', { lineageId: 'there' }))]),
    stage([{ id: 'rootCP', label: 'CP', children: [leaf('declarativeC', 'C'), { id: 'matrixTP', label: 'TP', children: [
      leaf('thereHigher', 'D', 'There', { lineageId: 'there' }),
      { id: 'matrixTProjection', label: 'TP', children: [{ id: 'seemVP', label: 'VP', children: [
        leaf('seem', 'V', 'seem'), embedded(leaf('thereLower', 'D', 'There', { lineageId: 'there', silent: true }))
      ] }] }
    ] }] }], [
      { relation: 'declarative clause typing', anchors: { clause: 'matrixTP', clauseTyper: 'declarativeC' } },
      { relation: 'A-raising and copy pronunciation', anchors: { higherOccurrence: 'thereHigher', lowerOccurrence: 'thereLower' } }
    ])
  ] };
  const steps = assertProjectionArrivesWithMovement(record, 1, 'matrixTP', 1, 0, ['TP']);
  const merge = steps.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === 'rootCP');
  assert.ok(merge > relationMoment(steps, 1) && merge < relationMoment(steps, 0), 'CP merges with the completed TP before the clause typing');
});

test('a movement whose landing creates the parent an earlier claim names brings that parent at its moment', () => {
  // A verb-second clause: the V2 claim, authored first, names CP; the subject's landing creates CP, so CP
  // arrives with the subject, after I-to-C, and the V2 claim plays after it.
  const record = reorder(fixture('movement/source-occurrence-ownership.json#/0'), 3, [2, 1, 0]);
  const steps = assertProjectionArrivesWithMovement(record, 3, 'a1_cp', 1, 0);
  const movement = relationMoment(steps, 1);
  assert.ok(!steps[movement - 1].replayVisibleNodeIds.includes('a1_npsc'));
  assert.ok(steps[movement].replayVisibleNodeIds.includes('a1_npsc'));
  assert.deepEqual(children(steps[movement], 'a1_cp'), ['a1_npsc', 'a1_cbar']);
});

test('a phrase that keeps its id at its landing stays in place until its movement, which brings the landing parent', () => {
  // The relative complementizer claim, authored first, names the finite TP
  // that the subject (keeping its id) raises into; TP arrives with the subject's
  // movement, and the subject stays in its vP specifier until it moves.
  const record = reorder(fixture('replay-regressions/successive-cyclic-source.json#/cases/0'), 8, [3, 0, 1, 2]);
  const steps = assertProjectionArrivesWithMovement(record, 8, 'expectTP', 2, 0);
  const movement = relationMoment(steps, 2);
  steps.slice(0, movement).forEach(step => {
    assert.ok(step.replayVisibleNodeIds.includes('teacherDP'), `the subject stays visible at ${step.replayKind} ${step.operation}`);
    assert.equal(parentOf(step.replayCanvasData, 'teacherDP'), 'expectvP');
  });
  assert.equal(parentOf(steps[movement].replayCanvasData, 'teacherDP'), 'expectTP');
});

test('a receiving head selected for a later head movement stands alone until that movement', () => {
  // The subject's movement, authored first, needs T' as its landing context,
  // so construction builds T' over the newly selected T. A neutral claim in
  // the same stage makes Replay apply only the moments that have played.
  const vP = (subject, verb, object) => node('vP', 'vP', [subject, node('vBar', "v'", [leaf('v', 'v'), node('VP', 'VP', [verb, object])])]);
  const record = { sentence: 'Peter read it', derivationStages: [
    stage([vP(leaf('subjLow', 'D', 'Peter', { lineageId: 'subj' }), leaf('verbLow', 'V', 'read', { lineageId: 'verb' }), leaf('objOld', 'D', 'it'))]),
    stage([node('TP', 'TP', [leaf('subjHigh', 'D', 'Peter', { lineageId: 'subj' }), node('TBar', "T'", [
      node('Tcomplex', 'T', [leaf('verbHigh', 'V', 'read', { lineageId: 'verb' }), leaf('T', 'T')]),
      vP(leaf('subjLow', 'D', 'Peter', { lineageId: 'subj', silent: true }), leaf('verbLow', 'V', 'read', { lineageId: 'verb', silent: true }), leaf('objNew', 'D', 'it'))
    ])])], [
      { relation: 'subject movement', anchors: { landing: 'subjHigh', source: 'subjLow', licenser: 'T' } },
      { relation: 'finite head movement', anchors: { landing: 'verbHigh', source: 'verbLow', tense: 'T' } },
      { relation: 'Object change', anchors: { participant: 'objNew' }, priorAnchors: { participant: 'objOld' } }
    ])
  ] };
  const replay = prepare(record);
  assert.deepEqual(violations(replay, record), []);
  const steps = stageSteps(replay, 1), movement = relationMoment(steps, 1);
  steps.slice(0, movement).forEach(step => assert.equal(parentOf(step.replayCanvasData, 'T'), 'TBar',
    `T stands alone at ${step.replayKind} ${step.operation}`));
  assert.equal(parentOf(steps[movement].replayCanvasData, 'T'), 'Tcomplex');
  assert.equal(parentOf(steps[movement].replayCanvasData, 'verbHigh'), 'Tcomplex');
});

test('a withheld unary shell appears at the first moment of any claim that owns its new daughter', () => {
  // "The students have all left.": IP is saved with one daughter until the
  // subject raises. The stranded-quantifier claim, authored first, owns the
  // subject's relocation too but waits for the movement that introduces its
  // trace, so IP appears with the movement.
  const subject = node('dp', 'DP', [leaf('the', 'D', 'The'), leaf('students', 'N', 'students')], { lineageId: 'subject' });
  const clause = (specifier, restriction) => node('ip', 'IP', [...specifier, node('ibar', "I'", [leaf('have', 'I', 'have'),
    node('vp', 'VP', [node('qp', 'QP', [leaf('all', 'Q', 'all'), restriction]), leaf('left', 'V', 'left')])])]);
  const record = { sentence: 'The students have all left', derivationStages: [
    stage([clause([], subject)]),
    stage([clause([subject], leaf('trace', 'DP trace', '', { lineageId: 'subject' }))], [
      { relation: 'stranded-quantifier-dependency', anchors: { interpretedRestriction: 'dp', localRestriction: 'trace', quantifier: 'all' },
        priorAnchors: { localRestriction: 'dp', quantifier: 'all' } },
      { relation: 'A-movement-and-trace-binding', anchors: { landingProjection: 'ip', raisedDP: 'dp', sourceTrace: 'trace' },
        priorAnchors: { containingQP: 'qp', sourceDP: 'dp' } }
    ])
  ] };
  const replay = prepare(record);
  assert.deepEqual(violations(replay, record), []);
  const steps = stageSteps(replay, 1), movement = relationMoment(steps, 1);
  assert.ok(movement < relationMoment(steps, 0), 'the movement plays first');
  assert.ok(!replay.playbackSteps[replay.playbackSteps.indexOf(steps[movement]) - 1].replayVisibleNodeIds.includes('ip'));
  assert.ok(steps[movement].replayVisibleNodeIds.includes('ip'));
});
