import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { stageTreeLayoutSize, buildStageLayoutGroups, buildStageCameraBounds } from '../replay/stageCamera.ts';

const records = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/workspace-reservation.json', import.meta.url))).cases;
function setup(key, width, height, direction) {
  const record = records.find(record => record.key === key), original = JSON.stringify(record);
  const replay = prepareReplay({ ...record, includePlayback: true }), steps = replay.playbackSteps;
  const groups = buildStageLayoutGroups(steps, replay.replayDerivationFrames);
  const sizeForStage = index => stageTreeLayoutSize(steps, index, width, height, groups);
  const frame = (number, renderDirection = direction) => {
    const step = steps[number - 1], size = sizeForStage(step.replayFrameIndex);
    const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
    const visible = new Set(step.replayVisibleNodeIds);
    const coordinates = buildStageCoordinateReservations(steps, step.replayFrameIndex, size, sizeForStage, renderDirection).get(step.replayCanvasData);
    const tree = layoutSyntaxTree(root, size, renderDirection, coordinates, visible);
    return { step, size, nodes: new Map(tree.descendants().filter(node => visible.has(getNodeId(node))).map(node => [getNodeId(node), node])) };
  };
  const immutable = () => assert.equal(JSON.stringify(record), original, 'layout does not rewrite the model record');
  const bounds = number => {
    const step = steps[number - 1];
    return buildStageCameraBounds({ steps, stageIndex: step.replayFrameIndex,
      completedCanvas: step.replayCanvasData, plan: null, width, height, direction,
      layoutGroups: groups, includeOverlays: false });
  };
  return { frame, steps, immutable, bounds };
}
const point = node => ({ x: node.x, y: node.y });

test('retained workspace coordinates cannot reuse the other direction’s cache', () => {
  const { frame } = setup('arabic-relative-predicate/1', 1408, 680, 'ltr');
  const snapshots = new Map();
  for (const direction of ['ltr', 'rtl', 'ltr', 'rtl']) {
    const before = frame(49, direction), after = frame(50, direction);
    const ids = before.nodes.get('restricted-books').descendants().map(getNodeId);
    const positions = ids.map(id => [id, point(after.nodes.get(id))]);
    for (const id of ids) {
      const a = after.nodes.get(id), b = before.nodes.get(id);
      assert(Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.y - b.y) < 1e-8);
    }
    if (snapshots.has(direction)) assert.deepEqual(positions, snapshots.get(direction));
    snapshots.set(direction, positions);
  }
});

