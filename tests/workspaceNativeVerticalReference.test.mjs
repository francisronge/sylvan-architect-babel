import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceNativeVerticalReference, matchesWorkspaceNativeVerticalReference } from '../replay/workspaceNativeVerticalReference.ts';
import { withinWorkspaceVisualPreference } from '../replay/workspaceVisualPreference.ts';

const tree = (id, ...children) => ({ id, children });
const points = entries => new Map(entries.map(([id, x, y = 0]) => [id, { x, y }]));
function frame(roots, positions, step = { replayCanvasData: {} }) {
  const nodes = new Map();
  const build = node => {
    const children = node.children.map(build), origin = positions.get(node.id);
    const members = new Map([[node.id, { x: 0, y: 0 }]]);
    for (const child of children) for (const [id, p] of child.members) {
      const offset = positions.get(child.id);
      members.set(id, { x: p.x + offset.x - origin.x, y: p.y + offset.y - origin.y });
    }
    const value = { id: node.id, incarnation: nodes.size, first: 0, last: 1, children, members, obstacles: [] };
    nodes.set(node.id, value);
    return value;
  };
  return { roots: roots.map(build), nodes, step };
}
function example(delta = 0) {
  const roots = [tree('p', tree('a'), tree('b'))];
  const old = points([['p', 80, 40], ['a', -420, 440], ['b', 580, 440]]);
  const nativePoints = points([['p', 0, 0], ['a', -500, 210], ['b', 500, 210]]);
  const native = frame(roots, nativePoints), reference = workspaceNativeVerticalReference(native);
  const currentPoints = points([['p', 0, 0], ['a', -500 - delta, 210], ['b', 500 + delta, 210]]);
  return { roots, old, nativePoints, native, reference, current: frame(roots, currentPoints, native.step) };
}

