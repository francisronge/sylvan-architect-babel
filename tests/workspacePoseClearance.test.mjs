import assert from 'node:assert/strict';
import test from 'node:test';
import { rigidPoseGraph } from '../replay/workspacePoseGraph.ts';
import { placeRigidGroups } from '../replay/workspacePosePlacement.ts';
import { cubicIntersectsRect } from '../replay/relations/curveClearance.ts';

const atom = (id, incarnation, obstacles = []) => ({ id, incarnation, children: [], obstacles,
  members: new Map([[id, { x: 0, y: 0 }]]) });
const frame = (roots, step = {}) => {
  const nodes = new Map();
  const visit = node => { nodes.set(node.id, node); node.children.forEach(visit); };
  roots.forEach(visit);
  return { roots, nodes, step: { replayCanvasData: {}, replayKind: 'micro', operation: 'LexicalSelect', ...step } };
};
const refs = (...frames) => frames.map(nodes => ({ nodes: Object.entries(nodes).map(([id, [x, y]]) => ({ id, x, y })) }));
const translate = (rect, x, y) => ({ ...rect, x: rect.x + x, y: rect.y + y,
  ...(rect.curve ? { curve: Object.fromEntries(Object.entries(rect.curve).map(([key, point]) =>
    [key, { x: point.x + x, y: point.y + y }])) } : {}) });
const collides = (a, b) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) + 1e-6
  && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y) + 1e-6
  && (!a.curve || cubicIntersectsRect(a.curve, b, a.curvePadding))
  && (!b.curve || cubicIntersectsRect(b.curve, a, b.curvePadding));

test('an isolated pose does not materialize collision ink but later peers still receive clearance', () => {
  const single = atom('single', 0);
  Object.defineProperty(single, 'obstacles', { get() { throw Error('isolated ink has no collision opponent'); } });
  const alone = placeRigidGroups(rigidPoseGraph([frame([single])]), refs({ single: [50, 70] }));
  assert.equal(alone.accepted, true);
  assert.deepEqual(alone.coordinates[0].get('single'), { x: 50, y: 70 });
  const left = atom('left', 1, [{ x: -10, y: -10, width: 20, height: 20 }]);
  const right = atom('right', 2, [{ x: -10, y: -10, width: 20, height: 20 }]);
  const pair = placeRigidGroups(rigidPoseGraph([frame([left, right])]), refs({ left: [0, 0], right: [0, 0] }));
  assert.equal(pair.accepted, true);
  assert.deepEqual(pair.coordinates[0].get('left'), { x: 0, y: 0 });
  assert.deepEqual(pair.coordinates[0].get('right'), { x: -21, y: 0 });
});

test('fixed pose conflicts retain every exact contact, pair order, metadata and shared translated objects', () => {
  const left = atom('left', 0, Array.from({ length: 40 }, (_, index) => ({
    x: -30, y: (index % 9) * 31 - 120, width: 50, height: 22, owner: `left-${index}`
  })));
  const right = atom('right', 1, Array.from({ length: 48 }, (_, index) => ({
    x: -20, y: ((index * 7) % 13) * 23 - 120, width: 40, height: 19, owner: `right-${index}`
  })));
  const curve = { source: { x: 400, y: -500 }, control1: { x: 400, y: 0 },
    control2: { x: 400, y: 100 }, target: { x: 400, y: 500 } };
  right.obstacles.splice(5, 0, { x: -100, y: -500, width: 600, height: 1000, curve, curvePadding: 1, owner: 'curve-miss' });
  right.obstacles.splice(19, 0, { x: -10, y: -1000, width: 10, height: 2000, owner: 'long' });
  right.obstacles.push({ x: -10, y: NaN, width: 10, height: 10, owner: 'nonfinite' });
  const graph = rigidPoseGraph([frame([left, right])]);
  const delta = { x: 1 / 3, y: 2 / 3 };
  graph.union.join(graph.variables[0].get('left'), graph.variables[0].get('right'), delta);
  const before = structuredClone({ parent: graph.union.parent, offset: graph.union.offset });
  const a = left.obstacles.map(rect => translate(rect, 0, 0));
  const b = right.obstacles.map(rect => translate(rect, delta.x, delta.y));
  const pairs = a.flatMap(x => b.filter(y => collides(x, y)).map(y => ({ a: x, b: y })));
  const result = placeRigidGroups(graph, refs({ left: [0, 0], right: [0, 0] }));
  assert.deepEqual(result, { accepted: false, reason: 'fixed-group-clearance',
    conflicts: [{ frame: 1, roots: ['left', 'right'], pairs }] });
  assert.ok(pairs.length > 20);
  assert.equal(result.conflicts[0].pairs.some(pair => pair.b.owner === 'curve-miss'), false);
  const first = result.conflicts[0].pairs[0];
  const sameLeft = result.conflicts[0].pairs.find((pair, index) => index > 0 && pair.a.owner === first.a.owner);
  assert.equal(first.a, sameLeft.a);
  assert.notEqual(first.a, left.obstacles[0]);
  assert.deepEqual({ parent: graph.union.parent, offset: graph.union.offset }, before);
});

