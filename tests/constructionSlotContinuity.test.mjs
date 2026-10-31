import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { workspaceContinuityReflows } from '../replay/workspaceShapeReflows.ts';
import { directionsFor } from './helpers/rtlMirror.mjs';

const records = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/construction-slot-continuity.json', import.meta.url))).cases;
const close = (a, b, message) => assert(Math.abs(a - b) < 1e-6, `${message}: ${a} vs ${b}`);
function setup(record, width, height, direction) {
  const steps = prepareReplay({ ...record, includePlayback: true }).playbackSteps;
  const groups = buildStageLayoutGroups(steps, record.derivationStages);
  const sizes = new Map(record.derivationStages.map((_, i) => [i, stageTreeLayoutSize(steps, i, width, height, groups)]));
  const points = new Map([...sizes].flatMap(([i, size]) => [...buildStageCoordinateReservations(steps, i, size, i => sizes.get(i), direction)]));
  const render = (step, coordinates = points.get(step.replayCanvasData)) => {
    const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
    const visible = new Set(step.replayVisibleNodeIds);
    return layoutSyntaxTree(root, sizes.get(step.replayFrameIndex), direction, coordinates, visible).descendants()
      .filter(node => visible.has(getNodeId(node)) && !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace');
  };
  const scenes = steps.map(step => ({ step, canvas: step.replayCanvasData, nodes: new Map(render(step).map(node => [getNodeId(node), node])) }));
  assert.deepEqual(workspaceContinuityReflows(scenes, points, (scene, coordinates) => render(scene.step, coordinates)), [],
    'ordinary attachments and movement retain every unaffected component');
  for (const scene of scenes) for (const node of scene.nodes.values()) {
    if (node.parent && scene.nodes.has(getNodeId(node.parent))) assert(node.y > node.parent.y);
    const children = (node.children ?? []).filter(child => scene.nodes.has(getNodeId(child)));
    for (let i = 1; i < children.length; i++) assert(direction === 'rtl' ? children[i - 1].x > children[i].x : children[i - 1].x < children[i].x);
  }
  return { steps, at: n => scenes[n - 1].nodes };
}

// Right to left this runs only for a record whose layout is not the reflection of
// its left-to-right layout (tests/helpers/rtlMirror.mjs).
const directions = [...new Set([0, 1].flatMap(index => directionsFor(`replay-regressions/construction-slot-continuity.json#/cases/${index}`)))];
for (const [width, height] of [[1600, 948], [390, 844]]) for (const direction of directions) {
  test(`${width}px ${direction}: selected word and category wait at their merge slot despite sentence casing`, () => {
    const record = records[0], original = JSON.stringify(record), { steps, at } = setup(record, width, height, direction);
    assert.equal(steps[11].operation, 'LexicalSelect'); assert.equal(steps[11].targetNodeId, 'vBase');
    assert.equal(steps[12].operation, 'ExternalMerge');
    assert(at(12).has('vBase'), 'the category is selected with its word');
    const selected = at(12).get('vBase::__leaf');
    for (const frame of [12, 13]) {
      const word = at(frame).get('vBase::__leaf');
      close(word.x, selected.x, 'selection/merge retain the selected word x');
      close(word.y, selected.y, 'selection/merge retain the selected word y');
      close(at(frame).get('vBase').x, word.x, 'the head is above the word');
    }
    assert.equal(JSON.stringify(record), original, 'authored spelling and syntax are untouched');
  });

  test(`${width}px ${direction}: a future movement wrapper cannot deepen a current VP daughter`, () => {
    const record = records[1], original = JSON.stringify(record), { steps, at } = setup(record, width, height, direction);
    assert.equal(steps[21].operation, 'ExternalMerge'); assert.equal(steps[24].replayKind, 'relation');
    const last = at(24), v = last.get('l_baca_lower'), sister = last.get('l_appl_phrase');
    close(v.y, sister.y, 'current sisters occupy the same row');
    for (let frame = 1; frame <= 24; frame++) {
      const current = at(frame), head = current.get('l_baca_lower'), word = current.get('l_baca_lower::__leaf');
      assert(!current.has('l_v_lexical_head_lower'), 'the future head complex stays hidden');
      if (head) close(head.y, v.y, 'the head keeps its current rank throughout construction');
      if (word) close(word.y, last.get('l_baca_lower::__leaf').y, 'its terminal shares that construction lifetime');
    }
    const moved = at(25), wrapper = moved.get('l_v_lexical_head_lower');
    assert(wrapper, 'the wrapper appears at the owning movement');
    close(wrapper.y, moved.get('l_appl_phrase').y, 'the new wrapper takes the old daughter row');
    assert(moved.get('l_baca_lower').y > wrapper.y, 'only then does the retained head become a granddaughter');
    for (const zoom of [0.4, 1, 2]) close((v.y - last.get('l_lexical_vp').y) * zoom,
      (sister.y - last.get('l_lexical_vp').y) * zoom, 'zoom preserves equal branch depth');
    assert.equal(JSON.stringify(record), original);
  });
}
