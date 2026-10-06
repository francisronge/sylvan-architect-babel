import assert from 'node:assert/strict';
import test from 'node:test';
import { rigidPoseGraph } from '../replay/workspacePoseGraph.ts';
import { placeRigidGroups } from '../replay/workspacePosePlacement.ts';

const atom = (id, incarnation) => ({ id, incarnation, children: [], obstacles: [], members: new Map([[id, { x: 0, y: 0 }]]) });
const branch = (id, incarnation, children, slots) => ({ id, incarnation, children, obstacles: [],
  members: new Map([[id, { x: 0, y: 0 }], ...children.flatMap((child, index) => [...child.members].map(([id, p]) =>
    [id, { x: p.x + slots[index].x, y: p.y + slots[index].y }]))]) });
const frame = (roots, step = {}) => {
  const nodes = new Map();
  const visit = node => { nodes.set(node.id, node); node.children.forEach(visit); }; roots.forEach(visit);
  return { roots, nodes, step: { replayCanvasData: {}, replayKind: 'micro', operation: 'LexicalSelect', ...step } };
};
const refs = (...frames) => frames.map(nodes => ({ nodes: Object.entries(nodes).map(([id, [x, y]]) => ({ id, x, y })) }));
const projection = { operation: 'Project', targetNodeId: 'newHead', sourceNodeIds: ['word'] };

test('a stable selected word uses one pose before and after its new unary projection', () => {
  const word = atom('word', 0), head = branch('newHead', 1, [word], [{ x: 0, y: 100 + 1 / 3 }]);
  const graph = rigidPoseGraph([frame([word]), frame([head], projection), frame([head])]);
  assert.equal(graph.constraints.some(item => item.frame === 2 && item.id === 'word'), false, 'the Project still owns translation');
  const original = JSON.stringify({ parent: graph.union.parent, offset: graph.union.offset });
  const baseline = refs({ word: [500, 100] }, { newHead: [500, 0], word: [500, 100] }, { newHead: [500, 0], word: [500, 100] });
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = placeRigidGroups(graph, baseline);
    assert.equal(result.accepted, true);
    assert.deepEqual(result.coordinates[0].get('word'), result.coordinates[1].get('word'));
    assert.deepEqual(result.coordinates[1].get('word'), result.coordinates[2].get('word'));
    assert.equal(result.coordinates[1].get('word').y - result.coordinates[1].get('newHead').y, 100 + 1 / 3);
    assert.equal(JSON.stringify({ parent: graph.union.parent, offset: graph.union.offset }), original);
  }
});

test('a reference Project which already translates its input keeps that freedom', () => {
  const word = atom('word', 0), head = branch('newHead', 1, [word], [{ x: 0, y: 100 }]);
  const graph = rigidPoseGraph([frame([word]), frame([head], projection)]);
  const result = placeRigidGroups(graph, refs({ word: [0, 100] }, { newHead: [500, 0], word: [500, 100] }));
  assert.equal(result.accepted, true);
  assert.equal(result.coordinates[0].get('word').x, 0); assert.equal(result.coordinates[1].get('word').x, 500);
});

test('already stationary complete inputs retain their poses through an owned ordinary merge', () => {
  const word = atom('word', 0), left = branch('left', 1, [word], [{ x: 0, y: 100 }]), right = atom('right', 2);
  const joined = branch('joined', 3, [left, right], [{ x: -200, y: 300 }, { x: 200, y: 300 }]);
  const graph = rigidPoseGraph([frame([left, right]), frame([joined], { operation: 'ExternalMerge', targetNodeId: 'joined' })]);
  assert.equal(graph.constraints.length, 0, 'both inputs remain owned');
  const baseline = refs({ left: [-200, 300], word: [-200, 400], right: [200, 300] },
    { joined: [0, 0], left: [-200, 300], word: [-200, 400], right: [200, 300] });
  const result = placeRigidGroups(graph, baseline);
  assert.equal(result.accepted, true);
  for (const id of ['left', 'word', 'right']) assert.deepEqual(result.coordinates[0].get(id), result.coordinates[1].get(id));
});

