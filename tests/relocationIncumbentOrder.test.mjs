import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { layoutMeasuredScenes, prepareVisualRecord, TEXT_METRICS } from './helpers/visualFrames.mjs';
import { MIN_RELOCATION_GAIN, plaqueAnchorPoint } from '../replay/relations/plaquePlacement.ts';

// Hand-built control: the Swedish subject's forests and movements (relocated-plaque-anchor)
// with two synthetic feature plaques on its D head, which relocate with each movement.
// The wide plaque is sized so that at the final movement the pocket it would take
// first overlaps the small plaque's incumbent pocket; without that conflict the
// control proves nothing.
const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/relocated-plaque-anchor.json', import.meta.url)));
for (const stage of record.derivationStages) stage.relations = stage.relations.filter(relation => /movement/i.test(relation.relation));
const plaque = (label, value) => ({ kind: 'node-plaque', plaqueStyle: 'feature', anchorNodeIds: ['subjectD'], rows: [{ label, value }],
  familyId: 'feature-bundle.plaque', tier: 1,
  relationRef: { stageIndex: 1, relationIndex: label === 'wide' ? 50 : 51, relation: 'Synthetic', anchors: { bearer: 'subjectD' } } });
const wide = plaque('wide', 'a longer feature value that wraps across several plaque lines for size');
const small = plaque('small', 'x');

/** The synthetic plaques' pockets per frame, with their stage-3 allocation order reversed when `swap`. */
const pockets = swap => {
  const visual = prepareVisualRecord(structuredClone(record));
  const plan = visual.prepared.relationRenderPlan, steps = visual.prepared.playbackSteps;
  plan.frames.forEach((frame, stageIndex) => {
    if (stageIndex >= 1) frame.items.push(...swap && stageIndex === 3 ? [small, wide] : [wide, small]);
  });
  const { schedule, scenes } = layoutMeasuredScenes(visual, { width: 1436, height: 776 }, { ...TEXT_METRICS });
  return steps.map((step, stepIndex) => ({ stage: step.replayFrameIndex,
    ...Object.fromEntries([...schedule.steps.get(stepIndex) ?? []].flatMap(([index, box]) => {
      const item = plan.frames[step.replayFrameIndex].items[index];
      if (item !== wide && item !== small) return [];
      const node = scenes[stepIndex].tree.descendants().find(candidate => (candidate.__vizId ?? candidate.data.id) === box.attachmentNodeId);
      const point = plaqueAnchorPoint({ x: box.attachmentX, y: box.attachmentY, data: node.data, children: node.children });
      return [[item.rows[0].label, [box.attachmentNodeId, box.x - box.attachmentX, box.y - box.attachmentY,
        Math.hypot(box.x + box.width / 2 - point.x, box.y + box.height / 2 - point.y)]]];
    })) }));
};

// Stage 3 moves the subject to Spec-CP. Both plaques relocate; the small one's old pocket
// stays clear. Before 67c9267 the wide plaque, listed first, took that pocket and pushed the small
// plaque elsewhere; listed second, it left the small plaque its pocket. A relocated plaque
// leaves its incumbent only for a clearly nearer pocket, which the small one now finds
// beyond the fixed candidates (306 to 224 units).
test('which relocating plaque keeps its pocket at a movement does not depend on allocation order', () => {
  const authored = pockets(false), swapped = pockets(true);
  const moved = authored.findIndex(frame => frame.stage === 3 && frame.small);
  assert(moved > 0 && authored[moved - 1].small, 'both plaques are shown across the final movement');
  authored.forEach((frame, index) => assert.deepEqual(swapped[index], frame, `frame ${index + 1}`));
  const [, ...kept] = authored[moved - 1].small, [, ...now] = authored[moved].small;
  assert(now[0] === kept[0] && now[1] === kept[1] || now[2] <= MIN_RELOCATION_GAIN * kept[2],
    'the small plaque keeps its incumbent pocket or takes a clearly nearer one');
});
