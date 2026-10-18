import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { plaqueIdentity, plaquesOverlap } from '../replay/relations/plaquePlacement.ts';
import { buildReplayPlaqueSchedule, buildStageLayoutGroups } from '../replay/stageCamera.ts';

const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/relocated-plaque-anchor.json', import.meta.url)));
// Feature plaques use the bundled JetBrains Mono: a 0.6em advance, 1.02em ascent and 0.3em descent.
const measurePlaqueText = (text, style) => ({ width: [...text].length * (style.fontSize * 0.6 + style.letterSpacing),
  ascent: style.fontSize * 1.02, descent: style.fontSize * 0.3 });
// The farthest of the allocator's nearby candidate pockets around a phrase or head anchor.
const nearbyReach = box => Math.hypot(110 + box.width / 2, 235 + box.height / 2);
const offset = box => [box.x + box.width / 2 - box.attachmentX, box.y + box.height / 2 - box.attachmentY];

for (const [width, height] of [[1600, 1100], [390, 844]]) test(`${width}px: feature plaques stay beside an anchor that moves twice`, () => {
  const replay = prepareReplay({ ...record, includePlayback: true }), steps = replay.playbackSteps;
  const schedule = buildReplayPlaqueSchedule({ steps, stageIndex: 0, completedCanvas: steps.at(-1).replayCanvasData,
    plan: replay.relationRenderPlan, layoutGroups: buildStageLayoutGroups(steps, replay.replayDerivationFrames),
    width, height, measurePlaqueText });
  const itemsAt = index => replay.relationRenderPlan.frames[steps[index].replayFrameIndex].items;
  const final = steps.length - 1, items = itemsAt(final);
  const features = [...schedule.steps.get(final)].filter(([index]) => items[index].plaqueStyle === 'feature');
  assert.deepEqual(features.map(([index]) => items[index].rows[0].value).sort(), ['declarative', 'nominative', 'past']);
  for (const [index, box] of features) assert(Math.hypot(...offset(box)) <= nearbyReach(box),
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
