import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';

import * as display from '../replay/displayIdentity.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { siblingContoursOrdered } from '../replay/siblingContours.ts';
import * as camera from '../replay/stageCamera.ts';
import * as coordinates from '../replay/stageCoordinates.ts';
import * as layout from '../replay/treeLayout.ts';
import { TREE_SIBLING_GAP } from '../replay/treeSpacing.ts';
import { layoutReplayFrames } from '../scripts/replayFrameLayout.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../fixtures/replay-regressions/${name}`, import.meta.url), 'utf8'));
const phaseEdge = read('es-wh-phase-edge-contour.json');
const headFinal = read('diverse-recovery.json').examples[5];
const compactLanding = read('hi-correlative-landing-contour.json');
const viewports = [[1600, 948], [390, 844]];

function frames(record, [width, height], direction) {
  const input = { sentence: record.sentence, inputTokens: record.inputTokens,
    derivationStages: (record.analysis ?? record).derivationStages, includePlayback: true };
  const steps = prepareReplay(structuredClone(input)).playbackSteps;
  return layoutReplayFrames({ steps, stages: input.derivationStages, width, height, direction },
    { coordinates, camera, layout, display, d3 }).scenes;
}

/** Independent of the planner's helper: on each row of one tree, nodes from
 * disjoint subtrees appear in the tree's own reading order. */
function contourInversions(scene, direction) {
  const parentOf = node => node.parent && scene.nodes.has(display.getNodeId(node.parent)) ? node.parent : null;
  const order = new Map(), rootOf = new Map();
  const visit = (node, root) => {
    order.set(node, order.size); rootOf.set(node, root);
    for (const child of node.children ?? []) if (scene.nodes.has(display.getNodeId(child))) visit(child, root);
  };
  for (const node of scene.nodes.values()) if (!parentOf(node)) visit(node, node);
  const ancestor = (a, b) => { for (let node = parentOf(b); node; node = parentOf(node)) if (node === a) return true; return false; };
  const rows = Map.groupBy(scene.nodes.values(), node => node.y.toFixed(3));
  const inversions = [];
  for (const row of rows.values()) for (const a of row) for (const b of row) {
    if (rootOf.get(a) !== rootOf.get(b) || order.get(a) >= order.get(b) || ancestor(a, b) || ancestor(b, a)) continue;
    if (direction === 'rtl' ? a.x <= b.x : a.x >= b.x) inversions.push(`${display.getNodeId(a)} / ${display.getNodeId(b)}`);
  }
  return inversions;
}

test('sister subtrees must stay ordered on every row, not only at their roots', () => {
  const tree = () => d3.hierarchy({ id: 'p', children: [
    { id: 'a', children: [{ id: 'aWord' }] },
    { id: 'b', children: [{ id: 'b1' }, { id: 'b2' }] },
    { id: 'c', children: [{ id: 'cWord' }] }
  ] }, node => node.children);
  const points = (leafX, cX) => new Map(Object.entries({ p: [150, 0], a: [0, 1], aWord: [leafX, 2], b: [100, 1],
    b1: [10, 2], b2: [190, 2], c: [cX, 1], cWord: [cX, 2] }).map(([id, [x, y]]) => [id, { x, y: y * 220 }]));
  const ordered = (leafX, cX, direction = 'ltr') => {
    const root = tree(), at = points(leafX, cX);
    const point = direction === 'rtl' ? node => ({ x: -at.get(node.data.id).x, y: at.get(node.data.id).y })
      : node => at.get(node.data.id);
    return siblingContoursOrdered([root], node => node.children ?? [], point, direction);
  };
  assert.equal(ordered(-50, 400), true);
  // a < b at their own row, but a's word leaf passes under b's left daughter.
  assert.equal(ordered(30, 400), false);
  assert.equal(ordered(30, 400, 'rtl'), false);
  assert.equal(ordered(-50, 400, 'rtl'), true);
  // c is checked against both earlier sisters, not only its neighbour.
  assert.equal(ordered(-50, 150), false);
});

for (const viewport of viewports) for (const direction of ['ltr', 'rtl']) {
  test(`${viewport[0]}px ${direction}: a phase-edge specifier stays outside the retained subject's contour`, () => {
    const scenes = frames(phaseEdge, viewport, direction);
    const moment = scenes.findIndex(scene => scene.step.replayKind === 'relation' && scene.step.targetNodeId === 'what1');
    assert.ok(moment > 0, 'the movement to the phase edge has its own moment');
    scenes.forEach((scene, index) => assert.deepEqual(contourInversions(scene, direction), [], `frame ${index + 1}`));
    const sign = direction === 'rtl' ? -1 : 1;
    for (const scene of scenes.slice(moment)) {
      const word = scene.nodes.get('what1::__leaf'), juan = scene.nodes.get('juan');
      assert.ok(word && juan && word.y === juan.y, 'the edge word leaf shares the row of the lower specifier');
      assert.ok((juan.x - word.x) * sign >= TREE_SIBLING_GAP, `${scene.step.replayFrameIndex}: ${word.x} vs ${juan.x}`);
    }
    // The repair must not trade the overlap for motion of existing syntax.
    for (const id of ['juan', 'subjectDomain']) {
      const points = scenes.flatMap(scene => scene.nodes.has(id) ? [`${scene.nodes.get(id).x},${scene.nodes.get(id).y}`] : []);
      assert.equal(new Set(points).size, 1, `${id} keeps one position from its first frame`);
    }
    const landed = new Set(scenes.slice(moment).map(scene => `${scene.nodes.get('what1').x},${scene.nodes.get('what1').y}`));
    assert.equal(landed.size, 1, 'the landing keeps its position after its moment');
  });

  test(`${viewport[0]}px ${direction}: a waiting head-final C does not merge inside TP's contour`, () => {
    const scenes = frames(headFinal, viewport, direction);
    scenes.forEach((scene, index) => assert.deepEqual(contourInversions(scene, direction), [], `frame ${index + 1}`));
  });

  test(`${viewport[0]}px ${direction}: a later compact slot is not carried back under the full landing`, () => {
    const scenes = frames(compactLanding, viewport, direction);
    assert.ok(scenes.some(scene => scene.step.replayKind === 'relation' && scene.step.targetNodeId === 'rD1'),
      'the subject movement has its own moment');
    scenes.forEach((scene, index) => assert.deepEqual(contourInversions(scene, direction), [], `frame ${index + 1}`));
  });
}
