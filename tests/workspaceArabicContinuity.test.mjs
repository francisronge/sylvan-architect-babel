import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { visibleComponentNodes } from '../replay/visibleComponent.ts';

const cases = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/workspace-arabic-continuity.json', import.meta.url))).cases;
const cache = new Map();
const parent = (node, nodes) => node.parent && nodes.has(getNodeId(node.parent)) ? getNodeId(node.parent) : null;
const material = (node, nodes) => [getNodeId(node), node.data.label, node.data.word, node.data.silent,
  (node.children ?? []).filter(child => nodes.has(getNodeId(child))).map(child => material(child, nodes))];
const adjunctAttachments = {
  'arabic-relative/4': [30, 31, 'mvb'],
  'arabic-relative/5': [31, 32, 'rvb'],
  'arabic-relative/6': [42, 43, 'mvb'],
  'arabic-relative/7': [31, 32, 'rvb'],
  'arabic-relative/8': [42, 43, 'mvb'],
  'arabic-relative/9': [43, 44, 'mvb']
};

function setup(record, width, height, direction) {
  const key = JSON.stringify([record.key, width, height, direction]);
  if (cache.has(key)) return cache.get(key);
  const original = JSON.stringify(record);
  const replay = prepareReplay({ ...record, includePlayback: true });
  const steps = replay.playbackSteps;
  const groups = buildStageLayoutGroups(steps, replay.replayDerivationFrames);
  const sizeFor = stage => stageTreeLayoutSize(steps, stage, width, height, groups);
  const frames = steps.map(step => {
    const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
    const visible = new Set(step.replayVisibleNodeIds), size = sizeFor(step.replayFrameIndex);
    const coordinates = buildStageCoordinateReservations(steps, step.replayFrameIndex, size, sizeFor, direction).get(step.replayCanvasData);
    const tree = layoutSyntaxTree(root, size, direction, coordinates, visible);
    const nodes = new Map(tree.descendants().filter(node => visible.has(getNodeId(node))
      && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace').map(node => [getNodeId(node), node]));
    return { step, nodes };
  });
  const result = { frames, immutable: () => assert.equal(JSON.stringify(record), original) };
  cache.set(key, result); return result;
}

for (const [width, height] of [[1600, 1100], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  for (const record of cases.filter(record => adjunctAttachments[record.key])) {
    test(`${width}px ${direction}: ${record.key} attaches an adjunct without deforming its unchanged clause`, () => {
      const run = setup(record, width, height, direction);
      const [a, b, id] = adjunctAttachments[record.key];
      const before = run.frames[a - 1].nodes, after = run.frames[b - 1].nodes;
      const oldRoot = before.get(id), nextRoot = after.get(id);
      assert.notEqual(parent(oldRoot, before), parent(nextRoot, after));
      assert.deepEqual(material(oldRoot, before), material(nextRoot, after));
      for (const node of visibleComponentNodes(oldRoot, before)) {
        const next = after.get(getNodeId(node)); assert(next);
        assert(Math.hypot(next.x - nextRoot.x - (node.x - oldRoot.x),
          next.y - nextRoot.y - (node.y - oldRoot.y)) < 1e-6,
        `${getNodeId(node)} keeps its position within ${id} through ${a}→${b}`);
      }
      run.immutable();
    });
  }

  for (const record of cases) test(`${width}px ${direction}: ${record.key} keeps every unchanged complete workspace stationary`, () => {
    const run = setup(record, width, height, direction);
    let checked = 0;
    for (let index = 1; index < run.frames.length; index++) {
      const before = run.frames[index - 1].nodes, after = run.frames[index].nodes;
      for (const [id, root] of before) {
        const next = after.get(id);
        if (parent(root, before) || !next || parent(next, after)
          || JSON.stringify(material(root, before)) !== JSON.stringify(material(next, after))) continue;
        for (const node of visibleComponentNodes(root, before)) {
          const current = after.get(getNodeId(node));
          assert(Math.hypot(node.x - current.x, node.y - current.y) < 1e-6,
            `${getNodeId(node)} in unchanged ${id} moves at frame ${index}→${index + 1}`);
          checked++;
        }
      }
    }
    assert(checked > 100, 'checks complete components through construction and relation moments');
    run.immutable();
  });

  for (const record of cases) test(`${width}px ${direction}: ${record.key} keeps the current nominal unary branch at one rank`, () => {
    const run = setup(record, width, height, direction);
    let checked = 0;
    for (const { nodes } of run.frames) {
      if (nodes.has('nadj')) break;
      if (!['np', 'nb', 'n'].every(id => nodes.has(id))) continue;
      assert.equal(parent(nodes.get('nb'), nodes), 'np');
      const upper = nodes.get('nb').y - nodes.get('np').y;
      const lower = nodes.get('n').y - nodes.get('nb').y;
      assert(Math.abs(upper - lower) < 1e-6, `current np→nb takes ${upper} units while nb→n takes ${lower}`);
      checked++;
    }
    assert(checked > 1);
    run.immutable();
  });
}

for (const record of cases) {
  test(`${record.key}: future adjunction never disconnects the current nominal branch`, () => {
    const run = setup(record, 1600, 1100, 'ltr');
    const attachment = run.frames.findIndex(frame => frame.nodes.has('nadj'));
    assert(attachment > 0);
    for (let index = 0; index < attachment; index++) {
      const { nodes } = run.frames[index];
      if (nodes.has('np') && nodes.has('nb')) assert.equal(parent(nodes.get('nb'), nodes), 'np',
        `frame ${index + 1}: an invisible future adjunct parent must not subdivide np→nb`);
    }
    const { step, nodes } = run.frames[attachment];
    assert.equal(step.operation, 'ExternalMerge');
    assert.equal(step.targetNodeId, 'nadj');
    assert.deepEqual(nodes.get('nadj').children.map(getNodeId), ['nb', 'rc']);
    assert.equal(parent(nodes.get('nb'), nodes), 'nadj');
    assert.equal(parent(nodes.get('nadj'), nodes), 'np');
    run.immutable();
  });

  test(`${record.key}: actual head movement retains pronunciation and introduces its own trace atomically`, () => {
    const run = setup(record, 1600, 1100, 'ltr');
    for (const relation of record.derivationStages[1].relations.filter(relation => relation.relation === 'V-to-I head movement')) {
      const { raisedHead, landingHead, trace } = relation.anchors;
      const index = run.frames.findIndex(frame => frame.step.replayKind === 'relation'
        && frame.step.operation === relation.relation && frame.step.targetNodeId === raisedHead);
      assert(index > 0, `finds movement of ${raisedHead}`);
      const before = run.frames[index - 1].nodes, after = run.frames[index].nodes;
      assert(before.has(raisedHead));
      assert(!before.has(trace), 'the lower occurrence is absent before movement');
      assert(after.has(trace));
      assert(after.has(landingHead));
      assert.equal(parent(after.get(raisedHead), after), landingHead);
      assert.equal(after.get(`${raisedHead}::__leaf`).data.word, before.get(`${raisedHead}::__leaf`).data.word);
      assert(Math.hypot(after.get(raisedHead).x - before.get(raisedHead).x,
        after.get(raisedHead).y - before.get(raisedHead).y) > 1, 'the real head movement is not frozen');
    }
    run.immutable();
  });
}
