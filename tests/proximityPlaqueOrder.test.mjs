import assert from 'node:assert/strict';
import test from 'node:test';
import { beyondNearbyReach, plaqueAnchorPoint, projectPlaqueLayout } from '../replay/relations/plaquePlacement.ts';
import { getNodeId } from '../replay/displayIdentity.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { layoutMeasuredScenes, prepareVisualRecord, TEXT_METRICS } from './helpers/visualFrames.mjs';

const fixtures = new Map(loadFixtureAnalyses().records.map(({ id, record }) => [id, record]));

// Measured Case sources reject a Case pocket whose painted shaft is too short. The Case
// plaque then moved into the theta grid's pocket and pushed the grid, which shows its
// owner only by proximity, beyond its nearby reach. The grid now chooses first.
const cases = [
  ['movement/clause-context.json#/cases/7', 'ev', [16, 20]],
  ['replay-regressions/adjunct-attachment-continuity.json#', 'vB', [23, 52]]
];
for (const [id, anchorId, [first, last]] of cases) test(`a theta grid keeps a nearby pocket beside a Case plaque (${id})`, () => {
  const visual = prepareVisualRecord(fixtures.get(id));
  const { schedule, scenes } = layoutMeasuredScenes(visual, { width: 1436, height: 776 }, { ...TEXT_METRICS });
  const plan = visual.prepared.relationRenderPlan, steps = visual.prepared.playbackSteps;
  for (let frame = first; frame <= last; frame++) {
    const items = plan.frames[steps[frame - 1].replayFrameIndex].items, scene = scenes[frame - 1];
    const all = new Map(scene.tree.descendants().map(node => [getNodeId(node), node]));
    const grids = [...projectPlaqueLayout(schedule.steps.get(frame - 1), nodeId => all.get(nodeId) ?? null)]
      .filter(([index, box]) => items[index].plaqueStyle === 'theta-grid' && box.attachmentNodeId === anchorId);
    assert.equal(grids.length, 1, `frame ${frame} shows the grid on ${anchorId}`);
    const [[, box]] = grids, point = plaqueAnchorPoint(all.get(anchorId));
    const distance = Math.hypot(box.x + box.width / 2 - point.x, box.y + box.height / 2 - point.y);
    assert(!beyondNearbyReach(distance, { ...box, thetaGrid: true }), `frame ${frame}: the grid is ${Math.round(distance)} units away`);
  }
});
