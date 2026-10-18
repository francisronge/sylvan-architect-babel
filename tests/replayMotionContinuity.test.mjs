import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import * as d3 from '../node_modules/d3/src/index.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import * as coordinates from '../replay/stageCoordinates.ts';
import * as camera from '../replay/stageCamera.ts';
import * as layout from '../replay/treeLayout.ts';
import * as display from '../replay/displayIdentity.ts';
import { layoutReplayFrames } from '../scripts/replayFrameLayout.mjs';
import { motionFrame, replayMotionFaults } from '../scripts/replayMotionContinuity.mjs';

const point = (id, x, y, parent = null) => ({ id, x, y, parent });
const frame = (operation, target, points, kind = 'micro', links = []) => ({ kind, operation, target, links, points });
// Deformation has its own controls; these check ownership and joins.
const kinds = faults => faults.filter(fault => fault.kind !== 'shape-motion').map(({ frame, node, kind }) => `${frame}:${node}:${kind}`);

test('a waiting workspace that moves at the merge joining it is an attachment-site fault', () => {
  const waiting = [point('head', 0, 220), point('phrase', 400, 220), point('word', 400, 440, 'phrase')];
  const frames = [frame('LexicalSelect', 'head', waiting),
    frame('ExternalMerge', 'parent', [point('parent', 200, 0), point('head', 0, 220, 'parent'),
      point('phrase', 300, 220, 'parent'), point('word', 300, 440, 'phrase')])];
  const faults = replayMotionFaults({ frames });
  assert.deepEqual(kinds(faults), ['2:phrase:attachment-site-motion']);
  assert.equal(faults[0].distance, 100);
  assert.equal(faults[0].waiting, true);
  frames[1].points[2].x = frames[1].points[3].x = 400; frames[1].points[0].x = 200;
  assert.deepEqual(replayMotionFaults({ frames }), [], 'material already at its merge site joins in place');
});

test('a head that moves under its new projection is reported; an inserted parent may only lower its host', () => {
  const frames = [
    frame('LexicalSelect', 'v', [point('v', 0, 0), point('top', 0, -220), point('vP', 500, 0, 'top')]),
    frame('Project', 'vbar', [point('vbar', 0, 0), point('v', 0, 220, 'vbar'), point('top', 0, -220),
      point('vP', 500, 0, 'top')]),
    frame('ExternalMerge', 'wrapper', [point('vbar', 0, 0), point('v', 0, 220, 'vbar'), point('top', 0, -220),
      point('wrapper', 500, 0, 'top'), point('vP', 500, 220, 'wrapper')])];
  const faults = replayMotionFaults({ frames });
  assert.deepEqual(kinds(faults), ['2:v:attachment-site-motion'], 'the host keeps its column below the parent on its row');
  assert.equal(faults[0].waiting, true);
  frames[2].points[4].x = 800;
  const shifted = replayMotionFaults({ frames });
  assert.deepEqual(kinds(shifted), ['2:v:attachment-site-motion', '3:vP:attachment-site-motion']);
  assert.deepEqual([shifted[1].distance, shifted[1].waiting], [300, false], 'only its horizontal shift counts');
  frames[2].points[3].y = -110;
  assert.equal(replayMotionFaults({ frames })[1].distance, Math.hypot(300, 220), 'a parent elsewhere grants no descent');
});


test('relation steps and existing parents do not count as attachment sites; the threshold excludes nudges', () => {
  const frames = [frame('LexicalSelect', 'a', [point('a', 0, 0), point('b', 500, 0)]),
    frame('Movement', 'a', [point('a', 300, 0), point('b', 500, 0)], 'relation'),
    frame('ExternalMerge', 'b', [point('b', 500, 0), point('a', 300.5, 0)])];
  assert.deepEqual(replayMotionFaults({ frames }), []);
  frames[2] = frame('ExternalMerge', 'c', [point('c', 400, -220), point('a', 300.5, 0, 'c'), point('b', 500, 0, 'c')]);
  assert.deepEqual(replayMotionFaults({ frames }), [], 'half a unit is below the default threshold');
  assert.deepEqual(kinds(replayMotionFaults({ frames }, { threshold: 0.1 })), ['3:a:attachment-site-motion']);
});

