import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { layoutMeasuredScenes, prepareVisualRecord, TEXT_METRICS } from './helpers/visualFrames.mjs';

// Hand-built control: the Swedish subject's forests and movements (relocated-plaque-anchor)
// with two synthetic feature plaques on its D head, which relocate with each movement.
const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/relocated-plaque-anchor.json', import.meta.url)));
for (const stage of record.derivationStages) stage.relations = stage.relations.filter(relation => /movement/i.test(relation.relation));
const plaque = (label, value) => ({ kind: 'node-plaque', plaqueStyle: 'feature', anchorNodeIds: ['subjectD'], rows: [{ label, value }],
  familyId: 'feature-bundle.plaque', tier: 1,
  relationRef: { stageIndex: 1, relationIndex: label === 'wide' ? 50 : 51, relation: 'Synthetic', anchors: { bearer: 'subjectD' } } });
const wide = plaque('wide', 'a much longer feature value that wraps across several plaque lines for size');
const small = plaque('small', 'x');

/** The synthetic plaques' pockets per frame, with their stage-3 allocation order reversed when `swap`. */
const pockets = swap => {
  const visual = prepareVisualRecord(structuredClone(record));
  const plan = visual.prepared.relationRenderPlan, steps = visual.prepared.playbackSteps;
  plan.frames.forEach((frame, stageIndex) => {
    if (stageIndex >= 1) frame.items.push(...swap && stageIndex === 3 ? [small, wide] : [wide, small]);
  });
  const { schedule } = layoutMeasuredScenes(visual, { width: 1436, height: 776 }, { ...TEXT_METRICS });
  return steps.map((step, stepIndex) => ({ stage: step.replayFrameIndex,
    ...Object.fromEntries([...schedule.steps.get(stepIndex) ?? []].flatMap(([index, box]) => {
      const item = plan.frames[step.replayFrameIndex].items[index];
      return item === wide || item === small ? [[item.rows[0].label, [box.attachmentNodeId, box.x - box.attachmentX, box.y - box.attachmentY]]] : [];
    })) }));
};

// Stage 3 moves the subject to Spec-CP. Both plaques relocate; the small one's old pocket
// stays clear. On main the wide plaque, listed first, took that pocket and pushed the small
// plaque elsewhere; listed second, it left the small plaque its pocket.
test('which relocating plaque keeps its pocket at a movement does not depend on allocation order', () => {
  const authored = pockets(false), swapped = pockets(true);
  const moved = authored.findIndex(frame => frame.stage === 3 && frame.small);
  assert(moved > 0 && authored[moved - 1].small, 'both plaques are shown across the final movement');
  authored.forEach((frame, index) => assert.deepEqual(swapped[index], frame, `frame ${index + 1}`));
  // The same pocket, within floating-point precision.
  const [anchor, x, y] = authored[moved].small, [priorAnchor, priorX, priorY] = authored[moved - 1].small;
  assert.ok(anchor === priorAnchor && Math.abs(x - priorX) < 1e-6 && Math.abs(y - priorY) < 1e-6, 'the small plaque keeps its incumbent pocket');
});
