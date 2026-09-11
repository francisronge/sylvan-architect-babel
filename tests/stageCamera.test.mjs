import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { buildStageCameraBounds, treeLayoutSize } from '../replay/stageCamera.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { buildRenderableDerivationCanvasData } from '../replay/replayCompiler.ts';

const records = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));
for (const record of records) {
  for (const [width, height] of [[1596, 1016], [386, 698]]) {
    test(`${record.name} ${width}px: stage fit contains every layout and is independent of traversal order`, () => {
      const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
      const original = JSON.stringify(steps);
      const plan = compileRelationRenderPlan(record.derivationStages);
      record.derivationStages.forEach((stage, stageIndex) => {
        const input = { steps, stageIndex, plan, width, height,
          completedCanvas: buildRenderableDerivationCanvasData(stage.workspaceForest) };
        const bounds = buildStageCameraBounds(input);
        assert(bounds);
        assert(Object.values(bounds).every(Number.isFinite));
        assert.deepEqual(buildStageCameraBounds({ ...input, steps: [...steps].reverse() }), bounds);
        const stageSteps = steps.filter(step => step.replayFrameIndex === stageIndex);
        assert.deepEqual(buildStageCameraBounds({ ...input, steps: stageSteps }), bounds,
          'other stages must not affect this stage fit');
        for (const step of stageSteps) {
          const root = d3.hierarchy(step.replayCanvasData);
          const tree = d3.tree().size(treeLayoutSize(root.descendants().length, root.height, width, height))
            .separation((a, b) => a.parent === b.parent ? 2.5 : 3.5)(root);
          for (const node of tree.descendants()) {
            if (node.data.label === '__DERIVATION_WORKSPACE__') continue;
            assert(node.x >= bounds.minX && node.x <= bounds.maxX, `${step.targetLabel}: x outside fit`);
            assert(node.y >= bounds.minY && node.y <= bounds.maxY, `${step.targetLabel}: y outside fit`);
          }
        }
      });
      assert.equal(JSON.stringify(steps), original, 'camera measurement must not change Replay');
    });
  }
}

test('Fable source words disappearing cannot shrink the fit halfway through wh movement', () => {
  const record = records.find(item => item.name === 'fable-minimalism');
  const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
  const stageIndex = 4;
  const input = { steps, stageIndex, completedCanvas: steps.at(-1).replayCanvasData,
    plan: null, width: 1596, height: 1016 };
  const before = steps.find(step => step.replayFrameIndex === stageIndex);
  const after = steps.find(step => step.replayRelationIdentity?.stageIndex === stageIndex
    && step.replayRelationIdentity.relationIndex === 1);
  assert.equal(before.replayUsesFutureLayoutScaffold, true);
  assert.equal(after.replayUsesFutureLayoutScaffold, false);
  const all = buildStageCameraBounds(input);
  const early = buildStageCameraBounds({ ...input, steps: [before] });
  const late = buildStageCameraBounds({ ...input, steps: [after] });
  assert.notDeepEqual(early, late, 'fixture must reproduce the previous per-step fit change');
  for (const candidate of [early, late]) {
    assert(all.minX <= candidate.minX && all.maxX >= candidate.maxX);
    assert(all.minY <= candidate.minY && all.maxY >= candidate.maxY);
  }
});

test('tree-first and hidden-overlay modes do not reserve annotation extents', () => {
  const record = records.find(item => item.name === 'astra-minimalism');
  const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
  const input = { steps, stageIndex: 6, completedCanvas: steps.at(-1).replayCanvasData,
    plan: compileRelationRenderPlan(record.derivationStages), width: 386, height: 698 };
  assert.deepEqual(buildStageCameraBounds({ ...input, includeOverlays: false }),
    buildStageCameraBounds({ ...input, plan: null }));
});