test('unowned motion needs no planner diagnostics: a moved bystander is reported with its distance', () => {
  const frames = [frame('LexicalSelect', 'a', [point('a', 0, 0), point('b', 500, 0), point('w', 500, 220, 'b')]),
    frame('LexicalSelect', 'c', [point('a', 0, 0), point('b', 900, 300), point('w', 900, 520, 'b'), point('c', 200, 0)])];
  const faults = replayMotionFaults({ frames });
  assert.deepEqual(kinds(faults), ['2:b:unowned-motion'], 'only the topmost moving node of the subtree');
  assert.equal(faults[0].distance, 500);
});

test('a new stage is measured after the camera carry: a common shift is not motion, a root left behind is', () => {
  const tree = (dx, dy) => [point('root', dx, dy), point('left', dx - 200, dy + 220, 'root'),
    point('right', dx + 200, dy + 220, 'root'), point('loose', 900, 0)];
  const frames = [{ ...frame('StageRecord', 'root', tree(0, 0), 'macro'), stage: 0 },
    { ...frame('LexicalSelect', 'head', [...tree(400, 220), point('head', 1200, 0)]), stage: 1 }];
  const faults = replayMotionFaults({ frames });
  assert.deepEqual(kinds(faults), ['2:loose:unowned-motion'], 'the camera follows the tree; the loose root stayed behind on screen');
  assert.equal(Math.round(faults[0].distance), Math.round(Math.hypot(400, 220)));
  frames[1].stage = 0;
  assert.deepEqual(kinds(replayMotionFaults({ frames })), ['2:root:unowned-motion'], 'within one stage the camera holds, so the tree moved');
});

test('a step owns its target, its trajectory participants, reattached syntax and their recentring ancestors', () => {
  const before = [point('root', 0, 0), point('left', -300, 220, 'root'), point('right', 300, 220, 'root'),
    point('source', 300, 440, 'right'), point('other', 900, 0)];
  const moved = [point('root', 50, 0), point('left', -300, 220, 'root'), point('right', 400, 220, 'root'),
    point('source', 400, 440, 'right'), point('other', 900, 0)];
  assert.deepEqual(kinds(replayMotionFaults({ frames: [frame('Select', 'x', before), frame('Movement', 'x', moved, 'relation', ['source'])] })), [],
    'the trajectory participant, its subtree and its ancestors move');
  assert.deepEqual(kinds(replayMotionFaults({ frames: [frame('Select', 'x', before), frame('Movement', 'x', moved, 'relation')] })),
    ['2:right:unowned-motion', '2:root:unowned-motion'], 'without that link the motion is unowned; right moves farther than its parent');
  const reattached = moved.map(item => item.id === 'right' ? { ...item, parent: null } : item);
  assert.deepEqual(kinds(replayMotionFaults({ frames: [frame('Select', 'x', before), frame('Rewrite', 'x', reattached, 'relation')] })),
    ['2:root:unowned-motion'], 'a detached subtree is owned; the root that recentres without it is not');
});

test('a child is reported when it moves differently from its moving parent', () => {
  const before = [point('parent', 0, 0), point('child', 0, 220, 'parent'), point('word', 0, 440, 'child')];
  const after = [point('parent', 10, 0), point('child', 100, 220, 'parent'), point('word', 100, 440, 'child')];
  const faults = replayMotionFaults({ frames: [frame('Select', 'x', before), frame('Select', 'y', after)] });
  assert.deepEqual(faults.filter(fault => fault.kind === 'unowned-motion').map(fault => [fault.node, fault.distance]), [['child', 100], ['parent', 10]], 'the word rides with its child');
});

test('a later seed that is an earlier seed\'s ancestor still owns its other branches', () => {
  const before = [point('root', 0, 0), point('right', 300, 220, 'root'), point('leafA', 200, 440, 'right'), point('leafB', 400, 440, 'right')];
  const after = before.map(item => item.id === 'leafB' ? { ...item, x: 500 } : item);
  assert.deepEqual(replayMotionFaults({ frames: [frame('Select', 'x', before), frame('Movement', 'leafA', after, 'relation', ['right'])] })
    .filter(fault => fault.kind === 'unowned-motion'), []);
});

