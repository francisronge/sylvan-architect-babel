import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { addsOwnedDisplayTerminal, changesOwnedDisplayTerminal } from '../replay/workspaceDisplayTerminal.ts';
import { workspaceMotionOwnership } from '../replay/workspaceMotionOwnership.ts';
import { workspaceContinuityReflows } from '../replay/workspaceShapeReflows.ts';
import { prepareWorkspaceLifetimeContours } from '../replay/workspaceLifetimeContours.ts';
import { rigidPoseGraph } from '../replay/workspacePoseGraph.ts';
import { placeRigidGroups } from '../replay/workspacePosePlacement.ts';

const head = (id = 'head') => ({ id, label: 'I', children: [] });
const pronounced = (id = 'head', childId = 'opaque-display', word = 'did') => ({ ...head(id), word,
  children: [{ id: childId, label: word, word, replayOrigin: { kind: 'word', ownerId: id } }] });
const fork = (...children) => ({ id: 'parent', label: 'P', children });
const peer = () => ({ id: 'peer', label: 'C', children: [] });
function view(canvas, excluded = []) {
  const tree = d3.hierarchy(canvas); applyVizIds(tree);
  const nodes = new Map(tree.descendants().filter(node => !excluded.includes(getNodeId(node))).map(node => [getNodeId(node), node]));
  const parent = id => { const p = nodes.get(id)?.parent; return p && nodes.has(getNodeId(p)) ? getNodeId(p) : undefined; };
  const children = id => (nodes.get(id)?.children ?? []).filter(node => nodes.has(getNodeId(node))).map(getNodeId);
  const key = (id, material) => JSON.stringify([id, ...(material ? [nodes.get(id)?.data.label, nodes.get(id)?.data.word, nodes.get(id)?.data.silent] : []), children(id).map(child => key(child, material))]);
  return { canvas, nodes, parent, children, key, ids: () => nodes.keys(), has: id => nodes.has(id),
    contains: (root, id) => { for (let p = id; p; p = parent(p)) if (p === root) return true; return false; },
    *members(root) { const pending = [root]; while (pending.length) { const id = pending.pop(); if (!nodes.has(id)) continue; yield id; pending.push(...children(id).reverse()); } } };
}
const step = (canvas, fields = {}) => ({ replayCanvasData: canvas, replayVisibleNodeIds: [...view(canvas).nodes.keys()],
  replayKind: 'relation', operation: 'PF', ...fields });
const motion = (before, current, event = {}) => workspaceMotionOwnership({ step: { replayKind: 'relation', operation: 'PF', ...event }, before, current,
  sameMaterial: id => before.has(id) && current.has(id) && before.key(id, true) === current.key(id, true),
  sameTopology: id => before.has(id) && current.has(id) && before.key(id, false) === current.key(id, false),
  displayTerminalChange: id => changesOwnedDisplayTerminal(before.nodes, current.nodes, id) });

for (const id of ['head', 'literal::__leaf', 'opaque:/頭']) test(`${id}: exact generated terminal addition/removal keeps the visible owner stationary`, () => {
  const a = fork(head(id), peer()), b = fork(pronounced(id, 'unrelated-child-spelling'), peer()), before = view(a), current = view(b);
  const saved = JSON.stringify([a, b]);
  assert.equal(addsOwnedDisplayTerminal(before.nodes, current.nodes, id), true);
  assert.equal(addsOwnedDisplayTerminal(current.nodes, before.nodes, id), false);
  for (const [a, b] of [[before, current], [current, before]]) {
    assert.equal(changesOwnedDisplayTerminal(a.nodes, b.nodes, id), true);
    const result = motion(a, b);
    assert(result.stationary.includes(id)); assert.equal(result.owned.size, 0);
  }
  assert.equal(JSON.stringify([a, b]), saved);
});

test('sentence-initial display casing uses the existing authored-word normalization', () => {
  const current = pronounced(); current.children[0].word = current.children[0].label = 'Did';
  assert.equal(changesOwnedDisplayTerminal(view(head()).nodes, view(current).nodes, 'head'), true);
});

