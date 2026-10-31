import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { stageTreeLayoutSize, buildStageLayoutGroups } from '../replay/stageCamera.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { checkMovementLandingParent, frameStructure } from './helpers/replayInvariants.mjs';

const find = (node, id) => node.id === id ? node : node.children?.map(child => find(child, id)).find(Boolean);
const childrenAt = (step, id) => find(step.replayCanvasData, id)?.children?.map(child => child.id) || [];
const leaf = (id, word = id) => ({ id, label: 'N', word });
const node = (id, children, label = 'NP') => ({ id, label, children });
const stage = (workspaceForest, relations = []) => ({
  statement: 'The current syntax is established.', stageRecord: 'The authored witnesses establish the local change.',
  workspaceForest, relations
});
const localChange = { relation: 'Local repositioning', anchors: { result: 'landing', residue: 'trace' }, priorAnchors: { source: 'source' } };
const compile = input => {
  const original = structuredClone(input);
  const p = prepareReplay({ sentence: 'before one two after', ...input, includePlayback: true });
  assert.deepEqual(input, original, 'Replay must preserve the authored records');
  return p;
};
const relationMoment = (p, index = 0) => p.playbackSteps.find(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === index);
const synthetic = ({ siblings = [leaf('one')], unrelated = false, pending = false } = {}) => {
  const source = node('source', [leaf('adv', 'before')], 'AdvP');
  const head = leaf('head');
  const oldHost = node('host', [...siblings, head], 'V′');
  const landing = node('landing', [leaf('adv', 'before')], 'AdvP');
  const trace = { id: 'trace', label: 'AdvP', silent: true };
  const afterSiblings = pending === true ? siblings.map(child => child.id === 'two' ? { ...child, word: 'changed' } : child) : siblings;
  const afterHost = node('host', [node('wrapper', [...afterSiblings, landing]), head], 'V′');
  const detached = node('detached', [leaf('unrelated')]);
  if (unrelated) afterHost.children[0].children.splice(1, 0, detached);
  const relations = [localChange, ...(pending ? [{ relation: 'Later lexical update', anchors: { output: 'two' }, priorAnchors: { input: 'two' } }] : [])];
  return compile({ derivationStages: [
    stage([node('root', [source, oldHost], 'VP'), ...(unrelated ? [detached] : [])]),
    stage([node('root', [trace, afterHost], 'VP')], relations)
  ] });
};

const saved = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/astra-turkish-relative-2.json', import.meta.url)));
test('Astra Turkish analysis 2: the object is already inside the landing parent in frame 41', () => {
  const p = compile(saved), steps = p.playbackSteps;
  assert.equal(steps.length, 42);
  const before = steps[39], movement = steps[40], final = steps[41];
  assert.equal(movement.operation, 'local temporal-adjunct repositioning');
  assert.equal(movement.replayKind, 'relation');
  assert.equal(final.operation, 'StageRecord');
  assert.deepEqual(childrenAt(before, 'b_matrix_vbar'), ['b_student', 'b_read']);
  assert.equal(before.replayVisibleNodeIds.includes('b_object_domain'), false);
  for (const step of [movement, final]) {
    assert.deepEqual(childrenAt(step, 'b_matrix_vbar'), ['b_object_domain', 'b_read']);
    assert.deepEqual(childrenAt(step, 'b_object_domain'), ['b_student', 'b_yesterday_low']);
    for (const id of ['b_student', 'b_yesterday_low', 'b_yesterday_trace']) assert(step.replayVisibleNodeIds.includes(id));
  }
  const groups = buildStageLayoutGroups(steps, p.replayDerivationFrames);
  for (const [width, height] of [[1596, 1016], [390, 844]]) {
    const positions = step => {
      const tree = d3.hierarchy(step.replayCanvasData); applyVizIds(tree);
      const size = stageTreeLayoutSize(steps, step.replayFrameIndex, width, height, groups);
      layoutSyntaxTree(tree, size, 'ltr',
        buildStageCoordinateReservations(steps, step.replayFrameIndex, size).get(step.replayCanvasData),
        new Set(step.replayVisibleNodeIds));
      return tree.descendants().map(n => ({ id: getNodeId(n), x: n.x, y: n.y }));
    };
    assert.deepEqual(positions(movement), positions(final), 'the Stage Record must not finish an incomplete relation topology');
  }
});

