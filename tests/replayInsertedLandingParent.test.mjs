import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { stageTreeLayoutSize, buildStageLayoutGroups } from '../replay/stageCamera.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';

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
test('Astra Turkish analysis 2: the object is already inside the landing parent in frame 47', () => {
  const p = compile(saved), steps = p.playbackSteps;
  assert.equal(steps.length, 48);
  const before = steps[45], movement = steps[46], final = steps[47];
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

test('a later relation retains ownership of its changed sibling', () => {
  const p = synthetic({ siblings: [leaf('one'), leaf('two')], pending: true });
  const first = relationMoment(p), second = relationMoment(p, 1);
  assert.deepEqual(childrenAt(first, 'wrapper'), ['one', 'landing']);
  assert.deepEqual(childrenAt(first, 'host'), ['wrapper', 'two', 'head']);
  assert.equal(find(first.replayCanvasData, 'two').word, 'two');
  assert.deepEqual(childrenAt(second, 'wrapper'), ['one', 'two', 'landing']);
  assert.equal(find(second.replayCanvasData, 'two').word, 'changed');
});

test('a later relation owns its sibling relocation even when that sibling keeps its word', () => {
  const p = synthetic({ siblings: [leaf('one'), leaf('two')], pending: 'unchanged' });
  const first = relationMoment(p), second = relationMoment(p, 1);
  assert.deepEqual(childrenAt(first, 'wrapper'), ['one', 'landing']);
  assert.deepEqual(childrenAt(first, 'host'), ['wrapper', 'two', 'head']);
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
  assert.equal(moment.replayVisibleNodeIds.includes('fresh'), false);
  assert.equal(p.playbackSteps.at(-1).replayVisibleNodeIds.includes('fresh'), true);
});
