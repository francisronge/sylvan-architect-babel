import test from 'node:test';
import assert from 'node:assert/strict';
import { preservesLockedWorkspaceGap } from '../replay/workspaceLockedGapPreference.ts';
import { prepareWorkspaceLifetimeContours, workspaceContourCandidates } from '../replay/workspaceLifetimeContours.ts';

const copy = values => new Map([...values].map(([serial, points]) => [serial, new Map([...points].map(([id, p]) => [id, { ...p }]))]));
const canonical = value => JSON.stringify(value, (_, entry) => entry instanceof Map ? [...entry] : entry instanceof Set ? [...entry] : entry);
function referenceExample() {
  const topology = [
    { incarnation: 0, id: 'a', childIds: [], dependencies: [] },
    { incarnation: 1, id: 'b', childIds: [], dependencies: [] },
    { incarnation: 2, id: 'p', childIds: ['a', 'b'], dependencies: [0, 1] },
    { incarnation: 3, id: 'p', childIds: ['a', 'b'], dependencies: [0, 1, 2] },
  ];
  const preferences = new Map(topology.map(part => [part.incarnation, new Map([
    [part.id, { x: 0, y: 0 }], ...part.childIds.map((id, index) => [id, { x: index ? 500 : -500, y: 300 }]),
  ])]));
  const inputs = new Map(topology.map(part => [part.incarnation, { selected: [],
    preferred: [part.id, ...part.childIds].flatMap(id => [id, preferences.get(part.incarnation).get(id).x, preferences.get(part.incarnation).get(id).y]),
  }]));
  const reference = { topology, inputs, locked: new Set([3]) }, next = copy(preferences);
  next.get(3).get('a').x -= 50; next.get(3).get('b').x += 50;
  return { reference, preferences, next, control: { incarnation: 3, split: 1 } };
}
test('only fully locked child X changes retain the accepted composition', () => {
  const e = referenceExample(), before = canonical(e);
  assert.equal(preservesLockedWorkspaceGap(e.reference, e.next, e.control), true);
  assert.equal(canonical(e), before);
});
for (const [name, change] of [
  ['unlocked fork', e => e.reference.locked.clear()],
  ['unknown incarnation', e => { e.control.incarnation = 40; }],
  ['nonintegral split', e => { e.control.split = 0.5; }],
  ['zero split', e => { e.control.split = 0; }],
  ['past last split', e => { e.control.split = 2; }],
  ['root X', e => { e.next.get(3).get('p').x = 1; }],
  ['child Y', e => { e.next.get(3).get('a').y = 301; }],
  ['signed zero Y', e => { e.next.get(3).get('p').y = -0; }],
  ['earlier incarnation', e => { e.next.get(2).get('a').x = -550; }],
  ['child own preference', e => { e.next.get(0).get('a').x = 1; }],
  ['paired second fork', e => { e.next.get(2).get('a').x -= 50; e.next.get(2).get('b').x += 50; }],
  ['missing child point', e => { e.next.get(3).delete('a'); }],
  ['missing earlier input', e => { e.next.delete(2); }],
  ['selected contour', e => { e.reference.inputs.get(3).selected = ['p', 0, 0]; }],
  ['incomplete snapshot', e => { e.reference.inputs.get(3).preferred.pop(); }],
  ['different snapshot node', e => { e.reference.inputs.get(3).preferred[3] = 'different'; }],
  ['missing snapshot part', e => { e.reference.inputs.delete(0); }],
  ['nonpreceding dependency', e => { e.reference.topology[3].dependencies.push(4); }],
  ['self dependency', e => { e.reference.topology[3].dependencies.push(3); }],
]) test(`${name} falls through to the original evaluator`, () => {
  const e = referenceExample(); change(e);
  assert.equal(preservesLockedWorkspaceGap(e.reference, e.next, e.control), false);
});
for (const value of [NaN, Infinity, -Infinity]) {
  test(`nonfinite proposed X ${value} cannot be skipped`, () => {
    const e = referenceExample(); e.next.get(3).get('a').x = value;
    assert.equal(preservesLockedWorkspaceGap(e.reference, e.next, e.control), false);
  });
  test(`nonfinite accepted X ${value} cannot certify a skip`, () => {
    const e = referenceExample(); e.reference.inputs.get(3).preferred[4] = value;
    assert.equal(preservesLockedWorkspaceGap(e.reference, e.next, e.control), false);
  });
}
test('missing reference and unchanged inputs do not manufacture a direct-gap proof', () => {
  const e = referenceExample();
  assert.equal(preservesLockedWorkspaceGap(undefined, e.next, e.control), false);
  assert.equal(preservesLockedWorkspaceGap(e.reference, e.preferences, e.control), false);
});
test('mutation of a retained map is checked against copied consumed values', () => {
  const e = referenceExample();
  e.preferences.get(2).get('a').x -= 1;
  const next = copy(e.preferences); next.get(3).get('a').x -= 50;
  assert.equal(preservesLockedWorkspaceGap(e.reference, next, e.control), false);
});
test('an unconsumed descendant entry does not invent a dependency', () => {
  const e = referenceExample(); e.next.get(3).set('unused-descendant', { x: 123, y: 456 });
  assert.equal(preservesLockedWorkspaceGap(e.reference, e.next, e.control), true);
});

