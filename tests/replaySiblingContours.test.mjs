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
import { TREE_ROW_HEIGHT, TREE_SIBLING_GAP } from '../replay/treeSpacing.ts';
import { layoutReplayFrames } from '../scripts/replayFrameLayout.mjs';
import { directionsFor } from './helpers/rtlMirror.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../fixtures/replay-regressions/${name}`, import.meta.url), 'utf8'));
const phaseEdge = read('es-wh-phase-edge-contour.json');
const headFinal = read('diverse-recovery.json').examples.find(example => example.id === 'sol-korean-long-negation');
const compactLanding = read('hi-correlative-landing-contour.json');
const viewports = [[1600, 948], [390, 844]];

function layoutRecord(record, [width, height], direction) {
  const input = { sentence: record.sentence, inputTokens: record.inputTokens,
    derivationStages: (record.analysis ?? record).derivationStages, includePlayback: true };
  const steps = prepareReplay(structuredClone(input)).playbackSteps;
  return { steps, scenes: layoutReplayFrames({ steps, stages: input.derivationStages, width, height, direction },
    { coordinates, camera, layout, display, d3 }).scenes };
}
const frames = (...args) => layoutRecord(...args).scenes;

/** Nodes that persist into a frame but change position, keyed by frame number,
 * kind and operation target, with their [reading-order x, y] displacement. */
function movers(scenes, direction) {
  const sign = direction === 'rtl' ? -1 : 1, round = value => +value.toFixed(1) || 0, result = {};
  scenes.forEach((scene, index) => {
    const moved = Object.fromEntries([...scene.nodes].flatMap(([id, node]) => {
      const old = index ? scenes[index - 1].nodes.get(id) : undefined;
      return old && Math.hypot(node.x - old.x, node.y - old.y) > 1e-6
        ? [[id, [round((node.x - old.x) * sign), round(node.y - old.y)]]] : [];
    }));
    if (Object.keys(moved).length) result[`f${index + 1} ${scene.step.replayKind}:${scene.step.targetNodeId}`] = moved;
  });
  return result;
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
  // a and c each have a node on row 3, which b does not occupy.
  const ordered = ({ aMid = 0, aDeep = 0, direction = 'ltr' } = {}) => {
    const at = { p: [150, 0], a: [0, 1], aMid: [aMid, 2], aDeep: [aDeep, 3], b: [100, 1], b1: [60, 2], b2: [140, 2],
      c: [300, 1], cMid: [300, 2], cDeep: [300, 3] };
    const node = id => ({ id, label: id });
    const root = d3.hierarchy({ ...node('p'), children: [
      { ...node('a'), children: [{ ...node('aMid'), children: [node('aDeep')] }] },
      { ...node('b'), children: [node('b1'), node('b2')] },
      { ...node('c'), children: [{ ...node('cMid'), children: [node('cDeep')] }] }
    ] });
    const sign = direction === 'rtl' ? -1 : 1;
    return siblingContoursOrdered(root.descendants(), direction,
      current => ({ x: at[current.data.id][0] * sign, y: at[current.data.id][1] * 220 }));
  };
  for (const direction of ['ltr', 'rtl']) {
    assert.equal(ordered({ direction }), true);
    // a < b on their own row, but a's daughter passes under b's left daughter.
    assert.equal(ordered({ aMid: 80, direction }), false);
    // a's deeper node passes under c on a row b does not occupy, so each
    // neighbouring pair is ordered and only the earlier sisters' union catches it.
    assert.equal(ordered({ aDeep: 320, direction }), false);
  }
});

test('a deep unary chain is checked in linear work', () => {
  const size = 2048;
  let data = { id: 'leaf', label: 'X' };
  for (let index = 0; index < size - 1; index++) data = { id: `n${index}`, label: 'X', children: [data] };
  const root = d3.hierarchy(data);
  root.each(node => { node.x = 0; node.y = node.depth * TREE_ROW_HEIGHT; });
  const nodes = root.descendants(), set = Map.prototype.set;
  let writes = 0;
  Map.prototype.set = function (...args) { writes++; return set.apply(this, args); };
  let ordered;
  try { ordered = siblingContoursOrdered(nodes); } finally { Map.prototype.set = set; }
  assert.equal(ordered, true);
  // Copying every descendant row through every ancestor would need about size² / 2 writes.
  assert.ok(writes <= 2 * size, `${writes} row writes for ${size} nodes`);
});

// Right to left these run only for a record whose layout is not the reflection
// of its left-to-right layout (tests/helpers/rtlMirror.mjs).
const directions = [...new Set(['es-wh-phase-edge-contour.json#', 'diverse-recovery.json#/examples/5/analysis',
  'hi-correlative-landing-contour.json#'].flatMap(id => directionsFor(`replay-regressions/${id}`)))];
for (const viewport of viewports) for (const direction of directions) {
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
    // In this record the repaired plan adds no motion: only the V-to-v moment moves v.
    assert.deepEqual(movers(scenes, direction), { 'f15 relation:verb1': { v0: [187.5, 220] } });
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
    assert.deepEqual(movers(scenes, direction), {}, 'no existing syntax moves in any frame');
  });

  test(`${viewport[0]}px ${direction}: a later compact slot is not carried back under the full landing`, () => {
    const scenes = frames(compactLanding, viewport, direction);
    assert.ok(scenes.some(scene => scene.step.replayKind === 'relation' && scene.step.targetNodeId === 'rD1'),
      'the subject movement has its own moment');
    scenes.forEach((scene, index) => assert.deepEqual(contourInversions(scene, direction), [], `frame ${index + 1}`));
    // The repair trades the interleaving for motion at both movement moments: the
    // lower occurrence takes its compact slot and its ancestors recentre over it.
    const raised = [0, -440];
    assert.deepEqual(movers(scenes, direction), {
      'f13 relation:rD1': { rJo: [-375, -440], rN: [-375, -440], 'rJo::__leaf': [-375, -440], 'rN::__leaf': [-375, -440],
        rD0: [412.5, 0], rAP: [206.3, 0], rTCore: [103.1, 0] },
      'f18 relation:rD2': { rJo: raised, rN: raised, 'rJo::__leaf': raised, 'rN::__leaf': raised,
        rD1: [787.5, 0], rTP: [393.8, 0], rCCore: [196.9, 0] },
      'f30 relation:mD1': { mVah: [-525, -440], 'mVah::__leaf': [-525, -440] }
    });
  });
}