test('exact touching, epsilon overlaps and nonfinite boxes retain the nested collision predicate', () => {
  const values = [-Infinity, -1, -0, 0, 1e-6, 1, 1 + 1e-6, 1 + 2e-6, 2 ** 53, Infinity, NaN];
  const left = atom('left', 0, values.map(y => ({ x: 0, y, width: 2, height: 1 })));
  const right = atom('right', 1, values.map(y => ({ x: 0, y, width: 2, height: 1 })));
  const graph = rigidPoseGraph([frame([left, right])]);
  graph.union.join(graph.variables[0].get('left'), graph.variables[0].get('right'), { x: 0, y: 0 });
  const a = left.obstacles.map(rect => translate(rect, 0, 0)), b = right.obstacles.map(rect => translate(rect, 0, 0));
  const pairs = a.flatMap(x => b.filter(y => collides(x, y)).map(y => ({ a: x, b: y })));
  const result = placeRigidGroups(graph, refs({ left: [0, 0], right: [0, 0] }));
  assert.deepEqual(result.conflicts[0].pairs, pairs);
  right.obstacles.forEach(rect => { rect.x = 20; });
  assert.equal(placeRigidGroups(graph, refs({ left: [0, 0], right: [0, 0] })).accepted, true,
    'the broad phase is scoped to the current placement call');
});

test('many disjoint obstacles do not change a rejected optional tie or its later placement', () => {
  const make = padded => {
    const a = atom('a', 0, [{ x: -10, y: -10, width: 20, height: 20 }]);
    const wide = atom('b', 1, [{ x: -100, y: -10, width: 200, height: 20 }]);
    const narrow = atom('b', 2, [{ x: -10, y: -10, width: 20, height: 20 }]);
    const landing = atom('landing', 3);
    if (padded) wide.obstacles.unshift(...Array.from({ length: 30 }, (_, index) => ({
      x: -100, y: 1000 + index * 100, width: 200, height: 20
    })));
    const parent = { id: 'parent', incarnation: 4, children: [a, narrow], obstacles: [],
      members: new Map([['parent', { x: 0, y: 0 }], ['a', { x: -25, y: 100 }], ['b', { x: 25, y: 100 }]]) };
    const movement = { replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 },
      replayRelationLinks: [{ authoredRelationKey: '1:0', renderFamily: 'trajectory', priorSourceNodeId: 'a', witnessNodeId: 'a', targetNodeId: 'landing' }] };
    const graph = rigidPoseGraph([frame([a, wide]), frame([a, narrow, landing], movement),
      frame([parent, landing], { replayKind: 'macro', operation: 'StageRecord' })]);
    return placeRigidGroups(graph, refs({ a: [0, 0], b: [1000, 0] }, { a: [0, 0], b: [1000, 0], landing: [-1000, 0] },
      { parent: [500, -100], a: [0, 0], b: [1000, 0], landing: [-1000, 0] }));
  };
  const expected = make(false);
  assert.equal(expected.accepted, true);
  assert.deepEqual(make(true), expected);
});
