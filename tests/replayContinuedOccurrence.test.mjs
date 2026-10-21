import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';

import { carryCamera } from '../components/treeViewport.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import * as display from '../replay/displayIdentity.ts';
import * as camera from '../replay/stageCamera.ts';
import * as coordinates from '../replay/stageCoordinates.ts';
import * as layout from '../replay/treeLayout.ts';
import { layoutReplayFrames } from '../scripts/replayFrameLayout.mjs';
import { checkContinuedOccurrences, checkStableConstruction, frameStructure } from './helpers/replayInvariants.mjs';

// Stage 2 authors catsDP as restrictedDP and numberP as restrictedNum: the same
// D over Num over three and cats, with a new N inserted above cats to hold the PP.
const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/renamed-continuing-nominal.json', import.meta.url), 'utf8'));
const replay = prepareReplay({ ...fixture, includePlayback: true }), steps = replay.playbackSteps;
const completion = steps.findLastIndex(step => step.replayFrameIndex === 0);
const stage = steps.flatMap((step, index) => step.replayFrameIndex === 1 ? [index] : []);

test('a renamed node that keeps its slot and daughters continues its predecessor: the stage builds only N + P -> N', () => {
  assert.deepEqual(stage.filter(index => steps[index].replayKind === 'micro').map(index => [steps[index].operation, steps[index].targetNodeId]), [
    ['ExternalMerge', 'restrictedN'], ['LexicalSelect', 'be::__leaf'], ['Project', 'be'], ['ExternalMerge', 'existV']
  ], 'no step tears down or rebuilds the Num or the D');
  for (const index of [completion, ...stage]) {
    const { children } = frameStructure(steps[index]);
    assert.deepEqual(children.get('restrictedDP'), ['indefD', 'restrictedNum'], `the D keeps its daughters at frame ${index + 1}`);
    assert.deepEqual(children.get('restrictedNum'), ['three', index === completion ? 'cats' : 'restrictedN'], `the Num keeps three at frame ${index + 1}`);
  }
  assert.deepEqual(frameStructure(steps[completion + 1]).children.get('restrictedN'), ['cats', 'gardenPP'], 'the N merges in place inside the DP');
  // One node on both sides of the rename; the stage-1 claims still reach their authored anchor.
  const dp = d3.hierarchy(steps[completion].replayCanvasData).find(node => node.data.id === 'restrictedDP');
  assert.deepEqual(dp.data.aliasIds, ['catsDP']);
  assert.deepEqual(checkStableConstruction(replay), []);
  assert.deepEqual(checkContinuedOccurrences(replay, fixture), []);
});

for (const [width, height] of [[1600, 948], [390, 844]]) {
  test(`at ${width}px the DP neither jumps when the stage begins nor shifts while it builds`, () => {
    const { scenes } = layoutReplayFrames({ steps, stages: fixture.derivationStages, width, height, direction: 'ltr' },
      { coordinates, camera, layout, display, d3 });
    const painted = index => new Map([...scenes[index].nodes].map(([id, node]) => [id, { x: node.x, y: node.y,
      parentId: node.parent && scenes[index].nodes.has(display.getNodeId(node.parent)) ? display.getNodeId(node.parent) : null }]));
    const before = painted(completion), after = painted(completion + 1), carry = carryCamera({ x: 0, y: 0, k: 1 }, before, after);
    const at = (points, id, shift = { x: 0, y: 0 }) => ({ x: points.get(id).x + shift.x, y: points.get(id).y + shift.y });
    for (const id of ['indefD', 'three', 'gardenPP', 'gardenDP'])
      assert.deepEqual(at(after, id, carry), at(before, id), `${id} keeps its place where the stage begins`);
    // The one accepted change: cats descends below the N inserted above it.
    assert.equal(at(after, 'cats', carry).x, at(before, 'cats').x);
    assert(at(after, 'cats', carry).y > at(before, 'cats').y);
    const dp = scenes[completion + 1].nodes.get('restrictedDP').descendants().map(display.getNodeId).filter(id => after.has(id));
    for (const index of stage.slice(1)) for (const id of dp)
      assert.deepEqual(at(painted(index), id), at(after, id), `${id} stays put at frame ${index + 1}`);
  });
}

// The rule on small forests: `continuedOccurrences(previous, current, owned)`.
const { continuedOccurrences } = await import('../replay/continuedOccurrences.ts');
const leaf = (id, label, word) => ({ id, label, word });
const node = (id, label, ...children) => ({ id, label, children });
const previous = [node('dp', 'D', leaf('d', 'D', 'the'), node('num', 'Num', leaf('three', 'Num', 'three'), leaf('cats', 'N', 'cats'))),
  node('pp', 'P', leaf('in', 'P', 'in'), leaf('it', 'D', 'it'))];
const inserted = (dp = 'dp2', num = 'num2') => [node(dp, 'D', leaf('d', 'D', 'the'),
  node(num, 'Num', leaf('three', 'Num', 'three'), node('n', 'N', leaf('cats', 'N', 'cats'), previous[1])))];
const pairs = (current, owned = []) => [...continuedOccurrences(previous, current, () => new Set(owned))];

test('the rule pairs renamed nodes that keep category, slot and daughters, with one new node above a daughter', () => {
  assert.deepEqual(pairs(inserted()), [['dp', 'dp2'], ['num', 'num2']]);
  assert.deepEqual(pairs([node('v', 'V', leaf('be', 'V', 'be'), inserted()[0])]), [['dp', 'dp2'], ['num', 'num2']], 'a root may gain a new parent');
  assert.deepEqual(pairs(inserted('dp')), [['num', 'num2']], 'under a parent that keeps its id');
});

test('the rule fails closed on regrouping, movement, another slot and changed content', () => {
  const regrouped = [node('dp2', 'D', node('num2', 'Num', leaf('three', 'Num', 'three'), leaf('cats', 'N', 'cats')), leaf('d', 'D', 'the')), previous[1]];
  assert.deepEqual(pairs(regrouped), [], 'daughters in another order');
  const relabeled = inserted(); relabeled[0].label = 'DP';
  assert.deepEqual(pairs(relabeled), [], 'another category, which also leaves the Num without a continuing parent');
  const twice = [node('dp2', 'D', leaf('d', 'D', 'the'), node('num2', 'Num', node('q', 'Num', leaf('three', 'Num', 'three')),
    node('n', 'N', leaf('cats', 'N', 'cats'), previous[1])))];
  assert.deepEqual(pairs(twice), [], 'more than one new node over the daughters');
  const moved = [node('cp', 'C', inserted()[0], node('dp3', 'D', leaf('d3', 'D', 'a')))];
  assert.deepEqual(pairs(moved, ['dp2']), [], 'a relation that moves the material owns it');
  const elsewhere = [node('v', 'V', leaf('be', 'V', 'be'), node('x', 'X', inserted()[0]))];
  elsewhere[0].children.unshift(node('dp', 'D', leaf('other', 'D', 'other')));
  assert.deepEqual(pairs(elsewhere), [], 'the predecessor keeps its id elsewhere, so nothing dissolves');
  const rehung = [node('dp', 'D', leaf('d', 'D', 'the')), node('pp', 'P', leaf('in', 'P', 'in'), leaf('it', 'D', 'it'),
    node('num2', 'Num', leaf('three', 'Num', 'three'), leaf('cats', 'N', 'cats')))];
  assert.deepEqual(pairs(rehung), [], 'the same daughters under another parent');
});
