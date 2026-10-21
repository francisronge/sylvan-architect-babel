import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { completePlaqueLayoutResult, measurePlaqueLayoutJob, runPlaqueLayoutJob } from '../replay/plaqueLayoutJob.ts';
import { nearbyPlaqueReach, PLAQUE_GAP, plaqueAnchorPoint, plaqueIdentity, plaquesOverlap, projectPlaqueLayout } from '../replay/relations/plaquePlacement.ts';
import { buildRenderableDerivationCanvasData } from '../replay/replayCanvas.ts';
import { buildReplayPlaqueSchedule, buildStageLayoutGroups, measureStagePlaqueSpace } from '../replay/stageCamera.ts';
import { indexHierarchyNodesByIdAndAliases } from '../replay/replayCanvas.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { prepareVisualRecord, TEXT_METRICS, VIEWPORTS } from './helpers/visualFrames.mjs';

// Feature plaques use the bundled JetBrains Mono: a 0.6em advance, 1.02em ascent and 0.3em descent.
const measurePlaqueText = (text, style) => ({ width: [...text].length * (style.fontSize * 0.6 + style.letterSpacing),
  ascent: style.fontSize * 1.02, descent: style.fontSize * 0.3 });
const fixtures = new Map(loadFixtureAnalyses().records.map(({ id, record }) => [id, record]));
const inputFor = record => {
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true }), steps = replay.playbackSteps;
  return { replay, input: { steps, stageIndex: 0, plan: replay.relationRenderPlan,
    completedCanvas: buildRenderableDerivationCanvasData(record.derivationStages.at(-1).workspaceForest),
    layoutGroups: buildStageLayoutGroups(steps, replay.replayDerivationFrames), width: 1600, height: 1100, measurePlaqueText } };
};
/** The steps that show the plaque `matches` names, with its distance as a share of its nearby reach. */
const pocketsOf = ({ replay, input }, schedule, matches) => input.steps.flatMap((step, stepIndex) => {
  const items = replay.relationRenderPlan.frames[step.replayFrameIndex]?.items ?? [];
  const root = d3.hierarchy(step.replayCanvasData);
  applyVizIds(root);
  return [...schedule.steps.get(stepIndex) ?? []].filter(([index]) => matches(plaqueIdentity(items[index]))).map(([index, box]) => {
    const node = root.descendants().find(candidate => getNodeId(candidate) === box.attachmentNodeId);
    const point = plaqueAnchorPoint({ x: box.attachmentX, y: box.attachmentY, data: node.data, children: node.children });
    return { stepIndex, index, box, layout: schedule.steps.get(stepIndex),
      reach: Math.hypot(box.x + box.width / 2 - point.x, box.y + box.height / 2 - point.y) / nearbyPlaqueReach(box) };
  });
});
const grid = (key, anchor) => { const [style, , , anchors] = JSON.parse(key); return style === 'theta-grid' && anchors.includes(anchor); };
// Each plaque shows its owner only by proximity; on main its one pocket lies beyond
// every nearby pocket (12 to 25% past its reach) for its whole run.
const remote = [
  ['replay-regressions/es-wh-phase-edge-contour.json#', 'the clause-type plaque on C', key => key.includes('direct constituent question')],
  ['replay-regressions/unrecognized-movement.json#/cases/4', 'the Agent grid on v', key => grid(key, 'v-buy')],
  ['replay-regressions/clitic-displacement.json#/fixtures/1/analysis', 'the Agent/Theme grid on V', key => grid(key, 'readV')]
];

for (const [id, name, matches] of remote) test(`${name} takes a nearby pocket clear of every other final pocket (${id})`, () => {
  const prepared = inputFor(fixtures.get(id)), schedule = buildReplayPlaqueSchedule(prepared.input);
  const pockets = pocketsOf(prepared, schedule, matches);
  assert(pockets.length > 1, 'the plaque is shown');
  for (const { stepIndex, reach } of pockets) assert(reach <= 1 + 1e-6, `frame ${stepIndex + 1} keeps it within reach (${reach.toFixed(3)})`);
  // Main changes the clitic grid's pocket only where stage 3 begins; nothing else may.
  const offset = ({ box }) => `${box.attachmentNodeId} ${(box.x - box.attachmentX).toFixed(6)} ${(box.y - box.attachmentY).toFixed(6)}`;
  const stageOf = ({ stepIndex }) => prepared.input.steps[stepIndex].replayFrameIndex;
  pockets.slice(1).forEach((pocket, i) => assert(offset(pocket) === offset(pockets[i]) || stageOf(pocket) !== stageOf(pockets[i]),
    `frame ${pocket.stepIndex + 1} keeps the pocket within its stage`));
  for (const { stepIndex, index, box, layout } of pockets) for (const [other, placement] of layout)
    assert(other === index || !plaquesOverlap(box, placement), `frame ${stepIndex + 1} keeps the full gap from plaque ${other}`);
});