test('independent complete inputs wait at their merge positions despite unrelated reference placement', () => {
  const word = atom('word', 0), left = branch('left', 1, [word], [{ x: 0, y: 100 }]), right = atom('right', 2);
  const joined = branch('joined', 3, [left, right], [{ x: -200, y: 300 }, { x: 200, y: 300 }]);
  const graph = rigidPoseGraph([frame([left, right]), frame([joined], { operation: 'ExternalMerge', targetNodeId: 'joined' })]);
  const original = JSON.stringify({ parent: graph.union.parent, offset: graph.union.offset });
  const result = placeRigidGroups(graph, refs({ left: [3000, 100], word: [3000, 200], right: [-2000, 500] },
    { joined: [0, 0], left: [-200, 300], word: [-200, 400], right: [200, 300] }));
  assert.equal(result.accepted, true);
  for (const id of ['left', 'word', 'right']) assert.deepEqual(result.coordinates[0].get(id), result.coordinates[1].get(id));
  assert.equal(result.coordinates[0].get('word').y - result.coordinates[0].get('left').y, 100);
  assert.equal(result.coordinates[0].has('joined'), false, 'waiting inputs do not reveal the future parent');
  assert.equal(JSON.stringify({ parent: graph.union.parent, offset: graph.union.offset }), original);
});

test('a relation attachment cannot acquire the waiting pose of an ordinary merge', () => {
  const left = atom('left', 0), right = atom('right', 1);
  const joined = branch('joined', 2, [left, right], [{ x: -200, y: 300 }, { x: 200, y: 300 }]);
  const graph = rigidPoseGraph([frame([left, right]), frame([joined], { replayKind: 'relation', operation: 'ExternalMerge', targetNodeId: 'joined' })]);
  const before = JSON.stringify({ parent: graph.union.parent, offset: graph.union.offset });
  const result = placeRigidGroups(graph, refs({ left: [-1000, 100], right: [1000, 500] },
    { joined: [0, 0], left: [-200, 300], right: [200, 300] }));
  assert.equal(result.accepted, true);
  assert.equal(JSON.stringify({ parent: graph.union.parent, offset: graph.union.offset }), before);
  assert.equal(graph.owned[1].size, 0, 'ordinary merge ownership must not be fabricated for a relation');
});

for (const changedHead of [false, true]) test(`a movement receiver ${changedHead ? 'does not pin changed material' : 'keeps its unchanged head while the landing moves'}`, () => {
  const source = atom('source', 0), head = atom('head', 1), bystander = atom('bystander', 2);
  const host = branch('host', 3, [source, head], [{ x: -100, y: 100 }, { x: 100, y: 100 }]);
  const witness = atom('source', 4), landing = atom('landing', 5);
  const afterHost = branch('host', 6, [witness, changedHead ? atom('head', 7) : head],
    [{ x: -100, y: 100 }, { x: 100, y: 100 }]);
  const wrapper = branch('wrapper', 8, [landing, afterHost], [{ x: -200, y: 100 }, { x: 200, y: 100 }]);
  const movement = { replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 },
    replayRelationLinks: [{ authoredRelationKey: '1:0', renderFamily: 'trajectory', priorSourceNodeId: 'source', witnessNodeId: 'source', targetNodeId: 'landing' }] };
  const graph = rigidPoseGraph([frame([host, bystander]), frame([wrapper, bystander], movement)]);
  const result = placeRigidGroups(graph, refs({ host: [0, 0], source: [-100, 100], head: [100, 100], bystander: [-1000, 0] },
    { wrapper: [2000, 0], landing: [1800, 100], host: [2200, 100], source: [2100, 200], head: [2300, 200], bystander: [-1000, 0] }));
  assert.equal(result.accepted, true);
  assert.deepEqual(result.coordinates[0].get('bystander'), result.coordinates[1].get('bystander'));
  if (changedHead) assert.notDeepEqual(result.coordinates[0].get('head'), result.coordinates[1].get('head'));
  else assert.deepEqual(result.coordinates[0].get('head'), result.coordinates[1].get('head'));
  assert.notDeepEqual(result.coordinates[0].get('source'), result.coordinates[1].get('landing'));
  assert.equal(result.coordinates[0].has('landing'), false);
  assert.equal(result.coordinates[1].get('head').y - result.coordinates[1].get('host').y, 100);
});

