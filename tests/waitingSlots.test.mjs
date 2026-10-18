import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import * as d3 from '../node_modules/d3/src/index.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { alignmentImprovesMotion, buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
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

test('the aligned plan may not let a surviving jump grow, even when another disappears', () => {
  const motion = (unowned, count = unowned.size) => ({ unowned, joins: new Map(), count, final: [['a', 0, 0]], moves: new Map() });
  const before = motion(new Map([['5:x', 10], ['7:y', 300]]));
  assert.equal(alignmentImprovesMotion(before, motion(new Map([['5:x', 500]]))), false);
  assert.equal(alignmentImprovesMotion(before, motion(new Map([['5:x', 10]]))), true, 'a surviving jump that keeps its distance is fine');
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
