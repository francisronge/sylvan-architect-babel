import assert from 'node:assert/strict';
import test from 'node:test';
import { getNodeId } from '../replay/displayIdentity.ts';
import { caseAssignmentPlaqueCurve } from '../replay/relations/overlayGeometry.ts';
import { caseAssignmentSource, measuredCaseSourceRect, projectPlaqueLayout } from '../replay/relations/plaquePlacement.ts';
import { isPlanItemRevealed } from '../replay/relations/renderPlan.ts';
import { CATEGORY_LINE_HEIGHT } from '../replay/rendererMetrics.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { labelGeometry, layoutMeasuredScenes, prepareVisualRecord, TEXT_METRICS } from './helpers/visualFrames.mjs';

const fixtures = new Map(loadFixtureAnalyses().records.map(({ id, record }) => [id, record]));

/** Every revealed Case arrow, drawn as caseFeatureDrawing draws it: from the painted
 * source label's SVG text box (`labelGeometry(...).cell`) to its plaque row. */
const paintedCaseArrows = id => {
  const visual = prepareVisualRecord(fixtures.get(id));
  const { scenes, schedule } = layoutMeasuredScenes(visual, { width: 1436, height: 776 }, { ...TEXT_METRICS });
  const plan = visual.prepared.relationRenderPlan, steps = visual.prepared.playbackSteps;
  return scenes.flatMap((scene, stepIndex) => {
    const layout = schedule.steps.get(stepIndex);
    if (!layout || !scene.tree) return [];
    const stage = steps[stepIndex].replayFrameIndex, items = plan.frames[stage]?.items ?? [], runs = visual.stepRuns(stepIndex);
    const played = new Set(steps.slice(0, stepIndex + 1).flatMap(step => step.replayKind === 'relation'
      && step.replayRelationIdentity?.stageIndex === stage ? [step.replayRelationIdentity.relationIndex] : []));
    const active = steps[stepIndex].replayKind === 'relation' && steps[stepIndex].replayRelationIdentity?.stageIndex === stage
      ? steps[stepIndex].replayRelationIdentity.relationIndex : null;
    const all = new Map(scene.tree.descendants().map(node => [getNodeId(node), node]));
    return [...projectPlaqueLayout(layout, nodeId => all.get(nodeId) ?? null)].flatMap(([index, box]) => {
      const item = items[index], assigner = item?.pathStyle === 'case-assignment' && isPlanItemRevealed(item, stage, played, active)
        && scene.nodes.get(item.fromNodeId);
      if (!assigner) return [];
      const source = caseAssignmentSource(assigner), word = !source.children?.length && source.data.word;
      const run = runs.get(getNodeId(source))?.find(candidate => candidate.kind === (word ? 'terminal' : 'category'));
      if (!run) return [];
      const drawn = { ...box, width: box.drawnWidth ?? box.width, height: box.drawnHeight ?? box.height };
      const curve = caseAssignmentPlaqueCurve(labelGeometry(source, run).cell, drawn, box.y + (box.caseRowY ?? 93));
      return [{ frame: stepIndex + 1, claim: `${item.relationRef.stageIndex}:${item.relationRef.relationIndex}`, source, run,
        cell: labelGeometry(source, run).cell, length: Math.hypot(curve.target.x - curve.source.x, curve.target.y - curve.source.y) }];
    });
  });
};

// On main the allocator tested a curve from a nominal 150-unit word box and an
// unmeasured category layout. In cases/7 it accepted a 98.6-unit shaft for claim 4:1
// that painted at 34.6 from frame 48, shorter than its arrowhead allows.
for (const id of ['showcase/agreement-and-case.json#/cases/7', 'showcase/agreement-and-case.json#/cases/0'])
  test(`Case allocation reserves the painted shaft of every arrow (${id})`, () => {
    const arrows = paintedCaseArrows(id);
    assert(arrows.length > 10, 'the fixture shows Case arrows');
    if (id.endsWith('/7')) assert(arrows.some(arrow => arrow.frame === 48 && arrow.claim === '4:1'), 'frame 48 shows claim 4:1');
    for (const { frame, claim, length } of arrows) assert(length >= CATEGORY_LINE_HEIGHT * 2,
      `frame ${frame}, claim ${claim}: the painted shaft is ${length.toFixed(1)} units`);
  });

test('the allocator measures a Case source as the native text box the painter measures', () => {
  const arrows = paintedCaseArrows('showcase/agreement-and-case.json#/cases/7');
  const kinds = new Set();
  for (const { source, run, cell } of arrows) {
    const rect = measuredCaseSourceRect(source, [run], TEXT_METRICS.measureTreeLabel, TEXT_METRICS.measureCategoryText);
    for (const key of ['x', 'y', 'width', 'height']) assert(Math.abs(rect[key] - cell[key]) < 1e-6,
      `${getNodeId(source)} ${run.kind}: ${key} ${rect[key]} is painted at ${cell[key]}`);
    kinds.add(run.kind);
  }
  assert.deepEqual([...kinds].sort(), ['category', 'terminal'], 'both word and category sources are compared');
});
