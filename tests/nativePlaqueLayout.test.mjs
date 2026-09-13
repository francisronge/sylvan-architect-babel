import assert from 'node:assert/strict';
import test from 'node:test';
import { dependentCaseStatePlaques, featureSharingPlaqueRect } from '../replay/relations/markGeometry.ts';
import { nativeRelationPlaqueRects } from '../replay/relations/plaquePlacement.ts';
import { buildStageCameraBounds } from '../replay/stageCamera.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';

const probe = { x: 100, y: 200, width: 80, height: 60 };
const goal = { x: 500, y: 200, width: 80, height: 60 };
const ref = { stageIndex: 0, relationIndex: 0, relation: 'Fixture', anchors: {} };
const items = [
  { kind: 'undirected-link', linkStyle: 'feature-sharing', pairs: [{ fromNodeId: 'a', toNodeId: 'b' }], relationRef: ref },
  { kind: 'directed-path', pathStyle: 'dependent-case', fromNodeId: 'a', toNodeId: 'b',
    label: 'unvalued', secondaryLabel: 'accusative', dependentCaseStep: '1', relationRef: ref }
];

test('native boxes preserve the Orchard dimensions and short connector gaps', () => {
  assert.deepEqual(featureSharingPlaqueRect([probe, goal]), { x: 216, y: 426, width: 248, height: 92 });
  const step1 = dependentCaseStatePlaques(probe, goal, 'u', 'acc', '1', true);
  assert.equal(step1.probe.y, 306);
  assert.equal(step1.goal.y - step1.probe.y, 96);
  assert.equal(step1.probe.height, 68);
  const step2 = dependentCaseStatePlaques(probe, goal, 'u', 'acc', '2', true);
  assert.equal(step2.goal.y + 34 - (step2.probe.y + 68), 72);
  const reversed = dependentCaseStatePlaques(goal, probe, 'acc', 'u', '2', false);
  assert.deepEqual(reversed, { probe: step2.goal, goal: step2.probe });
});

test('stage reservations include both boxes of a compound and require its witnesses', () => {
  const rectFor = id => id === 'a' ? probe : id === 'b' ? goal : null;
  const boxes = nativeRelationPlaqueRects(items, rectFor);
  assert.equal(boxes.length, 3);
  assert.deepEqual(boxes[0], featureSharingPlaqueRect([probe, goal]));
  assert.deepEqual(boxes.slice(1), Object.values(dependentCaseStatePlaques(probe, goal, 'unvalued', 'accusative', '1', true)));
  assert.deepEqual(nativeRelationPlaqueRects(items, () => null), []);
  assert.deepEqual(nativeRelationPlaqueRects(items, id => id === 'a' ? probe : null), []);
});

for (const item of items) test(`${item.linkStyle || item.pathStyle}: native plaque space is reserved before reveal`, () => {
  const tree = { id: 'root', label: 'XP', children: [
    { id: 'a', label: 'A', word: 'one', children: [] },
    { id: 'b', label: 'B', word: 'two', children: [] }
  ] };
  const stage = { statement: 'Test', stageRecord: 'Test', workspaceForest: [tree], relations: [] };
  const steps = buildReplayPlayback({ sentence: 'one two', analyses: [{ tree, derivationStages: [stage] }] }).steps;
  const input = { steps, stageIndex: 0, completedCanvas: steps.at(-1).replayCanvasData,
    plan: { frames: [{ items: [item] }] }, width: 800, height: 700, includeOverlays: false };
  const bare = buildStageCameraBounds({ ...input, includePlaques: false });
  const reserved = buildStageCameraBounds({ ...input, includePlaques: true });
  assert(reserved.maxY > bare.maxY, 'native plaque height must contribute to the full stage fit');
  assert.deepEqual(buildStageCameraBounds({ ...input, includePlaques: true, steps: [...steps].reverse() }), reserved);
});
