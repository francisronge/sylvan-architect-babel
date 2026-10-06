import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';

const records = JSON.parse(fs.readFileSync(new URL(
  '../fixtures/replay-regressions/workspace-source-continuity.json', import.meta.url))).cases;
const setups = new Map();
function setup(key, width, height, direction) {
  const cacheKey = JSON.stringify([key, width, height, direction]);
  if (setups.has(cacheKey)) return setups.get(cacheKey);
  const record = records.find(record => record.key === key), original = JSON.stringify(record);
  assert(record, key);
  const replay = prepareReplay({ ...record, includePlayback: true }), steps = replay.playbackSteps;
  const groups = buildStageLayoutGroups(steps, replay.replayDerivationFrames);
  const sizeFor = stage => stageTreeLayoutSize(steps, stage, width, height, groups);
  const frames = new Map();
  const frame = number => {
    if (frames.has(number)) return frames.get(number);
    const step = steps[number - 1], size = sizeFor(step.replayFrameIndex);
    const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
    const visible = new Set(step.replayVisibleNodeIds);
    const reservation = buildStageCoordinateReservations(steps, step.replayFrameIndex,
      size, sizeFor, direction).get(step.replayCanvasData);
    const tree = layoutSyntaxTree(root, size, direction, reservation, visible);
    const nodes = new Map(tree.descendants().filter(node => visible.has(getNodeId(node)))
      .map(node => [getNodeId(node), node]));
    const result = { number, step, nodes };
    frames.set(number, result);
    return result;
  };
  const result = { steps, frame, immutable: () => assert.equal(JSON.stringify(record), original) };
  setups.set(cacheKey, result);
  return result;
}

function assertPoint(actual, expected, message) {
  assert(actual && expected, `${message}: both occurrences exist`);
  assert(Math.abs(actual.x - expected.x) < 1e-7 && Math.abs(actual.y - expected.y) < 1e-7,
    `${message}: expected (${expected.x}, ${expected.y}), received (${actual.x}, ${actual.y})`);
}
const syntaxParent = (node, nodes) => node.ancestors().slice(1).find(parent =>
  nodes.has(getNodeId(parent)) && !parent.data.replayLayoutOnly && parent.data.replayOrigin?.kind !== 'workspace');
const topology = (node, nodes) => JSON.stringify([
  node.ancestors().slice(1).filter(parent => nodes.has(getNodeId(parent))
    && !parent.data.replayLayoutOnly && parent.data.replayOrigin?.kind !== 'workspace').map(getNodeId),
  (node.children ?? []).filter(child => nodes.has(getNodeId(child))).map(getNodeId)
]);