function compositionExample() {
  const atom = id => ({ id, label: 'N' });
  const before = { id: 'p', label: 'P', children: [atom('a'), atom('b')] };
  const after = structuredClone(before); after.label = 'P′';
  const steps = [before, after].map((canvas, index) => ({ replayCanvasData: canvas, replayVisibleNodeIds: ['p', 'a', 'b'],
    replayKind: 'micro', replayFrameIndex: index, operation: 'LexicalSelect', targetNodeId: 'unrelated' }));
  const references = new Map([before, after].map(canvas => [canvas, new Map([
    ['p', { x: 0, y: 0 }], ['a', { x: -500, y: 300 }], ['b', { x: 500, y: 300 }],
  ])]));
  const compose = prepareWorkspaceLifetimeContours(steps, undefined, undefined, undefined, undefined, 'ltr', references);
  const intrinsic = compose(), candidates = workspaceContourCandidates(intrinsic, references);
  const preferences = new Map([...candidates].map(([serial, options]) => [serial, options.at(-1).positions]));
  const render = points => compose(undefined, { inheritCurrentSlots: true, preferred: points });
  const accepted = render(preferences), early = accepted[0].nodes.get('p').incarnation, late = accepted[1].nodes.get('p').incarnation;
  const noOp = copy(preferences); noOp.get(late).get('a').x -= 50; noOp.get(late).get('b').x += 50;
  const changed = copy(preferences); changed.get(early).get('a').x -= 100; changed.get(early).get('b').x += 100;
  const failure = copy(preferences); failure.get(early).get('b').y += 100;
  return { compose, render, preferences, accepted, early, late, noOp, changed, failure };
}
test('the composer certifies only its own complete successful locked composition', () => {
  const e = compositionExample();
  assert.equal(e.compose.preservesLockedGap(e.accepted, e.noOp, { incarnation: e.late, split: 1 }), true);
  assert.equal(e.compose.preservesLockedGap([...e.accepted], e.noOp, { incarnation: e.late, split: 1 }), false);
  assert.equal(e.compose.preservesLockedGap(e.accepted, e.changed, { incarnation: e.early, split: 1 }), false);
  assert.equal(canonical(e.render(e.noOp)), canonical(e.accepted));
});
test('A → skipped no-op → C exactly matches A → composed no-op → C', () => {
  const skipped = compositionExample(), original = compositionExample();
  assert.equal(skipped.compose.preservesLockedGap(skipped.accepted, skipped.noOp, { incarnation: skipped.late, split: 1 }), true);
  original.render(original.noOp);
  const result = skipped.render(skipped.changed), expected = original.render(original.changed);
  assert.equal(canonical(result), canonical(expected));
  assert.notEqual(canonical(result), canonical(skipped.accepted));
});
test('skipping preserves the next failure and recovery after partial invalidation', () => {
  const skipped = compositionExample(), original = compositionExample();
  const error = action => { try { action(); assert.fail('expected composition failure'); } catch (failure) {
    assert.match(failure.message, /Inconsistent current reference ranks/); return [failure.name, failure.message];
  } };
  original.render(original.noOp);
  assert.deepEqual(error(() => skipped.render(skipped.failure)), error(() => original.render(original.failure)));
  // The no-op is proved against the accepted snapshot, not whichever partial
  // cache state the last failing composition left behind.
  assert.equal(skipped.compose.preservesLockedGap(skipped.accepted, skipped.noOp, { incarnation: skipped.late, split: 1 }), true);
  original.render(original.noOp);
  assert.equal(canonical(skipped.render(skipped.changed)), canonical(original.render(original.changed)));
});
test('a changed earlier incarnation cannot be ignored through a later locked fork', () => {
  const e = compositionExample(), paired = copy(e.noOp);
  paired.get(e.early).get('a').x -= 100; paired.get(e.early).get('b').x += 100;
  assert.equal(e.compose.preservesLockedGap(e.accepted, paired, { incarnation: e.late, split: 1 }), false);
  assert.notEqual(canonical(e.render(paired)), canonical(e.accepted));
});
test('selected-contour compositions cannot supply a locked preference certificate', () => {
  const e = compositionExample();
  const selected = new Map([[e.late, e.accepted[1].nodes.get('p').members]]);
  const frames = e.compose(selected, { inheritCurrentSlots: true, preferred: e.preferences });
  assert.equal(e.compose.preservesLockedGap(frames, e.noOp, { incarnation: e.late, split: 1 }), false);
});
test('composer certificates retain value snapshots when callers mutate preferred maps', () => {
  const e = compositionExample();
  e.preferences.get(e.early).get('a').x -= 1;
  const next = copy(e.preferences); next.get(e.late).get('a').x -= 50;
  assert.equal(e.compose.preservesLockedGap(e.accepted, next, { incarnation: e.late, split: 1 }), false);
});