test('an internal Project retains its owned attachment freedom and stationary sister', () => {
  const word = atom('word', 0), sister = atom('sister', 1);
  const first = branch('parent', 2, [word, sister], [{ x: -100, y: 100 }, { x: 100, y: 100 }]);
  const head = branch('newHead', 3, [word], [{ x: 0, y: 100 }]);
  const second = branch('parent', 4, [head, sister], [{ x: -100, y: 100 }, { x: 100, y: 100 }]);
  const graph = rigidPoseGraph([frame([first]), frame([second], projection)]);
  assert.ok(graph.constraints.some(item => item.id === 'sister')); assert.ok(!graph.constraints.some(item => item.id === 'word'));
  const result = placeRigidGroups(graph, refs({ parent: [0, 0], word: [-100, 100], sister: [100, 100] },
    { parent: [0, 0], newHead: [-100, 100], word: [-100, 100], sister: [100, 100] }));
  assert.equal(result.accepted, true);
  assert.deepEqual(result.coordinates[0].get('sister'), result.coordinates[1].get('sister'));
  assert.equal(result.coordinates[1].get('word').y - result.coordinates[0].get('word').y, 100);
});

test('a rejected optional tie cannot poison required equations or create fixed lifetime collisions', () => {
  const a = atom('a', 0), wide = atom('b', 1), narrow = atom('b', 2), landing = atom('landing', 3);
  a.obstacles = [{ x: -10, y: -10, width: 20, height: 20 }];
  wide.obstacles = [{ x: -100, y: -10, width: 200, height: 20 }];
  narrow.obstacles = [{ x: -10, y: -10, width: 20, height: 20 }];
  const parent = branch('parent', 4, [a, narrow], [{ x: -25, y: 100 }, { x: 25, y: 100 }]);
  const movement = { replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 },
    replayRelationLinks: [{ authoredRelationKey: '1:0', renderFamily: 'trajectory', priorSourceNodeId: 'a', witnessNodeId: 'a', targetNodeId: 'landing' }] };
  const graph = rigidPoseGraph([frame([a, wide]), frame([a, narrow, landing], movement),
    frame([parent, landing], { replayKind: 'macro', operation: 'StageRecord' })]);
  assert.equal(graph.conflicts.length, 0);
  const original = JSON.stringify({ parent: graph.union.parent, offset: graph.union.offset });
  const baseline = refs({ a: [0, 0], b: [1000, 0] }, { a: [0, 0], b: [1000, 0], landing: [-1000, 0] },
    { parent: [500, -100], a: [0, 0], b: [1000, 0], landing: [-1000, 0] });
  const result = placeRigidGroups(graph, baseline);
  assert.equal(result.accepted, true, 'collision rejects the optional tie, not the complete mandatory plan');
  const startA = result.coordinates[0].get('a'), startB = result.coordinates[0].get('b');
  assert.ok(Math.abs(startA.x - startB.x) >= 110, 'the earlier wider sibling stays clear');
  assert.notEqual(startA.x, result.coordinates[1].get('a').x, 'owned translation remains available when preserving zero motion would collide');
  assert.equal(JSON.stringify({ parent: graph.union.parent, offset: graph.union.offset }), original);
});