for (const [width, height] of [[1408, 680], [386, 698]]) for (const direction of ['ltr', 'rtl']) {
  for (const reading of [0, 1]) test(`${width}px ${direction}: Arabic ${reading + 1} uses one branch rank through head movement`, () => {
    const { frame, immutable } = setup(`arabic-relative-predicate/${reading}`, width, height, direction);
    for (const number of [19, 20, 21, 22]) {
      const { nodes } = frame(number);
      for (const id of ['vp-agent', 'v-complement']) {
        const parent = nodes.get(id), children = parent.children.filter(child => nodes.has(getNodeId(child)));
        assert(children.length >= 2, 'the saved branch must be visible');
        assert(Math.abs(children[0].y - children[1].y) < 1e-8, `frame ${number}: ${id} daughters share their rank`);
      }
      for (const node of nodes.values()) if (node.parent && nodes.has(getNodeId(node.parent))) {
        assert(node.y > node.parent.y, `frame ${number}: every current branch points down`);
      }
    }
    immutable();
  });

  test(`${width}px ${direction}: Arabic's unchanged workspace retains its position through the next stage`, () => {
    const { frame, immutable, bounds } = setup('arabic-relative-predicate/1', width, height, direction);
    const before = frame(49), root = before.nodes.get('restricted-books');
    const ids = root.descendants().map(getNodeId);
    for (const number of [50, 51, 52, 53, 54, 55, 56, 57, 58, 50, 49]) {
      const after = frame(number);
      for (const id of ids) {
        const expected = point(before.nodes.get(id)), actual = point(after.nodes.get(id));
        assert(Math.abs(actual.x - expected.x) < 1e-8, `frame ${number}: ${id} keeps x after direction is applied`);
        assert(Math.abs(actual.y - expected.y) < 1e-8, `frame ${number}: ${id} keeps y`);
      }
      // Changing the direction rebases the whole stage. Its internal geometry
      // must remain an exact reflection, including the other workspace's gap.
      const opposite = frame(number, direction === 'ltr' ? 'rtl' : 'ltr');
      const anchor = after.nodes.get('restricted-books'), reflectedAnchor = opposite.nodes.get('restricted-books');
      for (const [id, node] of after.nodes) {
        const reflected = opposite.nodes.get(id);
        assert(Math.abs((node.x - anchor.x) + (reflected.x - reflectedAnchor.x)) < 1e-8,
          `frame ${number}: ${id} retains its spacing relative to the workspace`);
        assert.equal(node.y, reflected.y);
      }
      if (number >= 50 && number < 54) assert(!after.nodes.has('topic-projection'), 'future parent remains invisible');
      if (number >= 54) assert(after.nodes.has('topic-projection'), 'actual topic merge is still frame 54');
    }
    const final = frame(58), top = final.nodes.get('matrix-cp'), fit = bounds(58);
    assert(top.y < 0, 'new surrounding parents extend above the retained workspace');
    assert(fit.minY <= top.y && fit.maxY > top.y, 'stage fit includes the new top parent');
    assert(fit.minX < top.x && fit.maxX > top.x, 'stage fit includes its horizontal position');
    immutable();
  });

  test(`${width}px ${direction}: Icelandic reserves the subject landing without changing the C–IP merge`, () => {
    const { frame, immutable } = setup('icelandic-raising-passive/0', width, height, direction);
    const before = frame(37), after = frame(38);
    assert.equal(before.nodes.get('rootCbar').data.label, "C′");
    assert.deepEqual(before.nodes.get('rootCbar').children.map(getNodeId), ['rootC', 'matrixIP']);
    assert(!before.nodes.has('matrixSubjectDP'));
    assert(after.nodes.has('matrixSubjectDP'));
    assert.equal(before.nodes.get('matrixIP').x, before.nodes.get('matrixIbar').x, 'a unary branch stays vertical');
    assert.deepEqual(point(before.nodes.get('rootC')), point(after.nodes.get('rootC')), 'C stays put when the subject arrives');
    assert(Math.abs(after.nodes.get('declarativeFeatures').x - after.nodes.get('matrixSubjectDP').x) > 200,
      'the C child and arriving subject retain separate same-rank slots');
    immutable();
  });

  test(`${width}px ${direction}: Arabic builds the clause in its attachment position and keeps its lower witness there`, () => {
    const { frame, immutable } = setup('arabic-relative-predicate/1', width, height, direction);
    const completed = frame(49), clause = completed.nodes.get('matrix-t-complement');
    const members = clause.descendants().map(getNodeId);
    assert(!frame(36).nodes.has('matrix-pro'), 'the reservation cannot reveal the clause early');
    for (const number of [...Array.from({ length: 22 }, (_, i) => i + 37), 50, 49, 37]) {
      const current = frame(number);
      for (const id of members) {
        const visibleId = number >= 50 && id === 'matrix-pro' ? 'matrix-pro-trace' : id;
        const actual = current.nodes.get(visibleId);
        if (!actual) continue;
        const expected = completed.nodes.get(id);
        assert(Math.abs(actual.x - expected.x) < 1e-8, `frame ${number}: ${visibleId} keeps its reserved x`);
        assert(Math.abs(actual.y - expected.y) < 1e-8, `frame ${number}: ${visibleId} keeps its reserved rank`);
      }
      if (number < 50) assert(!current.nodes.has('matrix-pro-trace'), 'lower witness waits for its movement moment');
    }
    const movement = frame(50);
    assert(movement.nodes.has('matrix-pro-trace'));
    assert.notDeepEqual(point(movement.nodes.get('matrix-pro')), point(movement.nodes.get('matrix-pro-trace')),
      'the actual landing and lower occurrence still occupy separate positions');
    assert(movement.step.replayRelationLinks.some(link => link.priorSourceNodeId === 'matrix-pro'
      && link.witnessNodeId === 'matrix-pro-trace'), 'the owning trajectory remains at frame 50');
    immutable();
  });
}
