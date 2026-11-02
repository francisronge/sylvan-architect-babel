import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { readStageDisplacements } from '../replay/relations/structuralMovement.ts';
import * as invariants from './helpers/replayInvariants.mjs';
import { withStructuralMovement } from './helpers/structuralMovementSwitch.mjs';

// Several occurrences of one lineage displaced in one stage, read from ids,
// slots and lineage alone. Every claim below uses open names no recognizer
// knows, so only structure can draw it.
const leaf = (id, label, word, extra = {}) => ({ id, label, word, children: [], ...extra });
const stage = (workspaceForest, relations = []) => ({ statement: 'State', stageRecord: 'Record', relations, workspaceForest });
const paths = (stages, stageIndex, value) => withStructuralMovement(value, () => compileRelationRenderPlan(stages)).frames[stageIndex].items
  .filter(item => item.kind === 'trajectory' && item.relationRef.stageIndex === stageIndex)
  .map(item => `${item.relationRef.relationIndex}:${item.sourceNodeId}->${item.targetNodeId}`).sort();

// Saved right-node raising (bughunt2 07-en-rnr, fixture unrecognized-movement
// case 4, stage 4): each conjunct's object moves to the right edge of its own
// vP in one stage. Both objects share one lineage and keep their ids below.
const object = (id, extra = {}) => ({ id, label: 'DP', lineageId: 'obj', ...extra,
  children: [leaf(`${id}-d`, 'D', 'the', extra.silent ? { silent: true } : {}), leaf(`${id}-n`, 'N', 'house', extra.silent ? { silent: true } : {})] });
const conjunct = (n, verb, edge) => {
  const vp = { id: `vp${n}`, label: 'VP', children: [leaf(`v${n}`, 'V', verb), object(`o${n}`, edge ? { silent: true } : {})] };
  return edge ? { id: `edge${n}`, label: 'VP', children: [vp, object(`o${n}e`)] } : vp;
};
const rnr = () => [stage([conjunct(1, 'bought'), leaf('and', '&', 'and'), conjunct(2, 'sold')]),
  stage([conjunct(1, 'bought', true), leaf('and', '&', 'and'), conjunct(2, 'sold', true)], [
    { relation: 'kantenbewegung', anchors: { rand: 'o1e', quelle: 'o1' } },
    { relation: 'kantenbewegung', anchors: { rand: 'o2e', quelle: 'o2' } }])];

test('copies of one lineage, each landing above its own kept occurrence, are separate displacements', () => {
  const [before, after] = rnr();
  const { displacements, refusals } = readStageDisplacements(before.workspaceForest, after.workspaceForest);
  assert.deepEqual(refusals, []);
  assert.deepEqual(displacements.map(d => `${d.sourceNodeId}->${d.targetNodeId}`).sort(), ['o1->o1e', 'o2->o2e']);
  assert.deepEqual(paths(rnr(), 1, '0'), [], 'wording alone draws no arrow');
  assert.deepEqual(paths(rnr(), 1), ['0:o1->o1e', '1:o2->o2e']);
});

test('a copy that commands two kept occurrences pairs with neither on its own', () => {
  // Both new copies sit above both conjuncts: no landing commands one kept
  // occurrence alone, so the pairing reads more than one way.
  const [before] = rnr();
  const after = [{ id: 'top', label: 'XP', children: [object('o1e'), { id: 'mid', label: 'XP', children: [object('o2e'),
    { id: 'coord', label: '&P', children: [conjunct(1, 'bought', false), leaf('and', '&', 'and'), conjunct(2, 'sold', false)] }] }] }];
  after[0].children[1].children[1].children[0].children[1].silent = true;
  after[0].children[1].children[1].children[2].children[1].silent = true;
  const { displacements, refusals } = readStageDisplacements(before.workspaceForest, after);
  assert.deepEqual(displacements, []);
  assert.equal(refusals.length, 1);
});

// Saved across-the-board relatives. Kept lower copies (movement-id-ab
// en-atb-relative.A, stage 4): the operator copies at both conjunct edges keep
// their ids and one new copy lands in Spec-CP, commanding both.
const opr = (id, extra = {}) => leaf(id, 'D', undefined, { lineageId: 'op', silent: true, ...extra });
const tp = (n, subject, verb, operator) => ({ id: `tp${n}`, label: 'TP', children: [leaf(`s${n}`, 'D', subject),
  { id: `vp${n}`, label: 'vP', children: [operator, { id: `v${n}p`, label: 'VP', children: [leaf(`v${n}`, 'V', verb), opr(`obj${n}`)] }] }] });