test('an inserted landing parent takes over several consecutive retained children at once', () => {
  const p = synthetic({ siblings: [leaf('one'), leaf('two')] });
  const moment = relationMoment(p);
  assert.deepEqual(childrenAt(moment, 'host'), ['wrapper', 'head']);
  assert.deepEqual(childrenAt(moment, 'wrapper'), ['one', 'two', 'landing']);
});

test('an inserted landing parent does not pull in an unrelated detached workspace', () => {
  const moment = relationMoment(synthetic({ unrelated: true }));
  assert.deepEqual(childrenAt(moment, 'host'), ['wrapper', 'head']);
  assert.deepEqual(childrenAt(moment, 'wrapper'), ['one', 'landing']);
  assert.ok(find(moment.replayCanvasData, 'detached'));
});

// The new parent's moment attaches every sibling in the slot it takes over, so
// no branch spans the row it adds; a later claim keeps the sibling's material.
test('a later relation retains ownership of its changed sibling\'s word, not of its attachment', () => {
  const p = synthetic({ siblings: [leaf('one'), leaf('two')], pending: true });
  const first = relationMoment(p), second = relationMoment(p, 1);
  assert.deepEqual(childrenAt(first, 'wrapper'), ['one', 'two', 'landing']);
  assert.deepEqual(childrenAt(first, 'host'), ['wrapper', 'head']);
  assert.equal(find(first.replayCanvasData, 'two').word, 'two');
  assert.deepEqual(childrenAt(second, 'wrapper'), ['one', 'two', 'landing']);
  assert.equal(find(second.replayCanvasData, 'two').word, 'changed');
});

test('a sibling whose word a later relation keeps attaches at the new parent\'s moment', () => {
  const p = synthetic({ siblings: [leaf('one'), leaf('two')], pending: 'unchanged' });
  const first = relationMoment(p), second = relationMoment(p, 1);
  assert.deepEqual(childrenAt(first, 'wrapper'), ['one', 'two', 'landing']);
  assert.deepEqual(childrenAt(first, 'host'), ['wrapper', 'head']);
  assert.deepEqual(childrenAt(second, 'wrapper'), ['one', 'two', 'landing']);
  assert.equal(find(second.replayCanvasData, 'two').word, 'two');
});

test('an inserted parent cannot silently reverse existing siblings as part of another output', () => {
  const one = leaf('one'), two = leaf('two'), head = leaf('head');
  const source = node('source', [leaf('adv')]);
  const p = compile({ derivationStages: [
    stage([node('root', [source, node('host', [one, two, head])])]),
    stage([node('root', [{ id: 'trace', label: 'AdvP', silent: true },
      node('host', [node('wrapper', [two, one, node('landing', [leaf('adv')])]), head])])], [localChange])
  ] });
  const moment = relationMoment(p);
  assert.deepEqual(childrenAt(moment, 'wrapper'), ['landing']);
  assert.deepEqual(childrenAt(moment, 'host'), ['wrapper', 'one', 'two', 'head']);
});

test('an inserted parent does not reveal unrelated new syntax before its own step', () => {
  const one = leaf('one'), head = leaf('head'), fresh = leaf('fresh');
  const source = node('source', [leaf('adv')]);
  const p = compile({ derivationStages: [
    stage([node('root', [source, node('host', [one, head])])]),
    stage([node('root', [{ id: 'trace', label: 'AdvP', silent: true },
      node('host', [node('wrapper', [one, node('landing', [leaf('adv')])]), head, fresh])])], [localChange])
  ] });
  const moment = relationMoment(p);
  assert.deepEqual(childrenAt(moment, 'wrapper'), ['one', 'landing']);
  // The unrelated node is ordinary construction: its own steps build it, and
  // the merge into its retained parent attaches it, not the relation moment.
  const steps = p.playbackSteps, first = steps.findIndex(step => step.replayVisibleNodeIds.includes('fresh'));
  assert.equal(steps[first].replayKind, 'micro');
  assert.equal(steps[first].replayFrameIndex, 1);
  assert.ok(['fresh', 'fresh::__leaf'].includes(steps[first].targetNodeId), `fresh first appears at ${steps[first].operation} ${steps[first].targetNodeId}`);
  assert.equal(childrenAt(moment, 'host').includes('fresh') && moment.replayVisibleNodeIds.includes('host'), false, 'the moment does not attach it');
  assert.ok(steps.some(step => step.replayKind === 'micro' && step.targetNodeId === 'host' && childrenAt(step, 'host').includes('fresh')));
  assert.equal(steps.at(-1).replayVisibleNodeIds.includes('fresh'), true);
});

