import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import {
  MIN_RELOCATION_GAIN,
  beyondNearbyReach,
  nearbyPlaqueReach,
  placeStagePlaques,
  plaqueAnchorPoint,
  plaqueIdentity,
  plaquesOverlap
} from '../replay/relations/plaquePlacement.ts';
import { buildReplayPlaqueSchedule, buildStageLayoutGroups } from '../replay/stageCamera.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/relocated-plaque-anchor.json', import.meta.url)));
// Feature plaques use the bundled JetBrains Mono: a 0.6em advance, 1.02em ascent and 0.3em descent.
const measurePlaqueText = (text, style) => ({ width: [...text].length * (style.fontSize * 0.6 + style.letterSpacing),
  ascent: style.fontSize * 1.02, descent: style.fontSize * 0.3 });
const offset = box => [box.x + box.width / 2 - box.attachmentX, box.y + box.height / 2 - box.attachmentY];
const prepare = (record, width = 1600, height = 1100) => {
  const replay = prepareReplay({ ...record, includePlayback: true }), steps = replay.playbackSteps;
  const schedule = buildReplayPlaqueSchedule({ steps, stageIndex: 0, completedCanvas: steps.at(-1).replayCanvasData,
    plan: replay.relationRenderPlan, layoutGroups: buildStageLayoutGroups(steps, replay.replayDerivationFrames),
    width, height, measurePlaqueText });
  // The allocator's own distance: from the anchor's word when it bears one.
  const distance = (stepIndex, box) => {
    const root = d3.hierarchy(steps[stepIndex].replayCanvasData);
    applyVizIds(root);
    const node = root.descendants().find(candidate => getNodeId(candidate) === box.attachmentNodeId);
    const point = plaqueAnchorPoint({ x: box.attachmentX, y: box.attachmentY, data: node.data, children: node.children });
    return Math.hypot(box.x + box.width / 2 - point.x, box.y + box.height / 2 - point.y);
  };
  return { replay, steps, schedule, distance };
};

for (const [width, height] of [[1600, 1100], [390, 844]]) test(`${width}px: feature plaques stay beside an anchor that moves twice`, () => {
  const { replay, steps, schedule, distance } = prepare(record, width, height);
  const itemsAt = index => replay.relationRenderPlan.frames[steps[index].replayFrameIndex].items;
  const final = steps.length - 1, items = itemsAt(final);
  const features = [...schedule.steps.get(final)].filter(([index]) => items[index].plaqueStyle === 'feature');
  assert.deepEqual(features.map(([index]) => items[index].rows[0].value).sort(), ['declarative', 'nominative', 'past']);
  for (const [index, box] of features) assert(!beyondNearbyReach(distance(final, box), box),
    `[${items[index].rows[0].label}: ${items[index].rows[0].value}] lies within the nearby pockets of ${box.attachmentNodeId}`);

  const previous = new Map();
  steps.forEach((step, stepIndex) => {
    const layout = [...schedule.steps.get(stepIndex) ?? []];
    for (const [index, box] of layout) {
      const key = plaqueIdentity(itemsAt(stepIndex)[index]), before = previous.get(key);
      if (before && itemsAt(stepIndex)[index].plaqueStyle === 'feature'
        && before.attachmentX === box.attachmentX && before.attachmentY === box.attachmentY)
        assert(Math.hypot(...offset(box).map((value, axis) => value - offset(before)[axis])) < 1e-6,
          `frame ${stepIndex + 1} keeps the offset while ${box.attachmentNodeId} stays`);
      previous.set(key, box);
    }
    for (const [a, first] of layout) for (const [b, second] of layout)
      assert(a >= b || !plaquesOverlap(first, second, 0), `frame ${stepIndex + 1} keeps plaques ${a} and ${b} apart`);
  });
});

test('a relocated plaque leaves its pocket only for a nearby or clearly nearer one', () => {
  const nodes = d3.tree().nodeSize([600, 300])(d3.hierarchy({ id: 'cp', label: 'CP', children: [
    { id: 'subject', label: 'DP', children: [{ id: 'd', label: 'D', word: 'Ingen' }] }] })).descendants();
  const anchor = plaqueAnchorPoint(nodes.find(node => node.data.id === 'subject'));
  const feature = { kind: 'node-plaque', plaqueStyle: 'feature', anchorNodeIds: ['subject'], title: 'Features',
    rows: [{ label: 'case', value: 'nominative' }], relationRef: { stageIndex: 0, relationIndex: 0 } };
  const width = 360, height = 129, reach = nearbyPlaqueReach({ width, height });
  // Syntax fills everything below `top`, so a fresh search lands just above it.
  const place = (top, incumbentY) => {
    const obstacles = [{ x: anchor.x - 3000, y: anchor.y + top, width: 6000, height: 6000 }];
    const incumbent = incumbentY !== undefined && { x: anchor.x - width / 2, y: anchor.y + incumbentY - height / 2, width, height,
      location: 'local', domainId: 'cp', attachmentNodeId: 'subject', attachmentX: anchor.x, attachmentY: anchor.y };
    const box = placeStagePlaques([feature], nodes, obstacles, new Map(), undefined, {
      sizes: new Map([[plaqueIdentity(feature), { width, height }]]), incumbents: new Map(incumbent ? [[0, incumbent]] : []),
      spaceFor: () => ({ obstacles, acceptsConnector: () => true }) }).get(0);
    return Math.hypot(box.x + width / 2 - anchor.x, box.y + height / 2 - anchor.y);
  };
  const remote = place(-600), nearby = place(-312);
  assert(remote > reach && remote > MIN_RELOCATION_GAIN * 700 && nearby <= reach && nearby > MIN_RELOCATION_GAIN * 450);
  assert.equal(place(-600, -700), 700, 'a remote pocket less than a quarter nearer keeps the incumbent');
  assert(Math.abs(place(-600, -1000) - remote) < 1e-6, 'a quarter nearer replaces it');
  assert(Math.abs(place(-312, -450) - nearby) < 1e-6, 'a nearby pocket replaces it');
});

test('a head carried into the complex head that head movement forms stays near at each position', () => {
  const { record } = loadFixtureAnalyses().records
    .find(entry => entry.id === 'replay-regressions/diverse-recovery.json#/examples/7/analysis');
  const { replay, steps, schedule, distance } = prepare(record);
  const positions = new Set();
  steps.forEach((step, stepIndex) => {
    const items = replay.relationRenderPlan.frames[step.replayFrameIndex].items;
    for (const [index, box] of schedule.steps.get(stepIndex) ?? []) {
      if (items[index].plaqueStyle !== 'feature' || items[index].rows[0].label !== 'finiteness') continue;
      positions.add(`${box.attachmentX},${box.attachmentY}`);
      assert(!beyondNearbyReach(distance(stepIndex, box), box), `frame ${stepIndex + 1} keeps [finiteness: finite] near T`);
    }
  });
  assert(positions.size >= 3, 'V-to-T and T-to-Foc each carry T to a new position while the plaque is shown');
});
