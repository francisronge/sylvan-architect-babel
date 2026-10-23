import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';

const leaf = (id, word, extra = {}) => ({ id, label: 'X', word, ...extra });
const branch = (id, children, extra = {}) => ({ id, label: 'XP', children, ...extra });
const stage = workspaceForest => ({
  statement: 'The current workspace is established.',
  stageRecord: 'The authored objects have their current structure.',
  relations: [],
  workspaceForest
});
const replay = (before, after) => {
  const derivationStages = [stage(before), stage(after)];
  const original = structuredClone(derivationStages);
  const steps = prepareReplay({ sentence: 'one two three', derivationStages, includePlayback: true }).playbackSteps;
  assert.deepEqual(derivationStages, original, 'continuity must not edit authored stages');
  return steps.filter(step => step.replayFrameIndex === 1);
};
const structuralTarget = (steps, id) => steps.find(step => step.replayKind === 'micro' && step.targetNodeId === id);
const assertFirstVisibleAtConstruction = (steps, id) => {
  const construction = structuralTarget(steps, id);
  assert.ok(construction, `${id} needs its own structural microstep`);
  assert.equal(steps.find(step => step.replayVisibleNodeIds.includes(id)), construction,
    `${id} must not appear before its construction`);
};

test('a retained lineage does not make newly added descendants already constructed', () => {
  const one = leaf('one', 'one');
  const before = branch('phrase', [one], { lineageId: 'phrase-lineage' });
  const after = { ...before, children: [one, leaf('two', 'two')] };
  const steps = replay([before], [after]);
  assertFirstVisibleAtConstruction(steps, 'two');
  const selection = steps.find(step => step.operation === 'LexicalSelect' && step.targetLabel === 'two');
  assert.ok(selection, 'the added word needs a selection step');
  assert.ok(steps.indexOf(selection) < steps.indexOf(structuralTarget(steps, 'two')));
});

test('an unchanged overt yield does not conceal a newly authored wrapper', () => {
  const one = leaf('one', 'one');
  const two = leaf('two', 'two');
  const before = branch('phrase', [one, two]);
  const after = branch('phrase', [branch('wrapper', [one]), two]);
  const steps = replay([before], [after]);
  assertFirstVisibleAtConstruction(steps, 'wrapper');
  assert.equal(structuralTarget(steps, 'wrapper').operation, 'Project');
});

test('an unchanged overt yield does not conceal an added silent head', () => {
  const one = leaf('one', 'one');
  const two = leaf('two', 'two');
  const before = branch('phrase', [one, two]);
  const after = branch('phrase', [one, { id: 'silent', label: 'Z', silent: true }, two]);
  const steps = replay([before], [after]);
  assertFirstVisibleAtConstruction(steps, 'silent');
});

test('an exactly retained subtree with new occurrence IDs is not selected again', () => {
  for (const useLineage of [false, true]) {
    const make = prefix => branch(`${prefix}-phrase`, [
      leaf(`${prefix}-one`, 'one'), leaf(`${prefix}-two`, 'two')
    ], useLineage ? { lineageId: 'retained-phrase' } : {});
    const steps = replay([make('before')], [make('after')]);
    assert.deepEqual(steps.map(step => step.replayKind), ['macro'],
      'complete, unchanged material may retain continuity across reidentified occurrences');
    for (const id of ['after-phrase', 'after-one', 'after-two']) {
      assert.ok(steps.at(-1).replayVisibleNodeIds.includes(id));
    }
  }
});

test('lineage continuity does not treat changed lexical contents as an unchanged subtree', () => {
  const before = branch('before-phrase', [leaf('before-one', 'one'), leaf('before-two', 'two')],
    { lineageId: 'phrase-lineage' });
  const after = branch('after-phrase', [leaf('after-one', 'one'), leaf('after-three', 'three')],
    { lineageId: 'phrase-lineage' });
  const steps = replay([before], [after]);
  assertFirstVisibleAtConstruction(steps, 'after-three');
  assert.ok(steps.some(step => step.operation === 'LexicalSelect' && step.targetLabel === 'three'));
});

const findNode = (node, id) => node.id === id ? node : node.children?.map(child => findNode(child, id)).find(Boolean);
const childrenAt = (step, id) => findNode(step.replayCanvasData, id)?.children?.map(child => child.id) || [];

test('adding an already constructed workspace to a retained parent has its own merge', () => {
  const one = leaf('one', 'one'), two = leaf('two', 'two');
  const before = branch('phrase', [one]);
  const steps = replay([before, two], [{ ...before, children: [one, two] }]);
  const merge = structuralTarget(steps, 'phrase');
  assert.ok(merge);
  assert.equal(merge.operation, 'ExternalMerge');
  assert.deepEqual(merge.sourceNodeIds, ['one', 'two']);
  assert.deepEqual(childrenAt(merge, 'phrase'), ['one', 'two']);
  assert.deepEqual(steps.filter(step => step.replayKind === 'micro').map(step => step.targetNodeId), ['phrase']);
});