test('a host lowered under an inserted parent across a stage crossing is compared after the carry', () => {
  const before = [point('root', 0, 0), point('host', 200, 220, 'root'), point('word', 200, 440, 'host'),
    ...[-200, -400, -600].map((x, index) => point(`sister${index}`, x, 220, 'root'))];
  const shifted = before.filter(item => !['host', 'word'].includes(item.id)).map(item => ({ ...item, x: item.x + 400, y: item.y + 220 }));
  const after = [...shifted, point('wrap', 600, 440, 'root'), point('host', 600, 660, 'wrap'), point('word', 600, 880, 'host'), point('adjunct', 800, 660, 'wrap')];
  const frames = [{ ...frame('StageRecord', 'root', before, 'macro'), stage: 0 }, { ...frame('ExternalMerge', 'wrap', after), stage: 1 }];
  assert.deepEqual(replayMotionFaults({ frames }).filter(fault => fault.kind === 'attachment-site-motion'), [],
    'the new parent takes the carried row the host left');
});

test('a word that shifts under a stationary phrase is reported, whoever owns the step', () => {
  const before = [point('phrase', 0, 0), point('head', 0, 220, 'phrase'), point('word', 0, 440, 'head'), point('other', 600, 0)];
  const shifted = distance => before.map(item => item.id === 'word' ? { ...item, x: distance } : item);
  for (const distance of [20, 200]) {
    const faults = replayMotionFaults({ frames: [frame('Select', 'x', before), frame('Project', 'phrase', shifted(distance))] });
    assert.deepEqual(faults.map(fault => [fault.node, fault.kind, fault.distance]), [['word', 'shape-motion', distance]]);
  }
  const grown = [...before, point('second', 300, 440, 'head')].map(item => ['head', 'phrase'].includes(item.id) ? { ...item, x: 150 } : item);
  assert.deepEqual(replayMotionFaults({ frames: [frame('Select', 'x', before), frame('Project', 'second', grown)] })
    .filter(fault => fault.kind === 'shape-motion'), [], 'a parent recentring over a new child is not deformation');
  const recentred = before.map(item => item.id === 'phrase' ? { ...item, x: 140 } : item);
  assert.deepEqual(replayMotionFaults({ frames: [frame('Select', 'x', before), frame('Project', 'x', recentred)] })
    .filter(fault => fault.kind === 'shape-motion'), [], 'a parent that recentres alone does not deform its still child');
});

// Defects 19–21 (open): GPT-6.1 Sol, 我昨天看见的那个人走了。 Select T jumps 我 and 昨天
// (frame 16), T + v moves the retained vP a row (17), and D + Top pulls 我 across
// the tree (47). Stage 0 borrows the stage-2 tree, while stage 1 lays its waiting
// roots out beside its own clause. Aligning stage frames removes the first three
// jumps, but it lengthens 昨天's remaining jumps at frames 16 and 44, and holding
// 昨天 at its stage-1 slot widens stage 0. This test pins the open faults; a fix
// must make it fail before it is updated.
const waitingRoots = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/waiting-root-continuity.json', import.meta.url)));
for (const [width, height] of [[1440, 900], [390, 844]]) test(`${width}px: open defects 19–21 — the rule reports the waiting-root jumps of the historical record`, () => {
  const authored = JSON.stringify(waitingRoots);
  const { playbackSteps: steps } = prepareReplay({ ...waitingRoots, includePlayback: true });
  const { scenes } = layoutReplayFrames({ steps, stages: waitingRoots.derivationStages, width, height,
    direction: 'ltr' }, { coordinates, camera, layout, display, d3 });
  const faults = replayMotionFaults({ frames: scenes.map(scene => motionFrame(scene.step, scene.nodes, display.getNodeId)) });
  assert.deepEqual(faults.filter(fault => fault.kind !== 'shape-motion').map(fault => `${fault.frame}:${fault.node}:${fault.kind}:${Math.round(fault.distance)}`), [
    '16:topic:unowned-motion:975', '16:yesterday:unowned-motion:2418', '17:relativePredicate:attachment-site-motion:247',
    '44:le:unowned-motion:316', '44:leave:unowned-motion:1821', '44:matrixT:unowned-motion:1296', '44:topic:unowned-motion:2912',
    '44:yesterday:unowned-motion:4726', '47:topic:attachment-site-motion:975']);
  assert.equal(JSON.stringify(waitingRoots), authored);
});

