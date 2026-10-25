import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import * as d3 from '../node_modules/d3/src/index.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildStageCoordinateReservations, motionImproves } from '../replay/stageCoordinates.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { applyVizIds } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { overlapsKept } from '../replay/waitingSlots.ts';
import { collisionAreas } from '../replay/workspaceComponentLifetime.ts';

test('a slot that resolves one overlap but introduces a smaller one is rejected', () => {
  assert.equal(overlapsKept(new Map([['A|B', 5904]]), new Map([['A|C', 1428]])), false);
  assert.equal(overlapsKept(new Map([['A|B', 5904]]), new Map([['A|B', 5904]])), true, 'an unchanged overlap is kept');
  assert.equal(overlapsKept(new Map([['A|B', 5904]]), new Map()), true, 'resolving an overlap alone is fine');
});

test('overlaps between two pieces of the same slotted component are measured and may not grow', () => {
  const tree = d3.hierarchy({ id: 'piece', label: 'DP', children: [{ id: 'left', label: 'D', word: 'that' }, { id: 'right', label: 'N', word: 'person' }] });
  applyVizIds(tree);
  const place = gap => {
    const nodes = layoutSyntaxTree(tree, [2000, 1000], 'ltr', new Map([['piece', { x: 1000, y: 0 }],
      ['left', { x: 1000 - gap / 2, y: 220 }], ['right', { x: 1000 + gap / 2, y: 220 }]])).descendants();
    return collisionAreas(nodes, nodes);
  };
  const internal = areas => [...areas].filter(([pair]) => pair.includes('left') && pair.includes('right')).reduce((sum, [, area]) => sum + area, 0);
  assert(internal(place(40)) > 0, 'two members of one component are a measured pair');
  assert(internal(place(20)) > internal(place(40)));
  assert.equal(overlapsKept(place(40), place(20)), false, 'an enlarged internal overlap rejects the slot');
});

// A plan's motion as planMotion reports it: motion-rule faults by comparator key,
// continuity reflows, completed tree widths and the final tree.
const motion = ({ faults = {}, reflows = [], widths = {}, final = [['a', 0, 0]] } = {}) => {
  const entries = new Map(Object.entries(faults).map(([key, distance]) => [key, { distance }]));
  return { faults: entries, count: entries.size, reflows: new Set(reflows), widths: new Map(Object.entries(widths)), final };
};

test('a replacement plan may not let a surviving fault grow, even when another disappears', () => {
  const before = motion({ faults: { x: 10, y: 300 } });
  assert.equal(motionImproves(before, motion({ faults: { x: 500 } })), false);
  assert.equal(motionImproves(before, motion({ faults: { x: 10 } })), true, 'a surviving fault that keeps its distance is fine');
  assert.equal(motionImproves(before, motion({ faults: { x: 10, y: 300 } })), false, 'the same motion is no improvement');
});

test('a replacement plan may not trade a long jump for a new shorter one', () => {
  // A waiting piece that slides into place as its merge joins it is new motion,
  // however much it shortens: the pieces must wait where they join.
  const before = motion({ faults: { jump: 508, rides: 508 } });
  assert.equal(motionImproves(before, motion({ faults: { slide: 82 } })), false);
});

test('a replacement plan may translate the whole final tree, which the camera absorbs, but not reshape it', () => {
  const final = [['a', 0, 0], ['b', -110, 220], ['c', 110, 220]];
  const before = motion({ faults: { x: 300 }, final });
  const shifted = final.map(([id, x, y]) => [id, x + 734, y - 220]);
  assert.equal(motionImproves(before, motion({ final: shifted })), true, 'one translation of every final node is the same tree');
  assert.equal(motionImproves(before, motion({ final: shifted.map(([id, x, y]) => [id, id === 'c' ? x + 1 : x, y]) })), false,
    'a final node that moves relative to the others changes the tree');
  assert.equal(motionImproves(before, motion({ final: shifted.slice(1) })), false, 'a missing final node changes the tree');
});

test('a replacement plan adds no continuity reflow and widens no completed tree', () => {
  const before = motion({ faults: { x: 300 }, reflows: ['r'], widths: { '9:ip': 600 } });
  assert.equal(motionImproves(before, motion({ reflows: ['r', 's'], widths: { '9:ip': 600 } })), false, 'a new continuity reflow');
  assert.equal(motionImproves(before, motion({ reflows: ['r'], widths: { '9:ip': 900 } })), false, 'a wider completed tree');
  assert.equal(motionImproves(before, motion({ reflows: ['r'], widths: { '9:ip': 600, '9:vp': 2000 } })), true,
    'a tree the other plan lacks is not compared');
  assert.equal(motionImproves(motion({ faults: { x: 300 }, reflows: ['r', 's'] }), motion({ faults: { x: 300 }, reflows: ['r'] })), true,
    'with the same faults, fewer continuity reflows are better');
});

test('repeated identical layout requests reuse one slot pass', () => {
  const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/waiting-root-continuity.json', import.meta.url)));
  const steps = prepareReplay({ ...record, includePlayback: true }).playbackSteps;
  const groups = buildStageLayoutGroups(steps, record.derivationStages);
  const sizeFor = stage => stageTreeLayoutSize(steps, stage, 1440, 900, groups);
  const first = buildStageCoordinateReservations(steps, 1, sizeFor(1), sizeFor);
  const second = buildStageCoordinateReservations(steps, 1, sizeFor(1), sizeFor);
  assert(first.size > 0);
  for (const [canvas, coordinates] of first) assert.equal(second.get(canvas), coordinates, 'the same slotted reservation is returned');
});