test('a selected child stays detached until its retained parent merges it', () => {
  const one = leaf('one', 'one'), two = leaf('two', 'two');
  const before = branch('phrase', [one]);
  const steps = replay([before], [{ ...before, children: [one, two] }]);
  const merge = structuralTarget(steps, 'phrase');
  assert.ok(merge);
  for (const step of steps.slice(0, steps.indexOf(merge))) {
    assert.deepEqual(childrenAt(step, 'phrase'), ['one'], 'an old parent cannot absorb a selected child before merging it');
    assert.ok(step.replayVisibleNodeIds.includes('phrase'));
  }
  assert.deepEqual(childrenAt(merge, 'phrase'), ['one', 'two']);
  assert.ok(steps.indexOf(structuralTarget(steps, 'two')) < steps.indexOf(merge));
});

test('a retained parent gains its complement before a new wrapper replaces its outer attachment', () => {
  const one = leaf('one', 'one'), two = leaf('two', 'two'), three = leaf('three', 'three');
  const left = leaf('left', 'left'), core = branch('core', [one]);
  const outer = branch('outer', [left, core]);
  const expanded = { ...core, children: [one, two] };
  const wrapper = branch('wrapper', [expanded, three]);
  const steps = replay([outer, two, three], [{ ...outer, children: [left, wrapper] }]);
  const attachment = structuralTarget(steps, 'core'), wrap = structuralTarget(steps, 'wrapper');
  assert.ok(attachment && wrap);
  assert.ok(steps.indexOf(attachment) < steps.indexOf(wrap));
  assert.deepEqual(childrenAt(attachment, 'outer'), ['left', 'core']);
  assert.deepEqual(childrenAt(attachment, 'core'), ['one', 'two']);
  assert.equal(attachment.replayVisibleNodeIds.includes('wrapper'), false);
  assert.deepEqual(childrenAt(wrap, 'outer'), ['left', 'wrapper']);
  assert.deepEqual(childrenAt(wrap, 'wrapper'), ['core', 'three']);
  assert.equal(structuralTarget(steps, 'outer'), undefined, 'the unchanged outer context is not reconstructed');
});

test('an ordinary relation cannot erase the pending attachments of later construction', () => {
  const one = leaf('one', 'one'), two = leaf('two', 'two');
  const before = branch('phrase', [one]);
  const derivationStages = [stage([before]), {
    ...stage([{ ...before, children: [one, two] }]),
    relations: [{ relation: 'Local annotation', anchors: { object: 'one' }, values: { note: 'retained' } }]
  }];
  const steps = prepareReplay({ sentence: 'one two', derivationStages, includePlayback: true }).playbackSteps.filter(step => step.replayFrameIndex === 1);
  const merge = structuralTarget(steps, 'phrase');
  assert.ok(merge);
  assert.deepEqual(steps.filter(step => step.replayKind === 'relation').map(step => step.replayRelationIdentity), [{ stageIndex: 1, relationIndex: 0 }]);
  for (const step of steps.slice(0, steps.indexOf(merge))) assert.deepEqual(childrenAt(step, 'phrase'), ['one']);
  assert.deepEqual(childrenAt(merge, 'phrase'), ['one', 'two']);
});

// A replaced node stays until its replacement swaps in, and frames show only authored daughter counts: the
// retained parent keeps [one, two] until the wrapper takes them, and then shows both its authored daughters.
test('a wrapper replacing retained children swaps in with the parent\'s other new child, never leaving a partial parent', () => {
  const one = leaf('one', 'one'), two = leaf('two', 'two'), three = leaf('three', 'three');
  const before = branch('phrase', [one, two]);
  const wrapper = branch('wrapper', [one, two], { label: 'X′' });
  const steps = replay([before, three], [{ ...before, children: [wrapper, three] }]);
  const wrap = structuralTarget(steps, 'wrapper');
  assert.ok(wrap);
  assert.equal(structuralTarget(steps, 'phrase'), undefined, 'the retained parent is not merged a second time');
  steps.slice(0, steps.indexOf(wrap)).forEach(step => assert.deepEqual(childrenAt(step, 'phrase'), ['one', 'two']));
  assert.deepEqual(childrenAt(wrap, 'phrase'), ['wrapper', 'three']);
  assert.deepEqual(childrenAt(wrap, 'wrapper'), ['one', 'two']);
  for (const step of steps) assert.ok([['one', 'two'], ['wrapper', 'three']].some(kids => JSON.stringify(kids) === JSON.stringify(childrenAt(step, 'phrase'))),
    `${step.operation} shows the retained parent with an authored daughter list`);
});


test('a new phrase repeating the material of an earlier phrase that changes in place is built at its own steps', () => {
  // The earlier phrase keeps its id while a modifier joins it, so the new
  // phrase with its former material is a second occurrence, not a renaming.
  const earlierCore = branch('earlierCore', [leaf('second', 'two')]);
  const before = branch('earlier', [leaf('first', 'one'), earlierCore]);
  const after = branch('clause', [
    branch('earlier', [leaf('first', 'one'), branch('wrapper', [branch('modifier', [leaf('three', 'three')]), earlierCore])]),
    branch('repeat', [leaf('repeatFirst', 'one'), branch('repeatCore', [leaf('repeatSecond', 'two')])])
  ]);
  const steps = replay([before], [after]);
  for (const id of ['repeat', 'repeatFirst', 'repeatCore', 'repeatSecond'])
    assertFirstVisibleAtConstruction(steps, id);
  for (const id of ['earlier', 'first', 'earlierCore', 'second'])
    assert.ok(steps[0].replayVisibleNodeIds.includes(id), `${id} continues from the preceding stage`);
});
