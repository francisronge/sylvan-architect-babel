import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { adaptDerivationStagesForReplay, getFrameRelations } from '../replay/replayCompiler.ts';

const load = name => JSON.parse(readFileSync(new URL(`../fixtures/replay-regressions/${name}.json`, import.meta.url)));
const nodes = node => node ? [node, ...(node.children || []).flatMap(nodes)] : [];
const find = (step, id) => nodes(step.replayCanvasData).find(node => node.id === id);
const visible = (step, id) => step.replayVisibleNodeIds?.includes(id);
const play = record => buildReplayPlayback({ sentence: record.sentence, analyses: [{ derivationStages: record.derivationStages }] }).steps;

test('saved subject movement constructs its receiving projection before later head adjunction', () => {
  const saved = load('astra-spanish-qr');
  for (const analysis of saved.analyses) {
    const record = { sentence: saved.sentence, derivationStages: analysis.derivationStages.slice(0, 2) };
    const original = structuredClone(record);
    const steps = play(record);
    const subject = steps.find(step => step.operation === 'Subject A-movement');
    const head = steps.find(step => step.operation === 'V-to-I head movement');
    const prefix = analysis.derivationStages[0].workspaceForest[0].id[0];
    const id = suffix => `${prefix}${suffix}`;
    assert.ok(subject && head);
    assert.ok(steps.indexOf(subject) < steps.indexOf(head));
    assert.ok(!subject.movementDiagnostics?.some(message => message.includes('TIMING_CONFLICT')));
    assert.deepEqual(find(subject, id('IP')).children.map(node => node.id), [id('S1'), id('Ibar')]);
    assert.deepEqual(find(subject, id('Ibar')).children.map(node => node.id), [id('I0'), id('VP')]);
    for (const suffix of ['IP', 'Ibar', 'I0', 'VP', 'S1', 'ST', 'V0']) assert.ok(visible(subject, id(suffix)), id(suffix));
    for (const suffix of ['Icomplex', 'V1', 'VT']) assert.ok(!visible(subject, id(suffix)), id(suffix));
    assert.equal(find(subject, id('V0')).word, 'revisó');
    assert.deepEqual(find(head, id('Ibar')).children.map(node => node.id), [id('Icomplex'), id('VP')]);
    for (const suffix of ['Icomplex', 'V1', 'VT']) assert.ok(visible(head, id(suffix)), id(suffix));
    assert.deepEqual(record, original);
  }
});

test('saved complex-head movement carries its member before the later chain restatement', () => {
  const record = load('complex-head-chain-restatement');
  const original = structuredClone(record);
  const steps = play(record);
  const stage = steps.filter(step => step.replayFrameIndex === 2);
  const movement = stage.find(step => step.operation === 'I-to-C head movement');
  const restatement = stage.find(step => step.operation === 'Updated lexical-verb head chain');
  assert.ok(movement && restatement);
  assert.ok(stage.indexOf(movement) < stage.indexOf(restatement));
  assert.ok(!stage.some(step => step.replayKind === 'micro' && ['ti', 'i2', 'v2', 'ibase2'].includes(step.targetNodeId)),
    'the complex, its members and lower witness belong to the movement moment');
  for (const step of [movement, restatement]) {
    for (const id of ['ti', 'i2', 'v2', 'ibase2', 'c1', 'c0', 'tv']) assert.ok(visible(step, id), `${step.operation}: ${id}`);
    assert.deepEqual(find(step, 'i2').children.map(node => node.id), ['v2', 'ibase2']);
    assert.equal(find(step, 'v2').word, 'sagte');
    assert.ok(!step.movementDiagnostics?.some(message => message.includes('TIMING_CONFLICT')));
  }
  const preceding = steps[steps.indexOf(movement) - 1];
  for (const id of ['i1', 'v1', 'i0']) assert.ok(visible(preceding, id), id);
  for (const id of ['ti', 'i2', 'v2', 'ibase2']) assert.ok(!visible(preceding, id), id);
  const frames = adaptDerivationStagesForReplay(record.derivationStages);
  const recovered = getFrameRelations(frames[2], null, frames[1].workspaceForest);
  assert.equal(recovered[0].recoveredMovement.transition, true);
  assert.equal(recovered[1].recoveredMovement.transition, false);
  assert.equal(recovered[1].recoveredMovement.drawTrajectory, true, 'its own later drawing is retained');
  assert.ok(movement.replayRelationLinks.some(link => link.relation === movement.operation
    && link.sourceNodeId === 'ti' && link.targetNodeId === 'i2' && link.trajectoryKind === 'head'));
  assert.ok(!movement.replayRelationLinks.some(link => link.relation === restatement.operation));
  assert.ok(restatement.replayRelationLinks.some(link => link.relation === restatement.operation
    && link.sourceNodeId === 'tv' && link.targetNodeId === 'v2' && link.trajectoryKind === 'head'));
  assert.deepEqual(record, original);
});

for (const change of ['member pronunciation', 'member order', 'lower witness']) {
  test(`a later head relation retains its transition when it changes ${change}`, () => {
    const record = load('complex-head-chain-restatement');
    const current = record.derivationStages[2].workspaceForest.flatMap(nodes);
    if (change === 'member pronunciation') current.find(node => node.id === 'v2').word = 'new exponent';
    if (change === 'member order') current.find(node => node.id === 'i2').children.reverse();
    if (change === 'lower witness') current.find(node => node.id === 'tv').label = 'V⁰ [trace]';
    const frames = adaptDerivationStagesForReplay(record.derivationStages);
    const relations = getFrameRelations(frames[2], null, frames[1].workspaceForest);
    assert.equal(relations[0].recoveredMovement.transition, true);
    assert.equal(relations[1].recoveredMovement.transition, true,
      'an enclosing movement alone does not establish an independent member change');
  });
}

test('independent root order does not change ownership of an unchanged nested chain witness', () => {
  const record = load('complex-head-chain-restatement');
  const independent = { id: 'independent', label: 'Q', word: 'extra' };
  record.derivationStages[1].workspaceForest.unshift(structuredClone(independent));
  record.derivationStages[2].workspaceForest.push(structuredClone(independent));
  let frames = adaptDerivationStagesForReplay(record.derivationStages);
  let relations = getFrameRelations(frames[2], null, frames[1].workspaceForest);
  assert.equal(relations[0].recoveredMovement.transition, true);
  assert.equal(relations[1].recoveredMovement.transition, false);
  const movement = play(record).find(step => step.operation === 'I-to-C head movement');
  for (const id of ['ti', 'i2', 'v2', 'ibase2', 'tv', 'independent']) assert.ok(visible(movement, id), id);

  // A changed nested attachment is different even when every root survives.
  const lowerParent = record.derivationStages[2].workspaceForest.flatMap(nodes).find(node => node.id === 'mvbar');
  lowerParent.children.reverse();
  frames = adaptDerivationStagesForReplay(record.derivationStages);
  relations = getFrameRelations(frames[2], null, frames[1].workspaceForest);
  assert.notEqual(relations[1].recoveredMovement?.transition, false,
    'a changed lower slot cannot be treated as already established');
});
