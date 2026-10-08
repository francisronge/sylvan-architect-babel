import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceMotionOwnership } from '../replay/workspaceMotionOwnership.ts';

const atom = (id, word = id) => ({ id, word, children: [] });
const fork = (id, ...children) => ({ id, children });
function view(...roots) {
  const nodes = new Map(), parents = new Map(), material = new Map(), topology = new Map();
  function visit(node, owner) {
    nodes.set(node.id, node);
    if (owner) parents.set(node.id, owner);
    node.children.forEach(child => visit(child, node.id));
    material.set(node.id, JSON.stringify([node.word, node.children.map(child => [child.id, material.get(child.id)])]));
    topology.set(node.id, JSON.stringify(node.children.map(child => [child.id, topology.get(child.id)])));
  }
  roots.forEach(node => visit(node));
  return { material, topology, ids: () => nodes.keys(), has: id => nodes.has(id), parent: id => parents.get(id),
    children: id => nodes.get(id)?.children.map(child => child.id) ?? [],
    contains: (root, id) => { for (let p = id; p; p = parents.get(p)) if (p === root) return true; return false; },
    *members(root) { const pending = [root]; while (pending.length) { const id = pending.pop(); if (!nodes.has(id)) continue; yield id; pending.push(...nodes.get(id).children.map(child => child.id).reverse()); } }
  };
}
const motion = (before, current, step) => workspaceMotionOwnership({ before, current, step,
  sameMaterial: id => before.material.get(id) === current.material.get(id),
  sameTopology: id => before.topology.get(id) === current.topology.get(id) });
const relation = (overrides = {}) => ({ replayKind: 'relation', operation: 'Movement',
  replayRelationIdentity: { stageIndex: 1, relationIndex: 0 }, replayRelationLinks: [{
    authoredRelationKey: '1:0', renderFamily: 'trajectory', priorSourceNodeId: 'source', witnessNodeId: 'witness', targetNodeId: 'landing', ...overrides
  }] });
const names = iterable => [...iterable].sort();

test('new exact unary Project owns its complete unchanged input, not another workspace', () => {
  const input = fork('input', atom('word')), before = view(input, atom('other')), current = view(fork('project', input), atom('other'));
  const result = motion(before, current, { replayKind: 'micro', operation: 'Project', targetNodeId: 'project', sourceNodeIds: ['input'] });
  assert.deepEqual(names(result.owned), ['input', 'word']); assert.deepEqual(result.stationary, ['other']);
  for (const sourceNodeIds of [undefined, [], ['other'], ['input', 'other']]) {
    const invalid = motion(before, current, { replayKind: 'micro', operation: 'Project', targetNodeId: 'project', sourceNodeIds });
    assert.equal(invalid.owned.size, 0); assert.deepEqual(invalid.stationary, ['input', 'other']);
  }
});

test('new ordinary merge owns only its complete unchanged incoming components', () => {
  const left = fork('left', atom('word')), right = atom('right'), other = atom('other');
  const result = motion(view(left, right, other), view(fork('joined', left, right), other),
    { replayKind: 'micro', operation: 'ExternalMerge', targetNodeId: 'joined' });
  assert.deepEqual(names(result.owned), ['left', 'right', 'word']); assert.deepEqual(result.stationary, ['other']);
});

test('current head movement owns its exact receiver and leaves subject/object stationary', () => {
  const before = view(fork('clause', atom('subject'), atom('receiver'), fork('vp', atom('source'), atom('object'))));
  const current = view(fork('clause', atom('subject'), fork('complex', atom('landing'), atom('receiver')), fork('vp', atom('witness'), atom('object'))));
  const result = motion(before, current, relation());
  assert.deepEqual(names(result.owned), ['landing', 'receiver', 'source', 'witness']);
  assert.deepEqual(names(result.stationary), ['object', 'subject']);
  assert.deepEqual(motion(before, current, relation()), result);
});

test('an exact new extraction wrapper owns its retained host, never its outside sibling', () => {
  const before = view(fork('clause', atom('subject'), fork('host', atom('source'), atom('object'))));
  const current = view(fork('clause', atom('subject'), fork('wrapper', atom('landing'), fork('host', atom('witness'), atom('object')))));
  const result = motion(before, current, relation());
  assert.deepEqual(names(result.owned), ['host', 'landing', 'object', 'source', 'witness']);
  assert.deepEqual(result.stationary, ['subject']);
});

