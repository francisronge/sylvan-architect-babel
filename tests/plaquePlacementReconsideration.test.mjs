import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { caseAssignmentClears, placeStagePlaques, plaqueIdentity, plaquesOverlap, plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';

const tree = () => d3.tree().nodeSize([600, 300])(d3.hierarchy({ id: 'root', label: 'TP', children: [
  { id: 'tense', label: 'I' }, { id: 'subject', label: 'DP' }
]}));
const assignment = { kind: 'directed-path', pathStyle: 'case-assignment', fromNodeId: 'tense', toNodeId: 'subject',
  label: 'nominative', relationRef: { stageIndex: 0, relationIndex: 0 } };
const feature = { kind: 'node-plaque', plaqueStyle: 'feature', anchorNodeIds: ['tense'], title: 'Features',
  rows: [{ label: 'number', value: 'plural' }], relationRef: { stageIndex: 0, relationIndex: 0 } };
const lifetime = (obstacles, reconsider = true) => ({ sizes: new Map(), reconsider: new Set(reconsider ? [0] : []),
  spaceFor: (_index, anchor) => ({ obstacles, acceptsConnector: box =>
    box.caseRowY === undefined || caseAssignmentClears(anchor, box, obstacles) }) });

test('a changed participant geometry can replace a clear but remote Case pocket', () => {
  const nodes = tree().descendants(), obstacles = plaqueTreeObstacles(nodes);
  const ordinary = placeStagePlaques([assignment], nodes, obstacles).get(0);
  const remote = { ...ordinary, y: ordinary.y + 3000, location: 'below' };
  const source = nodes.find(node => node.data.id === 'tense');
  assert(obstacles.every(obstacle => !plaquesOverlap(remote, obstacle)));
  assert(caseAssignmentClears(source, remote, obstacles), 'the old pocket is still valid');
  const previous = new Map([[plaqueIdentity(assignment), remote]]);
  assert.deepEqual(placeStagePlaques([assignment], nodes, obstacles, previous, undefined,
    lifetime(obstacles, false)).get(0), remote, 'unchanged geometry keeps its current pocket');
  assert.deepEqual(placeStagePlaques([assignment], nodes, obstacles, previous, undefined,
    lifetime(obstacles)).get(0), ordinary, 'the relation boundary can restore the nearby pocket');
});

test('a valid earlier pocket seeds the complete local search when the initial pockets are blocked', () => {
  const nodes = tree().descendants();
  const obstacles = [...plaqueTreeObstacles(nodes), { x: -1500, y: -1500, width: 3000, height: 3000 }];
  const ordinary = placeStagePlaques([feature], nodes, obstacles).get(0);
  assert.equal(ordinary.location, 'local', 'the exhaustive gap search finds a pocket');
  const remote = { ...ordinary, y: ordinary.y + 6000 };
  const result = placeStagePlaques([feature], nodes, obstacles,
    new Map([[plaqueIdentity(feature), remote]]), undefined, lifetime(obstacles)).get(0);
  assert.deepEqual(result, ordinary);
  assert(obstacles.every(obstacle => !plaquesOverlap(result, obstacle)));
});

test('a tied prior Case pocket retains its geometry and ports', () => {
  const nodes = tree().descendants(), obstacles = plaqueTreeObstacles(nodes);
  const original = placeStagePlaques([assignment], nodes, obstacles).get(0);
  const result = placeStagePlaques([assignment], nodes, obstacles,
    new Map([[plaqueIdentity(assignment), original]]), undefined, lifetime(obstacles)).get(0);
  assert.deepEqual(result, original);
});