for (const [name, mutate] of [
  ['authored terminal', b => { delete b.children[0].children[0].replayOrigin; }],
  ['lexical origin', b => { b.children[0].children[0].replayOrigin.kind = 'lexical'; }],
  ['wrong current owner', b => { b.children[0].children[0].replayOrigin.ownerId = 'peer'; }],
  ['owner alias only', b => { b.children[0].aliasIds = ['alias']; b.children[0].children[0].replayOrigin.ownerId = 'alias'; }],
  ['wrong word', b => { b.children[0].children[0].word = b.children[0].children[0].label = 'does'; }],
  ['word-label mismatch', b => { b.children[0].children[0].label = 'wrong'; }],
  ['generated child with syntax children', b => { b.children[0].children[0].children = [head('grandchild')]; }],
  ['two current children', b => { b.children[0].children.push(head('additional')); }],
  ['new category', b => { b.children[0].label = 'Different'; }],
  ['changed silence at the new topology', b => { b.children[0].silent = true; }],
  ['changed connected parent', b => { b.children[0] = { id: 'wrapper', label: 'XP', children: [b.children[0]] }; }]
]) test(`${name} is not an exact display-only topology change`, () => {
  const a = fork(head(), peer()), b = fork(pronounced(), peer()); mutate(b);
  const before = view(a), current = view(b);
  assert.equal(changesOwnedDisplayTerminal(before.nodes, current.nodes, 'head'), false);
  assert.equal(motion(before, current).stationary.includes('head'), false);
});

test('a previously present loose terminal cannot become a newly generated display child', () => {
  const current = fork(pronounced(), peer());
  const old = fork(head(), peer(), structuredClone(current.children[0].children[0]));
  assert.equal(changesOwnedDisplayTerminal(view(old).nodes, view(current).nodes, 'head'), false);
});
test('an invisible owner cannot borrow a visible descendant island', () => {
  const a = fork(head(), peer()), b = fork(pronounced(), peer());
  for (const [before, current] of [[view(a, ['head']), view(b)], [view(a), view(b, ['head'])]])
    assert.equal(changesOwnedDisplayTerminal(before.nodes, current.nodes, 'head'), false);
});
test('hidden authored children never qualify as current display children', () => {
  const b = fork(pronounced(), peer()), before = view(fork(head(), peer())), current = view(b, ['opaque-display']);
  assert.equal(changesOwnedDisplayTerminal(before.nodes, current.nodes, 'head'), false);
});
test('topology-stable word and silence changes retain their existing stationary rule', () => {
  const a = view({ id: 'head', label: 'I', word: 'old', silent: false }), b = view({ id: 'head', label: 'I', word: 'new', silent: true });
  assert.equal(changesOwnedDisplayTerminal(a.nodes, b.nodes, 'head'), false);
  assert.deepEqual(motion(a, b).stationary, ['head']);
});

test('exact active movement still owns the source and lower occurrence', () => {
  const before = view(fork(head(), peer())), current = view(fork(pronounced(), peer(), { id: 'landing', label: 'I', word: 'did' }));
  const result = motion(before, current, { replayRelationIdentity: { stageIndex: 1, relationIndex: 0 }, replayRelationLinks: [{
    authoredRelationKey: '1:0', renderFamily: 'trajectory', priorSourceNodeId: 'head', witnessNodeId: 'head', targetNodeId: 'landing'
  }] });
  assert(result.owned.has('head')); assert(!result.stationary.includes('head')); assert(result.stationary.includes('peer'));
});

for (const reverse of [false, true]) test(`${reverse ? 'removing' : 'adding'} a display leaf constrains the complete existing fork`, () => {
  const raw = [fork(head(), peer()), fork(pronounced(), peer())]; if (reverse) raw.reverse();
  const steps = raw.map(canvas => step(canvas)), saved = JSON.stringify(steps), compose = prepareWorkspaceLifetimeContours(steps);
  const initial = compose(), preferred = new Map();
  for (const frame of initial) for (const shape of frame.nodes.values()) if (!preferred.has(shape.incarnation))
    preferred.set(shape.incarnation, new Map([...shape.members].map(([id, point]) => [id, { ...point }])));
  for (const [index, frame] of initial.entries()) {
    const points = preferred.get(frame.nodes.get('parent').incarnation);
    points.set('head', { x: index ? -1900 : -2000, y: 220 });
    points.set('peer', { x: 2000, y: 220 });
  }
  const frames = compose(undefined, { inheritCurrentSlots: true, preferred });
  const before = frames[0].nodes.get('parent'), current = frames[1].nodes.get('parent');
  for (const id of ['head', 'peer']) assert.deepEqual(current.members.get(id), before.members.get(id));
  assert(frames[1].displayTerminalChanges.has('head'));
  const graph = rigidPoseGraph(frames); assert.equal(graph.conflicts.length, 0);
  assert(graph.constraints.some(constraint => constraint.frame === 2 && constraint.id === 'head'));
  assert.equal(JSON.stringify(steps), saved);
});

