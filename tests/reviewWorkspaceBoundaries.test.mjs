import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { stageTreeLayoutSize, buildStageLayoutGroups } from '../replay/stageCamera.ts';
import { plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';

const records = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/review-workspace-boundaries.json', import.meta.url))).cases;
const framingRecords = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/review-final-framing.json', import.meta.url))).cases;
const point = node => ({ x: node.x, y: node.y });
function assertSamePoint(actual, expected, message) {
  assert([actual.x, actual.y, expected.x, expected.y].every(Number.isFinite), `${message}: finite coordinates`);
  assert(Math.hypot(actual.x - expected.x, actual.y - expected.y) <= 1e-8,
    `${message}: (${actual.x}, ${actual.y}) differs from (${expected.x}, ${expected.y})`);
}
function setup(key, width, height, direction) {
  const record = [...records, ...framingRecords].find(record => record.key === key), original = JSON.stringify(record);
  const replay = prepareReplay({ ...record, includePlayback: true }), steps = replay.playbackSteps;
  const groups = buildStageLayoutGroups(steps, replay.replayDerivationFrames);
  const sizeFor = stage => stageTreeLayoutSize(steps, stage, width, height, groups);
  const frame = number => {
    const step = steps[number - 1], root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
    const visible = new Set(step.replayVisibleNodeIds), size = sizeFor(step.replayFrameIndex);
    const reservation = buildStageCoordinateReservations(steps, step.replayFrameIndex, size, sizeFor, direction).get(step.replayCanvasData);
    const tree = layoutSyntaxTree(root, size, direction, reservation, visible);
    const nodes = new Map(tree.descendants().filter(node => visible.has(getNodeId(node))
      && node.data.replayOrigin?.kind !== 'workspace' && !node.data.replayLayoutOnly).map(node => [getNodeId(node), node]));
    return { step, nodes };
  };
  const unchanged = () => assert.equal(JSON.stringify(record), original, 'authored data stays unchanged');
  return { record, steps, frame, unchanged };
}

for (const [width, height] of [[1600, 1100], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  test(`${width}px ${direction}: Mandarin's earlier T fork keeps its shape until subject movement`, () => {
    const { frame, unchanged } = setup('holdout/mandarin-negative-relative/0', width, height, direction);
    const before = frame(15), movement = frame(19);
    assert(!before.nodes.has('rcTProjection'));
    assert(movement.nodes.has('rcTProjection'));
    assertSamePoint(point(before.nodes.get('rcTP')), point(movement.nodes.get('rcTProjection')),
      'the earlier fork stays at the later fork with the same daughters, not at the higher landing parent');
    for (const number of [14, 16, 17, 18, 15]) {
      assertSamePoint(point(frame(number).nodes.get('rcTP')), point(before.nodes.get('rcTP')),
        `frame ${number}: the earlier fork does not jump at the stage boundary`);
    }
    for (const id of ['rcT', 'rcTemporalV']) {
      assertSamePoint(point(before.nodes.get(id)), point(movement.nodes.get(id)), `${id} remains stationary`);
      assert.equal(before.nodes.get(id).parent.data.id, 'rcTP');
      assert.equal(movement.nodes.get(id).parent.data.id, 'rcTProjection');
    }
    unchanged();
  });
  for (const [key, before, after] of [
    ['fresh/portuguese-relative/0', 36, 37],
    ['fresh/korean-particles/0', 41, 42],
    ['fresh/korean-particles/0', 54, 55],
    ['fresh/mandarin-topic/1', 30, 31],
    ['fresh/mandarin-topic/3', 33, 34]
  ]) test(`${width}px ${direction}: ${key} reserves every existing node across ${before} → ${after}`, () => {
    const { frame, unchanged } = setup(key, width, height, direction);
    const previous = frame(before), next = frame(after);
    assert.equal(next.step.replayKind, 'micro', 'ordinary construction, not authored movement');
    for (const [id, node] of previous.nodes) {
      assert(next.nodes.has(id), 'existing syntax remains visible');
      assertSamePoint(point(next.nodes.get(id)), point(node), `${id} must not teleport`);
    }
    unchanged();
  });
  test(`${width}px ${direction}: Portuguese loose heads keep their attachment positions across construction stages`, () => {
    const { frame, steps, unchanged } = setup('fresh/portuguese-relative/0', width, height, direction);
    const before = frame(28);
    for (const number of [29, 30, 31, 32, 33, 34, 35, 36, 37, 35, 29, 28]) {
      const current = frame(number);
      for (const id of ['mT', 'mv', 'mV', 'bookArticle', 'bookN', 'rC', 'mC']) {
        assertSamePoint(point(current.nodes.get(id)), point(before.nodes.get(id)), `${id} in frame ${number}`);
      }
      for (const id of current.nodes.keys()) assert(steps[number - 1].replayVisibleNodeIds.includes(id), 'no reserved future syntax becomes visible');
    }
    unchanged();
  });

  test(`${width}px ${direction}: Portuguese reservation does not move the jump to the preceding subject movement`, () => {
    const { frame } = setup('fresh/portuguese-relative/0', width, height, direction);
    const before = frame(34), after = frame(35);
    for (const id of ['rT', 'rvHeadAtT', 'rVAtT', 'qEdge', 'rV', 'qBase']) {
      assertSamePoint(point(before.nodes.get(id)), point(after.nodes.get(id)), `${id} stays still when the subject moves`);
    }
    assert.notDeepEqual(point(before.nodes.get('anaArticle')), point(after.nodes.get('anaArticle')), 'the authored subject movement still happens');
  });

  test(`${width}px ${direction}: Turkish independent inflection never overlaps the growing verb phrase`, () => {
    const { frame, steps, unchanged } = setup('holdout/turkish-relative-subject/0', width, height, direction);
    for (let number = 1; number <= steps.length; number++) {
      const { nodes } = frame(number), visible = new Set(nodes.values());
      const roots = [...nodes.values()].filter(node => !visible.has(node.parent));
      const boxes = roots.map(root => plaqueTreeObstacles(root.descendants().filter(node => visible.has(node))));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        for (const a of boxes[i]) for (const b of boxes[j]) {
          const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          assert(w <= 1e-8 || h <= 1e-8, `frame ${number}: independent label, word or branch collision`);
        }
      }
      for (const node of nodes.values()) {
        if (visible.has(node.parent)) assert(node.y > node.parent.y, 'native branches still point down');
        const children = (node.children ?? []).filter(child => visible.has(child));
        for (let i = 1; i < children.length; i++) assert(direction === 'rtl'
          ? children[i - 1].x > children[i].x : children[i - 1].x < children[i].x, 'daughter order stays intact');
      }
    }
    unchanged();
  });
}

for (const [width, height] of [[1600, 1100], [390, 844]]) for (const record of records) {
  test(`${width}px: ${record.key} retains its accepted final node positions`, () => {
    const { frame, steps, unchanged } = setup(record.key, width, height, 'ltr');
    const points = [...frame(steps.length).nodes].map(([id, node]) => [id, Number(node.x.toFixed(6)), Number(node.y.toFixed(6))])
      .sort((a, b) => a[0].localeCompare(b[0]));
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(points)).digest('hex'), record.expectedFinalGeometry[`${width}x${height}`]);
    unchanged();
  });
}