const coordination = (left, right) => ({ id: 'andP', label: '&P', children: [tp(1, 'John', 'wrote', left),
  { id: 'andbar', label: '&′', children: [leaf('and', '&', 'and'), tp(2, 'Mary', 'reviewed', right)] }] });
const relative = (landing, left, right) => [{ id: 'cp', label: 'CP', children: [landing, { id: 'cbar', label: 'C′', children: [
  leaf('that', 'C', 'that'), coordination(left, right)] }] }];
const keptLower = (claim) => [stage([coordination(opr('e1'), opr('e2'))]), stage(relative(opr('high'), opr('e1'), opr('e2')), [claim])];

test('one new copy commanding several kept occurrences is one landing with several lower copies', () => {
  const claim = { relation: 'dependencia', anchors: { arriba: 'high', bordes: ['e1', 'e2'], objetos: ['obj1', 'obj2'] } };
  const [before, after] = keptLower(claim);
  const { displacements, refusals } = readStageDisplacements(before.workspaceForest, after.workspaceForest);
  assert.deepEqual(refusals, []);
  assert.deepEqual(displacements.map(d => `${d.sourceNodeId}->${d.targetNodeId}`), ['e1->high', 'e2->high']);
  assert.deepEqual(paths(keptLower(claim), 1, '0'), []);
  assert.deepEqual(paths(keptLower(claim), 1), ['0:e1->high', '0:e2->high']);
  // Naming only one of the lower copies names part of the group: no arrow.
  assert.deepEqual(paths(keptLower({ ...claim, anchors: { arriba: 'high', borde: 'e1' } }), 1), []);
});

// Kept landing (spellout-v3 60-en-atb-relative, stage 2): the first conjunct's
// operator keeps its id in Spec-CP, the second's is removed, and new traces
// hold both preceding slots.
const keptLanding = () => [stage([coordination(leaf('x1', 'C', undefined, { silent: true }), leaf('x2', 'C', undefined, { silent: true }))]),
  stage(relative(opr('obj1'), leaf('x1', 'C', undefined, { silent: true }), leaf('x2', 'C', undefined, { silent: true })), [])];

test('a kept-id landing whose preceding slot and a removed sibling copy\'s slot both hold new copies is one shared landing', () => {
  const stages = keptLanding();
  stages[1].workspaceForest = relative(opr('obj1'), leaf('x1', 'C', undefined, { silent: true }), leaf('x2', 'C', undefined, { silent: true }));
  const vp = (root, n) => root[0].children[1].children[1].children[n === 1 ? 0 : 1].children[n === 1 ? 1 : 1];
  // obj1 moved to Spec-CP; t1 and t2 hold the two objects' preceding slots.
  const andbar = stages[1].workspaceForest[0].children[1].children[1].children[1];
  stages[1].workspaceForest[0].children[1].children[1].children[0].children[1].children[1].children[1] = opr('t1');
  andbar.children[1].children[1].children[1].children[1] = opr('t2');
  void vp;
  stages[1].relations = [{ relation: 'dependencia', anchors: { arriba: 'obj1', huellas: ['t1', 't2'] }, priorAnchors: { antes: ['obj1', 'obj2'] } }];
  const { displacements, refusals } = readStageDisplacements(stages[0].workspaceForest, stages[1].workspaceForest);
  assert.deepEqual(refusals, []);
  assert.deepEqual(displacements.map(d => `${d.priorSourceNodeId}:${d.sourceNodeId}->${d.targetNodeId}`).sort(), ['obj1:t1->obj1', 'obj2:t2->obj1']);
  assert.deepEqual(paths(stages, 1), ['0:t1->obj1', '0:t2->obj1']);
  const replay = prepareReplay({ sentence: 'that John wrote and Mary reviewed', derivationStages: structuredClone(stages), includePlayback: true });
  assert.deepEqual([...invariants.checkMovementShownAsMovement(replay, { derivationStages: stages }), ...invariants.checkNoEarlyReveal(replay)], []);
});
