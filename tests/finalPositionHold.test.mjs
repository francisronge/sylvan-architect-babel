import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { getNodeId } from '../replay/displayIdentity.ts';
import { motionFrame, replayMotionFaults } from '../scripts/replayMotionContinuity.mjs';
import { layoutMeasuredScenes, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';

const fixture = name => JSON.parse(fs.readFileSync(new URL(`../fixtures/replay-regressions/${name}`, import.meta.url)));

// Workspaces built in one stage and merged in a later one, and waiting pieces
// that join at a stage's first steps: each must already stand where it joins,
// so neither the joining step nor any other step moves syntax it does not own.
for (const [name, index] of [['reviewed-construction.json', 0], ['workspace-arabic-continuity.json', 1],
  ['workspace-arabic-continuity.json', 3], ['workspace-arabic-continuity.json', 4]]) {
  test(`${name} case ${index}: existing syntax holds its place at every merge and stage crossing`, () => {
    const record = fixture(name).cases[index];
    const visual = prepareVisualRecord({ sentence: record.sentence, inputTokens: record.inputTokens,
      derivationStages: record.derivationStages, includePlayback: true });
    const { scenes } = layoutMeasuredScenes(visual, VIEWPORTS[0]);
    const frames = scenes.map(scene => ({ ...motionFrame(scene.step, scene.nodes, getNodeId),
      relationIndex: scene.step.replayRelationIdentity?.relationIndex }));
    const jumps = replayMotionFaults({ frames }).filter(fault => fault.kind !== 'shape-motion');
    assert.deepEqual(jumps.map(({ frame, node, kind, distance }) => `${frame} ${node} ${kind} ${Math.round(distance)}`), []);
  });
}
