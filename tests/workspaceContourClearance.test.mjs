import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { separateWorkspaceContours } from '../replay/workspaceContourClearance.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';

const leaf = id => ({ id, label: 'N', word: id });
const group = (id, child) => ({ id, label: 'NP', children: [leaf(child)] });
function scene(children, points) {
  const canvas = { id: 'workspace', label: 'Workspace', replayOrigin: { kind: 'workspace' }, children };
  const root = d3.hierarchy(canvas); applyVizIds(root);
  const nodes = new Map(root.descendants().map(node => [getNodeId(node), node]));
  return { canvas, nodes, visible: new Set([...nodes.keys()].filter(id => id !== 'workspace')),
    coordinates: new Map(Object.entries(points).map(([id, [x, y]]) => [id, { x, y }])) };
}

test('clearance moves independent components rigidly by one offset throughout the stage', () => {
  const scenes = [scene([group('a', 'a-word'), group('b', 'b-word')], {
    workspace: [0, 0], a: [0, 50], 'a-word': [0, 250], b: [50, 50], 'b-word': [50, 250]
  }), scene([leaf('a-word'), group('b', 'b-word')], {
    workspace: [0, 0], 'a-word': [0, 250], b: [50, 50], 'b-word': [50, 250]
  })];
  const original = structuredClone(scenes.map(scene => scene.coordinates)), data = JSON.stringify(scenes.map(scene => scene.canvas));
  const result = separateWorkspaceContours(scenes), dx = result[0].coordinates.get('b').x - original[0].get('b').x;
  assert(dx > 0, 'the current collision requires clearance');
  for (let i = 0; i < scenes.length; i++) {
    for (const id of ['b', 'b-word']) {
      assert.equal(result[i].coordinates.get(id).x - original[i].get(id).x, dx);
      assert.equal(result[i].coordinates.get(id).y, original[i].get(id).y);
    }
    assert.deepEqual(result[i].coordinates.get('a-word'), original[i].get('a-word'));
    assert.deepEqual(scenes[i].coordinates, original[i], 'input coordinates remain immutable');
    assert.equal(result[i].canvas, scenes[i].canvas, 'no layout scaffolding enters syntax');
  }
  assert.equal(JSON.stringify(scenes.map(scene => scene.canvas)), data);
});

test('an ambiguous earlier component cannot be assigned to either final workspace', () => {
  const final = scene([group('a', 'a-word'), group('b', 'b-word')], {
    workspace: [0, 0], a: [0, 50], 'a-word': [0, 250], b: [50, 50], 'b-word': [50, 250]
  });
  const prior = scene([{ id: 'mixed', label: 'XP', children: [leaf('a-word'), leaf('b-word')] }], {
    workspace: [0, 0], mixed: [0, 50], 'a-word': [-50, 250], 'b-word': [50, 250]
  });
  const scenes = [final, prior];
  assert.equal(separateWorkspaceContours(scenes), scenes, 'ambiguous membership retains the accepted plan');
});