// The landing's parent keeps its earlier id and the new parent below it, which
// only attaches the landing above that parent's earlier daughters, gets the new
// id. Another change of the stage can hold an earlier daughter inside a new node
// in its own slot; the new parent is still the movement's.
const keptHost = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/inserted-landing-parent-below-kept-host.json', import.meta.url)));
test('Sol French analysis 1: the subject movement introduces T′ below the kept TP, with no construction step for it', () => {
  const p = compile(keptHost), stage = p.playbackSteps.filter(step => step.replayFrameIndex === 1);
  assert.deepEqual(stage.map(step => step.replayKind === 'relation' ? step.operation : `${step.replayKind} ${step.operation}`),
    ['clitic-movement', 'subject-movement', 'macro StageRecord']);
  const [clitic, subject] = stage.map(frameStructure);
  assert.deepEqual(clitic.children.get('tp'), ['cliticHead', 'voiceProj'], 'the clitic complex takes finite T\'s place under TP');
  assert.equal(clitic.displayed.has('tinner') || clitic.displayed.has('marieHigh'), false);
  assert.notEqual(clitic.nodes.get('marieLow').data.silent, true, 'the source keeps its pronunciation until its movement');
  assert.deepEqual(subject.children.get('tp'), ['marieHigh', 'tinner']);
  assert.deepEqual(subject.children.get('tinner'), ['cliticHead', 'voiceProj']);
  assert.equal(subject.nodes.get('marieLow').data.silent, true);
  const trajectory = step => (step.replayRelationLinks ?? []).some(link => link.authoredRelationKey === '1:1' && link.movementTransition);
  assert.deepEqual(stage.map(trajectory), [false, true, true]);
  assert.deepEqual(checkMovementLandingParent(p, keptHost), []);
});

test('the subject movement authored first waits for the clitic complex its new T′ holds', () => {
  const record = structuredClone(keptHost);
  record.derivationStages[1].relations.reverse();
  const p = compile(record), stage = p.playbackSteps.filter(step => step.replayFrameIndex === 1);
  assert.deepEqual(stage.map(step => step.operation), ['clitic-movement', 'subject-movement', 'StageRecord']);
  assert.deepEqual(frameStructure(stage[0]).children.get('tp'), ['cliticHead', 'voiceProj']);
  assert.deepEqual(frameStructure(stage[1]).children.get('tinner'), ['cliticHead', 'voiceProj']);
  assert.deepEqual(stage.flatMap(step => step.movementDiagnostics ?? []).filter(text => text.startsWith('RELATION_TIMING_CONFLICT')), []);
  assert.deepEqual(checkMovementLandingParent(p, record), []);
});

test('an ordinary adjunction in an earlier daughter\'s slot leaves the inserted landing parent to the movement', () => {
  const word = (id, label, extra = {}) => ({ id, label, word: id, ...extra });
  const record = { sentence: 'sa ho ad zu', derivationStages: [
    stage([node('p', [word('ho', 'X0'), node('c', [word('sa', 'Y', { lineageId: 'S' }), word('zu', 'Z0')], 'Z')], 'X')]),
    stage([node('p', [word('sa2', 'Y', { lineageId: 'S', word: 'sa' }), node('w', [word('ho', 'X0'),
      node('a', [word('ad', 'Adv'), node('c', [word('sa', 'Y', { lineageId: 'S', silent: true }), word('zu', 'Z0')], 'Z')], 'Z')], 'X')], 'X')],
    [{ relation: 'movement', anchors: { higherOccurrence: 'sa2', lowerOccurrence: 'sa' }, priorAnchors: { source: 'sa' } }])
  ] };
  const p = compile(record), steps = p.playbackSteps, moment = steps.findIndex(step => step.replayKind === 'relation');
  assert.equal(steps.some(step => step.replayKind === 'micro' && step.targetNodeId === 'w'), false, 'no construction step builds w');
  assert.deepEqual(frameStructure(steps[moment - 1]).children.get('p'), ['ho', 'a'], 'the adjunction merges in place under p');
  assert.deepEqual(frameStructure(steps[moment]).children.get('p'), ['sa2', 'w']);
  assert.deepEqual(frameStructure(steps[moment]).children.get('w'), ['ho', 'a']);
  assert.deepEqual(checkMovementLandingParent(p, record), []);
});
