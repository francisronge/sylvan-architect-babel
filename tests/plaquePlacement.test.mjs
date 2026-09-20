import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { placeStagePlaques, plaqueIdentity, plaqueTreeObstacles, plaqueConnectorObstacles, plaquesOverlap, projectPlaqueLayout } from '../replay/relations/plaquePlacement.ts';
import { stageTreeLayoutSize, buildStagePlaqueLayout, buildReplayPlaqueLayouts, buildStageCameraBounds, measureStagePlaqueSpace } from '../replay/stageCamera.ts';
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

test('an ordinary multiline feature plaque searches nearby pockets before using the tree bottom', () => {
  const nodes = tree().descendants();
  const item = { ...plaque(['left']), rows: [
    { label: 'Case', value: 'nominative' }, { label: 'phiFeatures', value: 'third-person singular' }
  ] };
  const box = placeStagePlaques([item], nodes).get(0);
  assert.ok(box.height > 170);
  assert.equal(box.location, 'local');
  assert.equal(box.attachmentNodeId, 'left');
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

test('small plaques use measured gaps before falling below the whole subtree', () => {
  const nodes = tree().descendants();
  const item = { ...plaque(['left', 'right']), plaqueStyle: 'theta-grid' };
  const anchor = nodes.find(node => node.data.id === 'left');
  // Leave a narrow vertical pocket between two wide reservations. None of the
  // fixed candidate heights fit, but the complete measured box does.
  const floor = anchor.y + 140;
  const obstacles = [
    { x: anchor.x - 1000, y: floor - 1000, width: 2000, height: 925 },
    { x: anchor.x - 1000, y: floor + 115, width: 2000, height: 1000 }
  ];
  const box = placeStagePlaques([item], nodes, obstacles).get(0);
  assert.equal(box.location, 'local');
  assert(obstacles.every(obstacle => !plaquesOverlap(box, obstacle)));
  assert(box.y >= floor - 51 && box.y + box.height <= floor + 91);
});

test('plaques yield to neutral connector stems without displacing clear placements', () => {
  const nodes = tree().descendants();
  const item = plaque(['left']);
  const initial = placeStagePlaques([item], nodes).get(0);
  const witness = nodes.find(node => node.data.id === 'right');
  witness.x = initial.x + initial.width / 2;
  witness.y = initial.y - 10;
  const fallback = { kind: 'fallback', drawing: { marks: [], link: { endpoints: ['right', 'left'] } } };
  const stems = plaqueConnectorObstacles([fallback], nodes);
  assert(stems.some(stem => plaquesOverlap(initial, stem)), 'the original pocket obstructs a straight stem');
  const obstacles = [...plaqueTreeObstacles(nodes), ...stems];
  const previous = new Map([[plaqueIdentity(item), initial]]);
  const result = placeStagePlaques([item], nodes, obstacles, previous).get(0);
  assert(stems.every(stem => !plaquesOverlap(result, stem)), 'move the plaque out of the connector corridor');
  assert.equal(result.location, 'local');
  assert.deepEqual(plaqueConnectorObstacles([{ ...fallback, drawing: { marks: [] } }], nodes), [],
    'one participant or a fan does not reserve a lower connector');
});

test('new stage syntax can displace a carried plaque without changing its claim or nodes', () => {
  const nodes = tree().descendants(), item = plaque(['left']);
  const original = placeStagePlaques([item], nodes).get(0);
  const obstacle = { x: original.x, y: original.y, width: original.width, height: original.height };
  const previous = new Map([[plaqueIdentity(item), original]]);
  const next = placeStagePlaques([item], nodes, [...plaqueTreeObstacles(nodes), obstacle], previous).get(0);
  assert(!plaquesOverlap(next, obstacle));
  assert.equal(previous.get(plaqueIdentity(item)), original);
  assert.deepEqual(placeStagePlaques([item], nodes, plaqueTreeObstacles(nodes), previous).get(0), original,
    'an unobstructed carried placement remains exact');
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

test('a predicate spelling change reserves the later grid width before the plaque appears', () => {
  const first = tree().data, later = structuredClone(first);
  later.children[0].word = 'A much longer authored predicate';
  const item = { ...plaque(['left']), plaqueStyle: 'theta-grid', thetaRoles: [{ nodeId: 'right', label: 'Theme', index: 'i' }] };
  const steps = [first, later].map((replayCanvasData, replayFrameIndex) => ({ replayCanvasData, replayFrameIndex, replayKind: 'macro' }));
  const plan = { frames: [0, 1].map(() => ({ items: [item] })) };
  const layouts = buildReplayPlaqueLayouts({ steps, stageIndex: 0, completedCanvas: later, plan, width: 1200, height: 900 });
  const [before, after] = layouts.map(layout => layout.get(0));
  assert(before.width > placeStagePlaques([item], tree().descendants()).get(0).width);
  assert.equal(before.width, after.width);
  assert.equal(before.x - before.attachmentX, after.x - after.attachmentX);
  assert.equal(before.y - before.attachmentY, after.y - after.attachmentY);
});

for (const record of records) {
  test(`${record.name}: carried plaques reserve future branches before their first appearance`, () => {
    const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
    const plan = compileRelationRenderPlan(record.derivationStages);
    const layouts = buildReplayPlaqueLayouts({ steps, stageIndex: 0, plan, width: 1596, height: 1016,
      completedCanvas: buildRenderableDerivationCanvasData(record.derivationStages.at(-1).workspaceForest) });
    let previous = new Map();
    let carried = 0;
    for (const [stageIndex, stage] of record.derivationStages.entries()) {
      const input = { steps, stageIndex, plan, width: 1596, height: 1016,
        completedCanvas: buildRenderableDerivationCanvasData(stage.workspaceForest) };
      const layout = layouts[stageIndex];
      const { scenes } = measureStagePlaqueSpace(input);
      for (const scene of scenes) {
        const positions = new Map(scene.nodes.map(node => [node.__vizId ?? node.data.id, node]));
        const boxes = [...projectPlaqueLayout(layout, id => positions.get(id)).values()];
        boxes.forEach((box, i) => {
          assert(scene.obstacles.every(obstacle => !plaquesOverlap(box, obstacle, 0)));
          assert(boxes.slice(i + 1).every(other => !plaquesOverlap(box, other, 0)));
        });
      }
      const current = new Map([...layout].map(([index, box]) => [plaqueIdentity(plan.frames[stageIndex].items[index]), box]));
      for (const [key, box] of current) {
        const prior = previous.get(key);
        if (!prior) continue;
        carried++;
        assert.equal(box.attachmentNodeId, prior.attachmentNodeId);
        assert.equal(box.location, prior.location);
        assert(Math.abs((box.x - box.attachmentX) - (prior.x - prior.attachmentX)) < 1e-8);
        assert(Math.abs((box.y - box.attachmentY) - (prior.y - prior.attachmentY)) < 1e-8);
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

test('a probe plaque is reserved against actual Replay coordinates', () => {
  const record = records.find(record => record.name === 'astra-minimalism');
  const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
  const plan = compileRelationRenderPlan(record.derivationStages);
  const stageIndex = 2;
  const firstProbe = steps.find(step => step.replayRelationIdentity?.stageIndex === stageIndex);
  const root = replayTree(firstProbe, steps, 1596, 1016);
  const layout = buildStagePlaqueLayout({ steps, stageIndex, plan, width: 1596, height: 1016,
    completedCanvas: buildRenderableDerivationCanvasData(record.derivationStages[stageIndex].workspaceForest) });
  const box = [...layout.values()][0];
  const anchor = root.descendants().find(node => node.data.id === box.attachmentNodeId);
  assert.equal(box.attachmentX, anchor.x);
  assert.equal(box.attachmentY, anchor.y);
  const visible = new Set(firstProbe.replayVisibleNodeIds);
  const obstacles = plaqueTreeObstacles(root.descendants().filter(node => visible.has(node.__vizId ?? node.data.id)));
  assert(obstacles.every(obstacle => !plaquesOverlap(box, obstacle)));
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
        for (const scene of measureStagePlaqueSpace(input).scenes) {
          const byId = new Map(scene.nodes.map(node => [node.__vizId ?? node.data.id, node]));
          assert([...projectPlaqueLayout(layout, id => byId.get(id)).values()].every(box => scene.obstacles
            .every(obstacle => !plaquesOverlap(box, obstacle, 0))), 'projected plaques clear syntax and movement trajectories');
        }
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

test('below-tree plaques cannot escape a connector stem by moving below its tree reservation', () => {
  const nodes = tree().descendants();
  const item = plaque(['root'], true);
  const fallback = { kind: 'fallback', drawing: { marks: [], link: { endpoints: ['root', 'right'] } } };
  const stems = plaqueConnectorObstacles([fallback], nodes);
  const original = placeStagePlaques([item], nodes).get(0);
  const result = placeStagePlaques([item], nodes, [...plaqueTreeObstacles(nodes), ...stems],
    new Map([[plaqueIdentity(item), original]])).get(0);
  assert.equal(result.location, 'below');
  assert.notEqual(result.x, original.x, 'the plaque must use a clear column, not sink beneath the old stem end');
  assert(stems.every(stem => !plaquesOverlap(result, stem)));
  assert(Object.values(result).filter(v => typeof v === 'number').every(Number.isFinite));
  const extended = stems.map(stem => ({ ...stem, height: result.y + result.height + 500 }));
  assert(extended.every(stem => !plaquesOverlap(result, stem)), 'longer lower lanes remain clear');
});
