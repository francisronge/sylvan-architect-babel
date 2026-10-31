import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { layoutVisualFrames, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';

const fixtures = new Map(loadFixtureAnalyses().records.map(({ id, record }) => [id, record]));

// The control dependency is painted after fitting as a dashed orthogonal elbow
// between the measured labels (bindingRefinements.ts, refineControlRelation),
// read here independently of the allocator's estimate: up from just above the
// controllee's label, across, then up to just below the controller's label.
const elbow = (controller, controllee) => {
  const from = { x: controller.x + controller.width / 2, y: controller.y + controller.height / 2 };
  const to = { x: controllee.x + controllee.width / 2, y: controllee.y + controllee.height / 2 };
  const elbowY = Math.max(from.y + 128, Math.min(to.y - 92, from.y + Math.abs(to.y - from.y) * 0.58));
  return [{ x: to.x, y: controllee.y - 12 }, { x: to.x, y: elbowY }, { x: from.x, y: elbowY },
    { x: from.x, y: controller.y + controller.height + 40 }];
};
// The 7.4-unit dashed stroke enters a plaque when its centre line comes within half of it.
const runsInto = (route, rect, half = 3.7) => route.slice(1).some((point, index) => {
  const start = route[index];
  const left = Math.min(start.x, point.x) - half, right = Math.max(start.x, point.x) + half;
  const top = Math.min(start.y, point.y) - half, bottom = Math.max(start.y, point.y) + half;
  return left < rect.x + rect.width && right > rect.x && top < rect.y + rect.height && bottom > rect.y;
});

// "Mia seems to want to leave.": after raising, the PF plaque of "seems" sat on
// the elbow from PRO up to Mia. In the restated chains, the theta grid of "want" did.
const cases = [
  ['movement/clause-context.json#/cases/0', [32, 40]],
  ['movement/restated-chains.json#/0', [25, 59]]
];
for (const [id, [first, last]] of cases) test(`plaques keep clear of the painted control dependency (${id})`, () => {
  const visual = prepareVisualRecord(fixtures.get(id));
  const plan = visual.prepared.relationRenderPlan, steps = visual.prepared.playbackSteps;
  const frames = layoutVisualFrames(visual, [VIEWPORTS[0]], { steps: Array.from({ length: last - first + 1 }, (_, i) => first + i) });
  assert.equal(frames.length, last - first + 1);
  for (const frame of frames) {
    const items = plan.frames[steps[frame.frame - 1].replayFrameIndex].items;
    const controls = frame.marks.filter(mark => mark.type === 'shape-path' && mark.shapeStyle === 'control'
      && items[mark.itemIndex].familyId === 'control.dependency');
    assert(controls.length, `frame ${frame.frame} shows the control dependency`);
    const label = nodeId => frame.texts.find(text => text.kind === 'category' && text.nodes[0] === nodeId)?.boxes[0];
    for (const mark of controls) {
      const { fromNodeId, toNodeId } = items[mark.itemIndex];
      const route = elbow(label(fromNodeId), label(toNodeId));
      for (const plaque of frame.plaques) assert(!runsInto(route, plaque.rect),
        `frame ${frame.frame}: the control dependency runs through ${plaque.id}`);
    }
  }
});