test('a new movement daughter on an existing projection owns only that receiving interior', () => {
  const before = view(fork('clause', atom('head'), fork('host', fork('bar', atom('source'), atom('object')))));
  const current = view(fork('clause', atom('head'), fork('host', atom('landing'), fork('bar', atom('witness'), atom('object')))));
  const result = motion(before, current, relation());
  assert.deepEqual(names(result.owned), ['bar', 'host', 'landing', 'object', 'source', 'witness']);
  assert.deepEqual(result.stationary, ['head']);
  for (const override of [{ authoredRelationKey: '0:0' }, { movementTransition: false }, { priorSourceNodeId: 'head' }]) {
    const invalid = motion(before, current, relation(override));
    assert(!invalid.owned.has('object'), 'an unrelated or unproved insertion cannot release the existing interior');
  }
  const extra = view(fork('clause', atom('head'), fork('host', atom('landing'), atom('unrelated'), fork('bar', atom('witness'), atom('object')))));
  assert(!motion(before, extra, relation()).owned.has('object'), 'unexplained sibling insertion is not movement-owned');
  const preexisting = view(fork('clause', atom('head'), fork('host', atom('landing'), fork('bar', atom('source'), atom('object')))));
  assert(!motion(preexisting, current, relation()).owned.has('object'), 'a persistent landing does not reopen its host');
});

test('adding a landing beside an existing fork does not release unrelated retained siblings', () => {
  for (const position of [0, 1, 2]) {
    const before = view(fork('host', atom('source'), atom('peer')));
    const children = [atom('witness'), atom('peer')]; children.splice(position, 0, atom('landing'));
    const current = view(fork('host', ...children));
    const result = motion(before, current, relation());
    assert(result.owned.has('source')); assert(result.owned.has('witness'));
    assert(!result.owned.has('peer')); assert(result.stationary.includes('peer'));
    assert(!result.owned.has('host'));
  }
});

for (const invalid of [
  { authoredRelationKey: '0:0' }, { renderFamily: 'authored-anchor-link' },
  { priorSourceNodeId: 'missing' }, { witnessNodeId: 'missing' }, { targetNodeId: 'missing' },
  { witnessNodeId: 'landing' }
]) test(`an invalid or stale relation cannot own anything: ${JSON.stringify(invalid)}`, () => {
  const before = view(atom('source'), atom('receiver'), atom('other'));
  const current = view(atom('witness'), fork('wrapper', atom('landing'), atom('receiver')), atom('other'));
  const result = motion(before, current, relation(invalid));
  assert.equal(result.owned.size, 0); assert.deepEqual(names(result.stationary), ['other', 'receiver']);
});

test('a stale trajectory on a nonrelation moment owns nothing', () => {
  const result = motion(view(atom('source'), atom('other')), view(atom('witness'), atom('landing'), atom('other')),
    { ...relation(), replayKind: 'micro' });
  assert.equal(result.owned.size, 0); assert.deepEqual(result.stationary, ['other']);
});

test('owned lower material does not suppress a wholly unowned sibling', () => {
  const parent = fork('parent', atom('source'), atom('other'));
  const result = motion(view(parent), view(parent, atom('landing')), relation({ witnessNodeId: 'source' }));
  assert.deepEqual(result.stationary, ['other']);
});

test('PF material change retains topology-stable points; missing or changed topology does not fabricate witnesses', () => {
  const before = view(fork('parent', atom('word', 'old')), atom('gone'));
  const current = view(fork('parent', atom('word', 'new')), atom('fresh'));
  const result = motion(before, current, { replayKind: 'relation', operation: 'PF' });
  assert.deepEqual(result.stationary, ['parent', 'word']); assert.equal(result.owned.size, 0);
  assert.deepEqual(motion(view(fork('parent', atom('old'))), view(fork('parent', atom('new'))), { replayKind: 'micro' }).stationary, []);
});

test('repeated identical frame views return deterministic witnesses without mutating either view', () => {
  const current = view(fork('parent', atom('a'), atom('b')), atom('other'));
  const initial = [...current.ids()], step = { replayKind: 'relation', operation: 'Agree' };
  const first = motion(current, current, step);
  for (let repeat = 0; repeat < 3; repeat++) assert.deepEqual(motion(current, current, step), first);
  assert.deepEqual(first.stationary, ['parent', 'other']); assert.deepEqual([...current.ids()], initial);
});
