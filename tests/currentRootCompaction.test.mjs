import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { reserveWorkspaceAttachments } from '../replay/workspacePlacement.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { workspaceContinuityReflows } from '../replay/workspaceShapeReflows.ts';
import { compactCurrentRootForks } from '../replay/currentRootCompaction.ts';

const records = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/compact-current-root.json', import.meta.url))).cases;
function setup(record, width, height, direction) {
  const replay = prepareReplay({ ...record, includePlayback: true }), steps = replay.playbackSteps;
  const groups = buildStageLayoutGroups(steps, record.derivationStages);
  const sizes = new Map(record.derivationStages.map((_, stage) => [stage, stageTreeLayoutSize(steps, stage, width, height, groups)]));
  const points = new Map();
  for (const [stage, size] of sizes) for (const [canvas, coords] of buildStageCoordinateReservations(steps, stage, size,
    stage => sizes.get(stage), direction)) points.set(canvas, coords);
  const baseline = reserveWorkspaceAttachments(steps, sizes, direction, () => { throw new Error('the existing plan should be cached'); });
  const render = (step, coordinates = points) => {
    const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
    const visible = new Set(step.replayVisibleNodeIds);
    return layoutSyntaxTree(root, sizes.get(step.replayFrameIndex), direction,
      coordinates.get(step.replayCanvasData), visible).descendants().filter(node => visible.has(getNodeId(node)) && !node.data.replayLayoutOnly);
  };
  const at = (number, coordinates = points) => new Map(render(steps[number - 1], coordinates).map(node => [getNodeId(node), node]));
  return { steps, sizes, points, baseline, render, at };
}
const close = (a, b, message) => assert(Math.abs(a - b) < 1e-6, `${message}: ${a} versus ${b}`);
const examples = [
  { key: 'compact-movement/astra-english', frame: 22, head: 'had', host: 'embeddedVPhase', fork: 'embeddedTBase' },
  { key: 'compact-movement/sol-spanish', frame: 32, head: 'c', host: 'ip', fork: 'cbar' },
];

for (const [width, height] of [[1600, 948], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  for (const example of examples) test(`${width}px ${direction}: ${example.key} opens landing space at movement, not construction`, () => {
    const record = records.find(record => record.key === example.key), original = JSON.stringify(record);
    const { steps, points, baseline, render, at } = setup(record, width, height, direction);
    const before = at(example.frame), wide = at(example.frame, baseline), movement = at(example.frame + 1);
    const oldGap = Math.abs(wide.get(example.head).x - wide.get(example.host).x);
    const gap = Math.abs(before.get(example.head).x - before.get(example.host).x);
    if (example.head === 'had') assert(gap < oldGap - 100, `a material reserved gap is removed: ${oldGap} -> ${gap}`);
    else assert(gap < 800, `the existing-projection insertion no longer reserves the later wide fork: ${gap}`);
    close(before.get(example.head).x, wide.get(example.head).x, 'the fixed head is not moved');
    close(before.get(example.head).x, movement.get(example.head).x, 'the head stays stationary at the movement');
    const delta = before.get(example.host).x - wide.get(example.host).x;
    const members = new Set(before.get(example.host).descendants().filter(node => before.has(getNodeId(node))).map(getNodeId));
    for (const id of members) {
      close(before.get(id).x - wide.get(id).x, delta, `${id} retains the complete receiving shape`);
      close(before.get(id).y, wide.get(id).y, `${id} retains its existing rank`);
    }
    for (let index = 0; index < example.frame; index++) {
      const frame = at(index + 1), old = at(index + 1, baseline);
      for (const id of members) if (frame.has(id) && old.has(id)) {
        close(frame.get(id).x - old.get(id).x, delta, `${id}: construction frame ${index + 1} uses the same translation`);
        close(frame.get(id).y, old.get(id).y, 'ordinary selection and merge keep existing vertical geometry');
      }
      for (const node of frame.values()) {
        if (node.parent && frame.has(getNodeId(node.parent))) assert(node.y > node.parent.y);
        const children = (node.children ?? []).filter(child => frame.has(getNodeId(child)));
        for (let child = 1; child < children.length; child++) assert(direction === 'rtl'
          ? children[child - 1].x > children[child].x : children[child - 1].x < children[child].x);
      }
    }
    const scenes = steps.map(step => ({ step, canvas: step.replayCanvasData, nodes: new Map(render(step).map(node => [getNodeId(node), node])) }));
    assert.deepEqual(workspaceContinuityReflows(scenes, points, (scene, coordinates) => render(scene.step, new Map([[scene.canvas, coordinates]]))), [],
      'all ordinary attachment and movement ownership constraints remain satisfied');
    for (const zoom of [0.4, 1, 2]) for (const id of members) {
      close((before.get(id).x - before.get(example.host).x) * zoom,
        (wide.get(id).x - wide.get(example.host).x) * zoom, `${id} has the same internal spacing under zoom`);
    }
    assert.equal(JSON.stringify(record), original, 'authored stages, order, and pronunciation are untouched');
    for (let index = example.frame; index < steps.length; index++) {
      assert.deepEqual(points.get(steps[index].replayCanvasData), baseline.get(steps[index].replayCanvasData),
        'movement and later coordinates keep their established layout');
    }
  });
}

test('a nonmovement moment cannot request compact construction geometry', () => {
  const record = records[0], { steps, sizes, baseline } = setup(record, 1600, 948, 'ltr');
  const controls = steps.map(step => ({ ...step, replayKind: step.replayKind === 'relation' ? 'macro' : step.replayKind }));
  const points = new Map(baseline);
  assert.equal(compactCurrentRootForks(controls, sizes, points), points);
});

test('a stale movement drawing cannot reserve compact construction space', () => {
  const record = records[0], { steps, sizes, baseline } = setup(record, 1600, 948, 'ltr');
  const controls = steps.map(step => ({ ...step, replayRelationLinks: step.replayRelationLinks.map(link => ({
    ...link, authoredRelationKey: 'unrelated:0'
  })) }));
  const points = new Map(baseline);
  assert.equal(compactCurrentRootForks(controls, sizes, points), points);
});
