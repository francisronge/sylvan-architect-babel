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
const assertProjectionStaysVisible = (record, stage, projectionId, relationIndex, labels) => {
  const replay = prepare(record);
  assert.deepEqual(violations(replay, record), []);
  const steps = stageSteps(replay, stage);
  const projection = steps.findIndex(step => step.replayKind === 'micro' && step.operation === 'Project' && step.targetNodeId === projectionId);
  const moment = relationMoment(steps, relationIndex);
  assert.ok(projection >= 0 && projection < moment, `${projectionId} is projected before relation ${relationIndex}`);
  steps.slice(projection, moment + 1).forEach(step => assert.ok(step.replayVisibleNodeIds.includes(projectionId),
    `${projectionId} stays visible at ${step.replayKind} ${step.operation}`));
  const shape = steps => steps.map(step => [step.replayKind, step.operation, step.targetNodeId, step.replayVisibleNodeIds.includes(projectionId)]);
  assert.deepEqual(shape(stageSteps(prepare(renameTense(record, labels)), stage)), shape(steps));
};

test('a constructed projection stays visible whatever its label when its specifier lands later', () => {
  // "Mary persuaded John to leave.": the stage builds matrix TP and CP while
  // the subject lands in TP's specifier. With clause typing authored first,
  // the subject's movement plays after TP's construction.
  assertProjectionStaysVisible(reorder(fixture('showcase/movement.json#/cases/6'), 8, [1, 0]), 8, 'matrixTP', 1, ['T', 'TP', "T'"]);
});

test('a claim on the clause a later raising lands in sees that clause from its construction', () => {
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
  assertProjectionStaysVisible(record, 1, 'matrixTP', 0, ['TP']);
});

test('a movement waits for the construction of the parent an earlier claim needs before the landing', () => {
  // A verb-second clause: the V2 claim, authored first, names CP, so ordinary
  // construction builds CP for it; the subject lands in CP only after that.
  const record = reorder(fixture('movement/source-occurrence-ownership.json#/0'), 3, [2, 1, 0]);
  const replay = prepare(record);
  assert.deepEqual(violations(replay, record), []);
  const steps = stageSteps(replay, 3);
  const projection = steps.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === 'a1_cp');
  const movement = relationMoment(steps, 1);
  assert.ok(projection >= 0 && projection < movement, 'CP is built before the subject lands in it');
  assert.ok(!steps[movement - 1].replayVisibleNodeIds.includes('a1_npsc'));
  assert.ok(steps[movement].replayVisibleNodeIds.includes('a1_npsc'));
  assert.ok(!steps.some(step => step.movementDiagnostics?.some(message => message.includes('RELATION_TIMING_CONFLICT'))));
});

test('a phrase that keeps its id at its landing stays in place until its movement while construction builds the landing parent', () => {
  // The relative complementizer claim, authored first, names the finite TP
  // that the subject (keeping its id) raises into; construction builds TP
  // for it, but the subject stays in its vP specifier until it moves.
  const record = reorder(fixture('replay-regressions/successive-cyclic-source.json#/cases/0'), 8, [3, 0, 1, 2]);
  const replay = prepare(record);
  assert.deepEqual(violations(replay, record), []);
  const steps = stageSteps(replay, 8), movement = relationMoment(steps, 2);
  assert.ok(steps.findIndex(step => step.targetNodeId === 'expectTP') < movement, 'TP is built before the subject moves');
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
