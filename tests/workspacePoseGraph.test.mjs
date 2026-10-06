import assert from 'node:assert/strict';
import test from 'node:test';
import { rigidPoseGraph } from '../replay/workspacePoseGraph.ts';
const atom = (id, incarnation) => ({ id, incarnation, children: [], members: new Map([[id, { x: 0, y: 0 }]]), obstacles: [] });
const branch = (id, incarnation, children, slots) => ({ id, incarnation, children, members: new Map([[id, { x: 0, y: 0 }], ...children.flatMap((child, i) => [...child.members].map(([name, p]) => [name, { x: p.x + slots[i], y: p.y + 100 }]))]), obstacles: [] });
const frame = (roots, step = {}) => {
    const nodes = new Map(), visit = node => { nodes.set(node.id, node); node.children.forEach(visit); };
    roots.forEach(visit);
    return { roots, nodes, step: { replayCanvasData: {}, replayKind: 'micro', operation: 'LexicalSelect', ...step } };
};
test('a newly selected loose head cannot break the existing component pose lifetime', () => {
    const a = atom('a', 0), word = atom('word', 1), root = branch('root', 2, [a, word], [-100, 100]), head = atom('head', 3);
    const graph = rigidPoseGraph([frame([root]), frame([head, root])]);
    assert.equal(graph.conflicts.length, 0);
    const before = graph.union.find(graph.variables[0].get('root')), after = graph.union.find(graph.variables[1].get('root'));
    assert.equal(before.group, after.group);
    assert.deepEqual(before.offset, after.offset);
});
test('two contradictory unchanged bystanders reject an independently reflowed changing shell', () => {
    const a = atom('a', 0), b = atom('b', 1), left = branch('root', 2, [a, b], [-100, 100]), right = branch('root', 3, [a, b], [-150, 150]);
    const graph = rigidPoseGraph([frame([left]), frame([right])]);
    assert.ok(graph.conflicts.length > 0);
    assert.ok(graph.conflicts.every(item => item.distance > 0));
    assert.ok(graph.constraints.some(item => item.id === 'a'));
    assert.ok(graph.constraints.some(item => item.id === 'b'));
});
test('an actual new ordinary merge permits both complete incoming components to translate rigidly', () => {
    const a = atom('a', 0), b = atom('b', 1), joined = branch('joined', 2, [a, b], [-100, 100]);
    const graph = rigidPoseGraph([frame([a, b]), frame([joined], { operation: 'ExternalMerge', targetNodeId: 'joined' })]);
    assert.equal(graph.conflicts.length, 0);
    assert.equal(graph.constraints.length, 0);
});
test('projecting a new unary head keeps its already selected terminal at its current world position', () => {
    const word = atom('word', 0), head = branch('head', 1, [word], [0]);
    const graph = rigidPoseGraph([frame([word]), frame([head], { operation: 'Project', targetNodeId: 'head' })]);
    assert.equal(graph.conflicts.length, 0);
    assert.equal(graph.constraints.length, 1);
    const a = graph.union.find(graph.variables[0].get('word')), b = graph.union.find(graph.variables[1].get('head'));
    assert.equal(a.group, b.group);
    assert.equal(a.offset.x, b.offset.x);
    assert.equal(a.offset.y, b.offset.y + 100);
});
test('a stale trajectory cannot grant the changed shell a stationary-bystander exemption', () => {
    const a = atom('a', 0), b = atom('b', 1), left = branch('root', 2, [a, b], [-100, 100]), right = branch('root', 3, [a, b], [-150, 150]);
    const step = { replayKind: 'relation', replayRelationIdentity: { stageIndex: 2, relationIndex: 0 }, replayRelationLinks: [{ authoredRelationKey: '1:0', renderFamily: 'trajectory', priorSourceNodeId: 'a', witnessNodeId: 'a', targetNodeId: 'b' }] };
    const graph = rigidPoseGraph([frame([left]), frame([right], step)]);
    assert.ok(graph.conflicts.length > 0);
});
test('shared canvas relation moments share one immutable placement map', () => {
    const a = atom('a', 0), b = atom('b', 1), root = branch('root', 2, [a, b], [-100, 100]), canvas = {};
    const step = { replayCanvasData: canvas, replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 }, replayRelationLinks: [{ authoredRelationKey: '1:0', renderFamily: 'trajectory', priorSourceNodeId: 'a', witnessNodeId: 'a', targetNodeId: 'b' }] };
    const graph = rigidPoseGraph([frame([root], { replayCanvasData: canvas }), frame([root], step)]);
    assert.equal(graph.union.find(graph.variables[0].get('root')).group, graph.union.find(graph.variables[1].get('root')).group);
    assert.equal(graph.conflicts.length, 0);
});
test('owned pronounced lower occurrence does not release its unchanged sibling', () => {
    const a = atom('a', 0), b = atom('b', 1), parent = branch('parent', 2, [a, b], [-100, 100]), landing = atom('landing', 3);
    const step = { replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 }, replayRelationLinks: [{ authoredRelationKey: '1:0', renderFamily: 'trajectory', priorSourceNodeId: 'a', witnessNodeId: 'a', targetNodeId: 'landing' }] };
    const graph = rigidPoseGraph([frame([parent]), frame([parent, landing], step)]);
    assert.equal(graph.conflicts.length, 0);
    assert.ok(graph.constraints.some(item => item.id === 'b'));
    assert.equal(graph.union.find(graph.variables[0].get('parent')).group, graph.union.find(graph.variables[1].get('parent')).group);
    assert.notEqual(graph.union.find(graph.variables[1].get('landing')).group, graph.union.find(graph.variables[1].get('parent')).group);
});
test('a new spelling is a stationary point witness without movement ownership', () => {
    const a = atom('word', 0), b = atom('word', 1), graph = rigidPoseGraph([frame([a]), frame([b], { replayKind: 'relation', operation: 'PF' })]);
    assert.equal(graph.conflicts.length, 0);
    assert.equal(graph.constraints.length, 1);
    const first = graph.union.find(graph.variables[0].get('word')), last = graph.union.find(graph.variables[1].get('word'));
    assert.equal(first.group, last.group);
    assert.deepEqual(first.offset, last.offset);
});
