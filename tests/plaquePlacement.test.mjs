import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { placeStagePlaques, plaqueIdentity, plaqueTreeObstacles, plaquesOverlap, projectPlaqueLayout } from '../replay/relations/plaquePlacement.ts';
import { stageTreeLayoutSize, buildStagePlaqueLayout, buildStageCameraBounds } from '../replay/stageCamera.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { applyVizIds, buildRenderableDerivationCanvasData } from '../replay/replayCompiler.ts';

const plaque = (ids, long = false) => ({ kind: 'node-plaque', plaqueStyle: 'feature',
  anchorNodeIds: ids, title: 'Authored relation', rows: [{ label: 'claim', value: long ? 'A complete authored explanation. '.repeat(15) : 'value' }],
  relationRef: { stageIndex: 0, relationIndex: 0 } });
const tree = () => d3.tree().nodeSize([600, 300])(d3.hierarchy({ id: 'root', label: 'XP', children: [
  { id: 'left', label: 'X', word: 'first' }, { id: 'right', label: 'Y', word: 'second' }
]}));

test('a small plaque uses a clear nearby pocket with room for its entire rectangle', () => {
  const nodes = tree().descendants();
  const result = placeStagePlaques([plaque(['left'])], nodes);
  const box = result.get(0);
  assert.equal(box.location, 'local');
  assert(plaqueTreeObstacles(nodes).every(obstacle => !plaquesOverlap(box, obstacle)));
});

test('large plaques are centered beneath their enclosing subtree and stack without lost content', () => {
  const nodes = tree().descendants();
  const items = [plaque(['left', 'right'], true), plaque(['left', 'right'], true)];
  const original = JSON.stringify(items);
  const result = placeStagePlaques(items, nodes);
  assert.equal(result.size, 2);
  for (const box of result.values()) {
    assert.equal(box.location, 'below');
    assert.equal(box.domainId, 'root');
    const obstacles = plaqueTreeObstacles(nodes);
    const domainCenter = (Math.min(...obstacles.map(rect => rect.x))
      + Math.max(...obstacles.map(rect => rect.x + rect.width))) / 2;
    assert.equal(box.x + box.width / 2, domainCenter);
    assert(box.y > 400);
  }
  assert(!plaquesOverlap(result.get(0), result.get(1)));
  assert.equal(JSON.stringify(items), original);
});

test('space reserved for a future word prevents an earlier plaque occupying its position', () => {
  const nodes = tree().descendants();
  const items = [plaque(['left'])];
  const initial = placeStagePlaques(items, nodes).get(0);
  const reserved = { ...initial };
  const result = placeStagePlaques(items, nodes, [...plaqueTreeObstacles(nodes), reserved]).get(0);
  assert(!plaquesOverlap(result, reserved));
});

const records = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));

test('carried plaques follow their claim, not an item index or a newly free pocket', () => {
  const nodes = tree().descendants();
  const first = plaque(['left']);
  const second = { ...plaque(['right']), relationRef: { stageIndex: 1, relationIndex: 0 } };
  const original = placeStagePlaques([first], nodes);
  const remembered = new Map([[plaqueIdentity(first), original.get(0)]]);
  const next = placeStagePlaques([second, first], nodes, [], remembered);
  assert.deepEqual(next.get(1), original.get(0));
  assert(!plaquesOverlap(next.get(0), next.get(1)));
});

for (const record of records) {
  test(`${record.name}: unchanged plaques keep their attachment and offset across authored stages`, () => {
    const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
    const plan = compileRelationRenderPlan(record.derivationStages);
    let previous = new Map();
    let carried = 0;
    for (const [stageIndex, stage] of record.derivationStages.entries()) {
      const layout = buildStagePlaqueLayout({ steps, stageIndex, plan, width: 1596, height: 1016,
        completedCanvas: buildRenderableDerivationCanvasData(stage.workspaceForest) });
      const current = new Map([...layout].map(([index, box]) => [plaqueIdentity(plan.frames[stageIndex].items[index]), box]));
      for (const [key, box] of current) {
        const prior = previous.get(key);
        if (!prior) continue;
        assert.equal(box.attachmentNodeId, prior.attachmentNodeId);
        assert.equal(box.location, prior.location);
        assert(Math.abs((box.x - box.attachmentX) - (prior.x - prior.attachmentX)) < 1e-8);
        assert(Math.abs((box.y - box.attachmentY) - (prior.y - prior.attachmentY)) < 1e-8);
        carried++;
      }
      previous = current;
    }
    assert(carried > 0);
  });
}
function replayTree(step, steps, width, height) {
  const root = d3.hierarchy(step.replayCanvasData);
  applyVizIds(root);
  return d3.tree().size(stageTreeLayoutSize(steps, step.replayFrameIndex, width, height))
    .separation((a, b) => a.parent === b.parent ? 2.5 : 3.5)(root);
}

