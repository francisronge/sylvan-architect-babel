import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { getNodeId } from '../replay/displayIdentity.ts';
import { plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';
import { TREE_SIBLING_GAP } from '../replay/treeSpacing.ts';
import { measureCategoryText } from './helpers/visualFontMetrics.mjs';
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

// A waiting workspace keeps the layout's node unit (TREE_SIBLING_GAP / 2.5)
// from every label, word and branch of every other workspace in every frame,
// diagonal neighbours included.
const distance = (a, b) => Math.hypot(Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width)),
  Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height)));
for (const index of [1, 3, 4]) test(`workspace-arabic-continuity.json case ${index}: waiting workspaces keep normal separation`, () => {
  const record = fixture('workspace-arabic-continuity.json').cases[index];
  const visual = prepareVisualRecord({ sentence: record.sentence, inputTokens: record.inputTokens,
    derivationStages: record.derivationStages, includePlayback: true });
  const close = [];
  layoutMeasuredScenes(visual, VIEWPORTS[0]).scenes.forEach((scene, frame) => {
    const nodes = [...scene.nodes.values()], included = new Set(nodes);
    const workspaces = nodes.filter(node => !node.parent || !included.has(node.parent))
      .map(top => [getNodeId(top), plaqueTreeObstacles(top.descendants().filter(node => included.has(node)), measureCategoryText)]);
    for (let i = 0; i < workspaces.length; i++) for (let j = i + 1; j < workspaces.length; j++) {
      let nearest = Infinity;
      for (const a of workspaces[i][1]) for (const b of workspaces[j][1]) nearest = Math.min(nearest, distance(a, b));
      if (nearest < TREE_SIBLING_GAP / 2.5 - 0.01) close.push(`${frame + 1} ${workspaces[i][0]}~${workspaces[j][0]} ${nearest.toFixed(1)}`);
    }
  });
  assert.deepEqual(close, []);
});
