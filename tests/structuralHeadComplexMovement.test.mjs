import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { readDerivationStructuralMovement } from '../replay/relations/structuralMovement.ts';
import * as invariants from './helpers/replayInvariants.mjs';
import { checkMovementUnrendered } from './helpers/replayContractWarnings.mjs';
import { withStructuralMovement } from './helpers/structuralMovementSwitch.mjs';

// Saved negative inversion (spellout-night 13-en-negative-inversion, stage 8,
// "Never have I seen such a mess."): the finite T complex, the auxiliary
// adjoined to tense, moves to C. The complex carries no lineage of its own;
// each member does, so structure read two displacements and the claim, which
// names both, stayed a copy without an arrow.
const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word === undefined ? {} : { word }), children: [], ...extra });
const stage = (workspaceForest, relations = []) => ({ statement: 'State', stageRecord: 'Record', relations, workspaceForest });
const predicate = () => ({ id: 'perfect', label: 'Perf', children: [leaf('haveLow', 'Perf', 'have', { lineageId: 'aux', silent: true }),
  { id: 'vp', label: 'V', children: [leaf('seen', 'V', 'seen'), leaf('mess', 'N', 'mess')] }] });
const finite = (silent, lineage) => ({ id: 'finiteHead', label: 'T', ...(silent ? { silent: true } : {}), children: [
  leaf('haveT', 'Perf', 'have', { lineageId: 'aux', ...(silent ? { silent: true } : {}) }),
  leaf('tense', 'T', undefined, { silent: true, ...(lineage ? { lineageId: 'tns' } : {}) })] });
const clause = (silent, lineage) => ({ id: 'tp', label: 'T', children: [leaf('subject', 'D', 'I'),
  { id: 'tbar', label: 'T', children: [finite(silent, lineage), predicate()] }] });
// The stage before: the auxiliary still stands in Perf and T is bare tense.
const start = () => { const tree = before(), tbar = tree[0].children[1].children[1].children[1];
  tbar.children[0] = leaf('tense', 'T', undefined, { silent: true });
  tbar.children[1].children[0] = leaf('haveLow', 'Perf', 'have', { lineageId: 'aux' });
  return tree; };
const before = () => [{ id: 'cp', label: 'C', children: [leaf('never', 'Adv', 'Never'), { id: 'cbar', label: 'C', children: [
  leaf('complementizer', 'C', undefined, { silent: true }), clause(false, false)] }] }];
const after = () => [{ id: 'cp', label: 'C', children: [leaf('never', 'Adv', 'Never'), { id: 'cbar', label: 'C', children: [
  { id: 'invertedHead', label: 'C', children: [{ id: 'raisedFiniteHead', label: 'T', children: [
    leaf('haveC', 'Perf', 'have', { lineageId: 'aux' }), leaf('tenseC', 'T', undefined, { lineageId: 'tns', silent: true })] },
  leaf('complementizer', 'C', undefined, { silent: true })] }, clause(true, true)] }] }];
const claim = { relation: 'inversión negativa', anchors: { cabeza: 'invertedHead', complejo: 'raisedFiniteHead', auxiliarAlto: 'haveC',
  tiempoAlto: 'tenseC', origen: 'finiteHead', auxiliarBajo: 'haveT', tiempoBajo: 'tense' },
  priorAnchors: { origen: 'finiteHead', auxiliar: 'haveT', tiempo: 'tense' } };
const adjoin = { relation: 'v-a-t', anchors: { alto: 'haveT', bajo: 'haveLow', complejo: 'finiteHead' } };
const stages = (relation = claim) => [stage(start()), stage(before(), [adjoin]), stage(after(), [relation])];
const paths = (input, value) => withStructuralMovement(value, () => compileRelationRenderPlan(input)).frames[2].items
  .filter(item => item.kind === 'trajectory' && item.relationRef.stageIndex === 2).map(item => `${item.sourceNodeId}->${item.targetNodeId}`);

test('a head complex whose members all move into one new complex of its category moves as one head', () => {
  const ownership = readDerivationStructuralMovement(stages())[2];
  assert.deepEqual(ownership.displacements.map(d => `${d.sourceNodeId}->${d.targetNodeId} ${d.trajectoryKind}`), ['finiteHead->raisedFiniteHead head']);
  assert.deepEqual([...ownership.owners], [[0, 0]]);
  assert.deepEqual(paths(stages(), '0'), [], 'wording alone draws no arrow');
  assert.deepEqual(paths(stages()), ['finiteHead->raisedFiniteHead']);
  const authored = { sentence: 'Never have I seen mess', derivationStages: stages() };
  const replay = prepareReplay({ ...structuredClone(authored), includePlayback: true });
  assert.deepEqual([...invariants.checkMovementShownAsMovement(replay, authored), ...invariants.checkNoEarlyReveal(replay),
    ...checkMovementUnrendered(replay, authored)], []);
});

test('members that move apart, or into a complex of another category, are not one complex', () => {
  // The tense copy lands outside the new complex: two separate displacements remain.
  const split = after();
  const inverted = split[0].children[1].children[0];
  inverted.children[0].children = [inverted.children[0].children[0], leaf('extra', 'Perf', undefined, { silent: true })];
  split[0].children[1].children.push(leaf('tenseC', 'T', undefined, { lineageId: 'tns', silent: true }));
  const read = forest => readDerivationStructuralMovement([...stages().slice(0, 2), stage(forest, [claim])])[2];
  assert.ok(!read(split).displacements.some(d => d.sourceNodeId === 'finiteHead'));
  const other = after();
  other[0].children[1].children[0].children[0].label = 'Asp';
  assert.ok(!read(other).displacements.some(d => d.sourceNodeId === 'finiteHead'));
});

test('the copy check counts a carried head as moved only when a path reaches a node containing it', () => {
  // Saved German V2 (spellout-night 23-de-v2-object-fronting, stage 7): the
  // T complex declares its lineage at its first copy and moves to C carrying
  // the auxiliary; its one arrow already ends at the complex.
  const authored = { sentence: 'Never have I seen mess', derivationStages: stages() };
  const drawn = prepareReplay({ ...structuredClone(authored), includePlayback: true });
  assert.deepEqual(checkMovementUnrendered(drawn, authored), []);
  // Switched off, structure draws nothing: the carried auxiliary is reported.
  const plain = withStructuralMovement('0', () => prepareReplay({ ...structuredClone(authored), includePlayback: true }));
  assert.deepEqual(checkMovementUnrendered(plain, authored).filter(finding => finding.subject === '2:0')
    .map(finding => finding.subtype), ['COPY_WITHOUT_PATH']);
});