test('Astra first probe is under the actual Replay domain, not the smaller authored-tree coordinates', () => {
  const record = records.find(record => record.name === 'astra-minimalism');
  const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
  const plan = compileRelationRenderPlan(record.derivationStages);
  const stageIndex = 2;
  const firstProbe = steps.find(step => step.replayRelationIdentity?.stageIndex === stageIndex);
  const root = replayTree(firstProbe, steps, 1596, 1016);
  const visible = new Set(firstProbe.replayVisibleNodeIds);
  const domain = root.descendants().find(node => node.data.id === 'coreVP');
  const obstacles = plaqueTreeObstacles(domain.descendants().filter(node => visible.has(node.__vizId ?? node.data.id)));
  const left = Math.min(...obstacles.map(rect => rect.x));
  const right = Math.max(...obstacles.map(rect => rect.x + rect.width));
  const bottom = Math.max(...obstacles.map(rect => rect.y + rect.height));
  const layout = buildStagePlaqueLayout({ steps, stageIndex, plan, width: 1596, height: 1016,
    completedCanvas: buildRenderableDerivationCanvasData(record.derivationStages[stageIndex].workspaceForest) });
  const plaque = [...layout.values()][0];
  assert.equal(plaque.location, 'below');
  assert(Math.abs(plaque.x + plaque.width / 2 - (left + right) / 2) < 1,
    'the first probe must be centered under its displayed domain');
  assert(plaque.y >= bottom, 'the first probe must start below its displayed domain');
});
for (const record of records) {
  for (const [width, height] of [[1596, 1016], [390, 844]]) {
    test(`${record.name} ${width}px: complete stage allocation, no plaque collisions, stable traversal and fit`, () => {
      const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
      const plan = compileRelationRenderPlan(record.derivationStages);
      const original = JSON.stringify({ steps, plan });
      record.derivationStages.forEach((stage, stageIndex) => {
        const input = { steps, stageIndex, plan, width, height,
          completedCanvas: buildRenderableDerivationCanvasData(stage.workspaceForest) };
        const layout = buildStagePlaqueLayout(input);
        assert.deepEqual(layout, buildStagePlaqueLayout({ ...input, steps: [...steps].reverse() }));
        const bounds = buildStageCameraBounds({ ...input, plaqueLayout: layout });
        const boxes = [...layout.values()];
        boxes.forEach((box, index) => {
          assert(Object.values(box).filter(value => typeof value === 'number').every(Number.isFinite));
          assert(box.x >= bounds.minX && box.x + box.width <= bounds.maxX);
          assert(box.y >= bounds.minY && box.y + box.height <= bounds.maxY);
          boxes.slice(index + 1).forEach(other => assert(!plaquesOverlap(box, other), 'reserved plaques overlap'));
        });
        for (const step of steps.filter(step => step.replayFrameIndex === stageIndex)) {
          const root = replayTree(step, steps, width, height);
          const nodes = new Map(root.descendants().map(node => [node.__vizId ?? node.data.id, node]));
          const visibleIds = new Set(step.replayVisibleNodeIds);
          const treeObstacles = plaqueTreeObstacles(root.descendants().filter(node =>
            visibleIds.has(node.__vizId ?? node.data.id)));
          const projected = projectPlaqueLayout(layout, id => nodes.get(id) ?? null);
          for (const [index, box] of projected) {
            const reserved = layout.get(index);
            const anchor = nodes.get(box.attachmentNodeId);
            assert(Math.abs((box.x - anchor.x) - (reserved.x - reserved.attachmentX)) < 1e-8,
              'Replay must preserve the chosen horizontal offset, not choose another pocket');
            assert(Math.abs((box.y - anchor.y) - (reserved.y - reserved.attachmentY)) < 1e-8,
              'Replay must preserve the chosen vertical offset');
            assert(box.x >= bounds.minX && box.x + box.width <= bounds.maxX);
            assert(box.y >= bounds.minY && box.y + box.height <= bounds.maxY);
            assert(treeObstacles.every(obstacle => !plaquesOverlap(box, obstacle, 0)),
              `${record.name} stage ${stageIndex + 1} ${step.targetLabel}: plaque ${index} covers Replay tree geometry`);
          }
          const frameBoxes = [...projected.values()];
          frameBoxes.forEach((box, index) => frameBoxes.slice(index + 1)
            .forEach(other => assert(!plaquesOverlap(box, other, 0), 'projected plaques overlap')));
        }
      });
      assert.equal(JSON.stringify({ steps, plan }), original, 'placement cannot alter analysis, timing, or classification');
    });
  }
}