for (const [width, height] of [[1600, 1100], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  const context = `${width}px ${direction}`;
  test(`${context}: selecting finite I leaves all existing German objects stationary`, () => {
    const { frame, immutable } = setup('fresh/german-embedded/0', width, height, direction);
    const before = frame(35), after = frame(36);
    assert.equal(before.step.replayKind, 'macro');
    assert.equal(after.step.operation, 'LexicalSelect');
    assert.equal(after.step.targetNodeId, 'embeddedI');
    assert(!before.nodes.has('embeddedI'));
    assert(after.nodes.has('embeddedI'));
    let checked = 0;
    for (const [id, node] of before.nodes) {
      const next = after.nodes.get(id);
      if (!next) continue;
      assertPoint(next, node, `${id} at 35→36`);
      checked++;
    }
    assert(checked >= 30, 'the complete existing forest is checked');
    immutable();
  });

  test(`${context}: waiting German heads and words retain their first slots through attachment`, () => {
    const { steps, frame, immutable } = setup('fresh/german-embedded/0', width, height, direction);
    for (const id of ['glaubeV', 'dassC']) {
      const first = steps.findIndex(step => step.replayVisibleNodeIds.includes(id)) + 1;
      const attachment = steps.findIndex((_, index) => index + 1 >= first
        && syntaxParent(frame(index + 1).nodes.get(id), frame(index + 1).nodes)) + 1;
      assert(first > 0 && attachment > first);
      assert.equal(attachment, id === 'dassC' ? 44 : 47, 'first attachment remains the authored merge');
      for (const member of [id, `${id}::__leaf`]) {
        const appearance = steps.findIndex(step => step.replayVisibleNodeIds.includes(member)) + 1;
        const initial = frame(appearance).nodes.get(member);
        for (let number = appearance; number <= attachment; number++) {
          const current = frame(number);
          assertPoint(current.nodes.get(member), initial, `${member} at frame ${number}`);
          if (number < attachment && current.nodes.has(id)) {
            assert.equal(syntaxParent(current.nodes.get(id), current.nodes), undefined,
              'a reserved future parent stays invisible');
          }
        }
      }
      assertPoint(frame(first).nodes.get(id), frame(attachment).nodes.get(id), 'reverse inspection is identical');
    }
    immutable();
  });

  test(`${context}: the full auxiliary source survives selection, then moves at its relation`, () => {
    const { frame, immutable } = setup('fresh/german-embedded/0', width, height, direction);
    const selected = frame(28), projected = frame(29), prior = frame(41), movement = frame(42);
    assert.equal(selected.step.operation, 'LexicalSelect');
    assert.equal(selected.step.targetNodeId, 'wirdV::__leaf');
    assert(selected.nodes.has('wirdV::__leaf'));
    assert(!selected.nodes.has('wirdV'));
    assert.equal(projected.step.operation, 'Project');
    assert(projected.nodes.has('wirdV'));
    const sourceWord = selected.nodes.get('wirdV::__leaf');
    for (let number = 28; number <= 41; number++) {
      const current = frame(number);
      assertPoint(current.nodes.get('wirdV::__leaf'), sourceWord, `source word at frame ${number}`);
      assert.equal(current.nodes.get('wirdV::__leaf').data.word, 'wird');
      assert(!current.nodes.has('wirdTrace'), 'the lower occurrence waits for movement');
      assert(!current.step.replayRelationLinks.some(link => link.priorSourceNodeId === 'wirdV'));
      if (number >= 29) assertPoint(current.nodes.get('wirdV'), projected.nodes.get('wirdV'),
        `source head at frame ${number}`);
    }
    assert.equal(movement.step.replayKind, 'relation');
    assert.equal(getNodeId(syntaxParent(prior.nodes.get('wirdV'), prior.nodes)), 'embeddedVbar');
    assert.equal(getNodeId(syntaxParent(movement.nodes.get('wirdV'), movement.nodes)), 'embeddedI');
    assert(movement.nodes.has('wirdTrace'));
    assert.equal(getNodeId(syntaxParent(movement.nodes.get('wirdTrace'), movement.nodes)), 'embeddedVbar');
    assert(movement.step.replayRelationLinks.some(link => link.priorSourceNodeId === 'wirdV'
      && link.witnessNodeId === 'wirdTrace' && link.targetNodeId === 'wirdV'
      && link.renderFamily === 'trajectory'));
    const a = prior.nodes.get('wirdV'), b = movement.nodes.get('wirdV');
    assert(Math.hypot(a.x - b.x, a.y - b.y) > 1, 'the actual movement is not frozen');
    assert.equal(movement.nodes.get('wirdV::__leaf').data.word, 'wird');
    immutable();
  });

  for (const [key, boundaries] of [
    ['archive/english-negation-xbar-sol/0', [[30, 31], [42, 43]]],
    ['holdout/swahili-passive/0', [[41, 42]]]
  ]) test(`${context}: ${key} keeps previously stationary components at later construction boundaries`, () => {
    const { frame, immutable } = setup(key, width, height, direction);
    for (const [first, second] of boundaries) {
      const before = frame(first), after = frame(second);
      assert.equal(after.step.replayKind, 'micro');
      let checked = 0;
      for (const [id, previous] of before.nodes) {
        const current = after.nodes.get(id);
        if (!current || topology(previous, before.nodes) !== topology(current, after.nodes)) continue;
        assertPoint(current, previous, `${id} at ${first}→${second}`);
        checked++;
      }
      assert(checked >= 20, 'the unchanged component includes its internal nodes and words');
    }
    immutable();
  });
}