test('a stage that a remote run spans is delivered early only once that run is settled', () => {
  const [id, , matches] = remote[1], prepared = inputFor(fixtures.get(id));
  const first = pocketsOf(prepared, buildReplayPlaqueSchedule(prepared.input), matches)[0];
  const measuring = measurePlaqueLayoutJob(prepared.input);
  let next = measuring.next();
  while (!next.done) next = measuring.next();
  const job = next.value;
  job.progressStage = prepared.input.steps[first.stepIndex].replayFrameIndex;
  let progress;
  const result = runPlaqueLayoutJob(structuredClone(job), delivered => { progress ??= delivered; });
  assert(progress, 'the requested stage is delivered before completion');
  const early = progress.schedule.steps.get(first.stepIndex).get(first.index);
  assert.deepEqual(early, first.box, 'the early delivery already shows the nearby pocket');
  assert.doesNotThrow(() => completePlaqueLayoutResult(prepared.input, job, result,
    { progress, layout: { schedule: progress.schedule, coordinates: progress.coordinates } }),
  'completion keeps every delivered stage and step');
});

// With the audit's measured fonts, diverse-recovery #7 releases stage 0 while a later remote
// run is still undecided: stages enter the schedule only once no undecided run covers them.
test('no stage or step delivered early changes when later remote runs are decided', () => {
  const record = fixtures.get('replay-regressions/diverse-recovery.json#/examples/7/analysis');
  const { prepared, direction, protectedNodeIds, treeLabelRuns } = prepareVisualRecord(record);
  const steps = prepared.playbackSteps, stages = prepared.replayDerivationFrames;
  const key = layout => JSON.stringify([...layout ?? []]);
  const deliveries = [];
  const schedule = buildReplayPlaqueSchedule({ plan: prepared.relationRenderPlan, protectedNodeIds, treeLabelRuns, ...TEXT_METRICS,
    steps, stageIndex: 0, completedCanvas: buildRenderableDerivationCanvasData(stages.at(-1).workspaceForest),
    width: VIEWPORTS[0].width, height: VIEWPORTS[0].height, direction, layoutGroups: buildStageLayoutGroups(steps, stages) },
  undefined, (delivered, stage) => deliveries.push({ stage, steps: [...delivered.steps].map(([index, layout]) => [index, key(layout)]) }));
  assert(deliveries.length > 1, 'stages are delivered one by one');
  for (const { stage, steps: early } of deliveries) for (const [index, value] of early)
    assert.equal(key(schedule.steps.get(index)), value, `frame ${index + 1}, delivered with stage ${stage}, keeps its plaques`);
});

// Half the gap from a movement arrow is under a pixel when a phone fits this
// Mandarin relative (zoom 0.07): its theme grid, brought near its verb, touched
// the arrow from 我 that passes above it.
test('a plaque brought near keeps the full gap from every movement trajectory', () => {
  const record = fixtures.get('replay-regressions/visual-human-catalog.json#/cases/6/analyses/0');
  const { prepared, direction, protectedNodeIds, treeLabelRuns } = prepareVisualRecord(record);
  const steps = prepared.playbackSteps, stages = prepared.replayDerivationFrames;
  const input = { plan: prepared.relationRenderPlan, protectedNodeIds, treeLabelRuns, ...TEXT_METRICS, steps, stageIndex: 0,
    completedCanvas: buildRenderableDerivationCanvasData(stages.at(-1).workspaceForest), width: VIEWPORTS[0].width,
    height: VIEWPORTS[0].height, direction, layoutGroups: buildStageLayoutGroups(steps, stages) };
  const schedule = buildReplayPlaqueSchedule(input);
  let checked = 0;
  stages.forEach((_, stageIndex) => {
    for (const scene of measureStagePlaqueSpace({ ...input, stageIndex }).scenes) {
      const trajectories = scene.obstacles.filter(obstacle => obstacle.trajectory);
      const byId = indexHierarchyNodesByIdAndAliases(scene.nodes);
      for (const stepIndex of scene.stepIndices) for (const [index, box] of projectPlaqueLayout(schedule.steps.get(stepIndex) ?? new Map(), id => byId.get(id) ?? null)) {
        checked += trajectories.length ? 1 : 0;
        for (const sample of trajectories) assert(!plaquesOverlap(box, sample, PLAQUE_GAP),
          `frame ${stepIndex + 1}: plaque ${index} keeps ${PLAQUE_GAP} units from the trajectory sample at ${sample.x.toFixed(0)}, ${sample.y.toFixed(0)}`);
      }
    }
  });
  assert(checked > 20, 'plaques are checked against trajectories');
});