test('a loose head gets an explicit stationary equation when its generated word appears', () => {
  const steps = [step(head()), step(pronounced())], frames = prepareWorkspaceLifetimeContours(steps)();
  const graph = rigidPoseGraph(frames);
  assert.equal(graph.conflicts.length, 0); assert(graph.constraints.some(constraint => constraint.id === 'head'));
  const placed = placeRigidGroups(graph, [{ nodes: [{ id: 'head', x: 100, y: 80 }] }, { nodes: [{ id: 'head', x: 900, y: 80 }] }]);
  assert.equal(placed.accepted, true);
  assert.deepEqual(placed.coordinates[1].get('head'), placed.coordinates[0].get('head'));
});

test('display-only pronunciation cannot recenter any strict ancestor', () => {
  const nested = h => ({ id: 'cp', label: 'CP', children: [{ id: 'outside', label: 'NP' },
    { id: 'cbar', label: "C'", children: [{ id: 'complex', label: 'C', children: [h, peer()] },
      { id: 'clause', label: 'TP', children: [{ id: 'subject', label: 'DP' }, { id: 'predicate', label: 'VP' }] }] }] });
  const steps = [step(nested(head())), step(nested(pronounced()))], compose = prepareWorkspaceLifetimeContours(steps);
  const initial = compose(), preferred = new Map();
  for (const frame of initial) for (const shape of frame.nodes.values()) if (!preferred.has(shape.incarnation)) {
    const positions = new Map([...shape.members].map(([id, point]) => [id, { ...point }]));
    for (const child of shape.children) positions.get(child.id).x *= 10;
    preferred.set(shape.incarnation, positions);
  }
  preferred.get(initial[1].nodes.get('complex').incarnation).get('head').x += 0.4449698606522361;
  const frames = compose(undefined, { inheritCurrentSlots: true, preferred });
  const graph = rigidPoseGraph(frames); assert.equal(graph.conflicts.length, 0);
  const baseline = frames.map((frame, index) => ({ nodes: [...frame.roots[0].members].map(([id, point]) => ({ id, x: point.x + index * 100, y: point.y })) }));
  const placed = placeRigidGroups(graph, baseline); assert.equal(placed.accepted, true);
  for (const id of ['cp', 'cbar', 'complex', 'head', 'peer', 'outside', 'clause', 'subject', 'predicate']) {
    const before = placed.coordinates[0].get(id), current = placed.coordinates[1].get(id);
    assert(Math.abs(before.x - current.x) <= 1e-8 && Math.abs(before.y - current.y) <= 1e-8, `${id} remains stationary`);
  }
});

for (const direction of [1, -1]) test(`${direction}: the shared detector catches a display-induced parent recentering cascade`, () => {
  const canvases = [fork(head(), peer()), fork(pronounced(), peer())], scenes = canvases.map(canvas => ({ ...view(canvas), step: step(canvas) }));
  const baseline = new Map(scenes.map((scene, index) => [scene.canvas, new Map([...scene.nodes].map(([id]) => [id,
    { x: direction * (id === 'head' || id === 'opaque-display' ? -100 + index * 2 : id === 'peer' ? 100 : index), y: id === 'parent' ? 0 : id === 'opaque-display' ? 440 : 220 }]))]));
  const render = (scene, coordinates) => [...scene.nodes.values()].map(node => ({ ...node, ...coordinates.get(getNodeId(node)) }));
  const flags = workspaceContinuityReflows(scenes, baseline, render);
  assert(flags.some(flag => flag.kind === 'unowned-component-motion' && flag.rootId === 'head'));
});
