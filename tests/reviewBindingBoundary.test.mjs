import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildReplayPlaqueSchedule, buildStageLayoutGroups, measureStagePlaqueSpace, selectReplayPlaqueLayout } from '../replay/stageCamera.ts';
import { bindingDomainTreeRect, bindingDomainEllipse, bindingDomainPlaques } from '../replay/relations/bindingDomainGeometry.ts';
import { projectPlaqueLayout } from '../replay/relations/plaquePlacement.ts';
import { indexHierarchyNodesByIdAndAliases } from '../replay/replayCompiler.ts';

const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/review-workspace-boundaries.json', import.meta.url)))
  .cases.find(record => record.key === 'fresh/korean-particles/0');
const metric = (ellipse, x, y) => ((x - ellipse.cx) / ellipse.rx) ** 2 + ((y - ellipse.cy) / ellipse.ry) ** 2;
const corners = (rect, pad = 0) => [rect.x - pad, rect.x + rect.width + pad]
  .flatMap(x => [rect.y - pad, rect.y + rect.height + pad].map(y => [x, y]));
const closest = (ellipse, rect) => metric(ellipse, Math.max(rect.x, Math.min(ellipse.cx, rect.x + rect.width)),
  Math.max(rect.y, Math.min(ellipse.cy, rect.y + rect.height)));

for (const [width, height] of [[1600, 1100], [390, 844]]) test(`${width}px: Korean frame 60 encloses IP ink and owned plaques while excluding CP, C′ and C`, () => {
  const original = JSON.stringify(record), replay = prepareReplay({ ...record, includePlayback: true });
  const layoutGroups = buildStageLayoutGroups(replay.playbackSteps, replay.replayDerivationFrames);
  const stageIndex = replay.playbackSteps[59].replayFrameIndex, planFrame = replay.relationRenderPlan.frames[stageIndex];
  const input = { steps: replay.playbackSteps, stageIndex, completedCanvas: replay.playbackSteps[59].replayCanvasData,
    plan: replay.relationRenderPlan, layoutGroups, width, height };
  const schedule = buildReplayPlaqueSchedule(input), space = measureStagePlaqueSpace(input), scene = space.scenes.at(-1);
  const byId = indexHierarchyNodesByIdAndAliases(scene.nodes), visible = new Set(scene.nodes);
  const item = planFrame.items.find(item => item.kind === 'binding-domain');
  assert.equal(item.domainNodeId, 'ip', 'the authored domain remains IP');
  const members = byId.get('ip').descendants().filter(node => visible.has(node)), memberIds = members.map(node => node.data.id);
  const content = members.flatMap(node => bindingDomainTreeRect([node]) ?? []);
  const outside = scene.nodes.filter(node => !members.includes(node)).flatMap(node => bindingDomainTreeRect([node]) ?? []);
  const plaques = projectPlaqueLayout(selectReplayPlaqueLayout(schedule, stageIndex, 59), id => byId.get(id) ?? null);
  const owned = bindingDomainPlaques(memberIds, planFrame.items, plaques), rect = bindingDomainTreeRect(members);
  const ordinary = bindingDomainEllipse(rect, owned), ellipse = bindingDomainEllipse(rect, owned, content, outside);
  assert(ellipse.rx < ordinary.rx, 'excluding CP must not widen the IP ellipse');
  for (const id of ['cp', 'cBar', 'cNull']) {
    const box = bindingDomainTreeRect([byId.get(id)]);
    assert(closest(ordinary, box) < 1, `the old ellipse captured ${id}`);
    assert(closest(ellipse, box) >= 1, `the complete ${id} label is excluded`);
  }
  for (const box of content) assert(Math.max(...corners(box).map(([x, y]) => metric(ellipse, x, y))) <= 1 + 1e-10);
  for (const box of owned) {
    if (metric(ordinary, box.x + box.width / 2, box.y + box.height / 2) >= 1) continue;
    assert(Math.max(...corners(box, 8).map(([x, y]) => metric(ellipse, x, y))) <= 1 + 1e-10, 'owned plaque cannot peek outside');
  }
  for (const zoom of [0.08, 0.5, 2.5]) {
    const projected = { cx: ellipse.cx * zoom + 100, cy: ellipse.cy * zoom - 80, rx: ellipse.rx * zoom, ry: ellipse.ry * zoom };
    for (const box of content) for (const [x, y] of corners(box)) assert(metric(projected, x * zoom + 100, y * zoom - 80) <= 1 + 1e-10);
  }
  assert.equal(JSON.stringify(record), original, 'drawing does not alter authored domain or relations');
});