test('the default predicate still rejects corrected native Y; explicit native certification permits it', () => {
  const e = example();
  assert.ok(e.reference);
  assert.equal(withinWorkspaceVisualPreference(e.current, e.old), false);
  assert.equal(withinWorkspaceVisualPreference(e.current, e.old, e.reference), true);
});
for (const [delta, expected] of [[0, true], [5, true], [10, true], [10.01, false]]) {
  test(`certification leaves the root displacement threshold unchanged: ${delta}`, () => {
    const e = example(delta);
    assert.equal(withinWorkspaceVisualPreference(e.current, e.old, e.reference), expected);
  });
}
for (const [halfGap, expected] of [[11, true], [11.01, false], [30, false]]) {
  test(`certification leaves small local spans bounded independently: ${halfGap}`, () => {
    const roots = [tree('p', tree('left'), tree('fork', tree('a'), tree('b')), tree('right'))];
    const old = points([['p', 0], ['left', -10000, 400], ['fork', 0, 400], ['a', -10, 800], ['b', 10, 800], ['right', 10000, 400]]);
    const nativePoints = new Map([...old].map(([id, p]) => [id, { x: p.x, y: p.y / 2 }]));
    const native = frame(roots, nativePoints), reference = workspaceNativeVerticalReference(native);
    const after = new Map([...nativePoints].map(([id, p]) => [id, { ...p }]));
    after.get('a').x = -halfGap; after.get('b').x = halfGap;
    assert.equal(withinWorkspaceVisualPreference(frame(roots, after, native.step), old, reference), expected);
  });
}
for (const [before, after] of [[0, 1], [1, 0], [1, -1]]) {
  test(`zero and reversed spans remain rejected: ${before} to ${after}`, () => {
    const roots = [tree('p', tree('a'), tree('middle'), tree('b'))];
    const old = points([['p', 0], ['a', -1000, 400], ['middle', before, 400], ['b', 1000, 400]]);
    const nativePoints = new Map([...old].map(([id, p]) => [id, { x: p.x, y: p.y / 2 }]));
    const native = frame(roots, nativePoints), reference = workspaceNativeVerticalReference(native);
    nativePoints.get('middle').x = after;
    assert.equal(withinWorkspaceVisualPreference(frame(roots, nativePoints, native.step), old, reference), false);
  });
}
test('matching the final frame does not certify a changed earlier relative Y', () => {
  const earlier = example(), final = example();
  earlier.current.nodes.get('p').members.get('a').y += 0.01;
  assert.equal(matchesWorkspaceNativeVerticalReference(final.current, final.reference), true);
  assert.equal([earlier, final].every(e => matchesWorkspaceNativeVerticalReference(e.current, e.reference)), false);
});
test('a native snapshot cannot follow later mutations of its source points', () => {
  const e = example();
  e.native.nodes.get('p').members.get('a').y += 20;
  assert.equal(matchesWorkspaceNativeVerticalReference(e.current, e.reference), true);
  assert.equal(matchesWorkspaceNativeVerticalReference(e.native, e.reference), false);
});
for (const [name, change] of [
  ['relative Y', e => { e.current.nodes.get('p').members.get('a').y += 0.01; }],
  ['step identity', e => { e.current.step = { ...e.current.step }; }],
  ['canvas identity', e => { e.current.step.replayCanvasData = {}; }],
  ['incarnation', e => { e.current.nodes.get('a').incarnation += 1; }],
  ['first appearance', e => { e.current.nodes.get('a').first += 1; }],
  ['last appearance', e => { e.current.nodes.get('a').last += 1; }],
  ['child order', e => { e.current.nodes.get('p').children.reverse(); }],
  ['missing child', e => { e.current.nodes.get('p').children.pop(); }],
  ['duplicate child', e => { e.current.nodes.get('p').children[1] = e.current.nodes.get('a'); }],
  ['missing node', e => { e.current.nodes.delete('a'); }],
  ['extra node', e => { e.current.nodes.set('extra', { ...e.current.nodes.get('a'), id: 'extra' }); }],
  ['node identity', e => { e.current.nodes.set('a', { ...e.current.nodes.get('a') }); }],
  ['missing member', e => { e.current.nodes.get('p').members.delete('a'); }],
  ['extra member', e => { e.current.nodes.get('p').members.set('extra', { x: 1, y: 1 }); }],
  ['substituted member', e => { e.current.nodes.get('p').members.delete('a'); e.current.nodes.get('p').members.set('extra', { x: -500, y: 210 }); }],
  ['nonfinite X', e => { e.current.nodes.get('p').members.get('a').x = Infinity; }],
  ['nonfinite Y', e => { e.current.nodes.get('p').members.get('a').y = NaN; }],
]) test(`${name} cannot use the native vertical stopping certificate`, () => {
  const e = example(); change(e);
  assert.equal(matchesWorkspaceNativeVerticalReference(e.current, e.reference), false);
  assert.equal(withinWorkspaceVisualPreference(e.current, e.old, e.reference), false);
});
test('independent root order is part of the native forest identity', () => {
  const roots = [tree('p'), tree('q')], coordinates = points([['p', 0], ['q', 100]]);
  const native = frame(roots, coordinates), reference = workspaceNativeVerticalReference(native);
  const current = frame(roots, coordinates, native.step); current.roots.reverse();
  assert.equal(matchesWorkspaceNativeVerticalReference(current, reference), false);
});
for (const [name, change] of [
  ['nonfinite point', f => { f.nodes.get('p').members.get('a').y = NaN; }],
  ['nonfinite incarnation', f => { f.nodes.get('a').incarnation = Infinity; }],
  ['missing member', f => { f.nodes.get('p').members.delete('a'); }],
  ['foreign member', f => { f.nodes.get('a').members = new Map([['foreign', { x: 0, y: 0 }]]); }],
  ['extra node', f => { f.nodes.set('extra', { ...f.nodes.get('a'), id: 'extra' }); }],
  ['duplicate root', f => { f.roots.push(f.roots[0]); }],
]) test(`invalid native ${name} cannot be certified`, () => {
  const e = example(); change(e.native);
  assert.equal(workspaceNativeVerticalReference(e.native), undefined);
});
for (const value of [NaN, Infinity, -Infinity]) test(`nonfinite legacy reference ${value} cannot terminate scoped refinement`, () => {
  const e = example(); e.old.get('a').x = value;
  assert.equal(withinWorkspaceVisualPreference(e.current, e.old, e.reference), false);
});
test('finite endpoints with an overflowing span cannot terminate scoped refinement', () => {
  const e = example(); e.old.get('a').x = -1e308; e.old.get('b').x = 1e308;
  assert.equal(withinWorkspaceVisualPreference(e.current, e.old, e.reference), false);
});
test('missing legacy membership cannot terminate scoped refinement', () => {
  const e = example(); e.old.delete('a');
  assert.equal(withinWorkspaceVisualPreference(e.current, e.old, e.reference), false);
});
