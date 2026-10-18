import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import * as d3 from '../node_modules/d3/src/index.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import * as coordinates from '../replay/stageCoordinates.ts';
import * as camera from '../replay/stageCamera.ts';
import * as layout from '../replay/treeLayout.ts';
import * as display from '../replay/displayIdentity.ts';
import { workspaceContinuityReflows } from '../replay/workspaceShapeReflows.ts';
import { layoutReplayFrames } from '../scripts/replayFrameLayout.mjs';
import { paintedPoints, replayMotionFaults } from '../scripts/replayMotionContinuity.mjs';

const point = (id, x, y, parent = null) => ({ id, x, y, parent });
const frame = (operation, target, points, kind = 'micro') => ({ kind, operation, target, points });
const kinds = faults => faults.map(({ frame, node, kind }) => `${frame}:${node}:${kind}`);

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

test('unowned motion keeps the witnesses of the ownership detector and adds their distance', () => {
  const frames = [frame('LexicalSelect', 'a', [point('a', 0, 0), point('b', 500, 0)]),
    frame('LexicalSelect', 'c', [point('a', 0, 0), point('b', 900, 300), point('c', 200, 0)])];
  const continuity = [{ index: 1, rootId: 'b', kind: 'unowned-component-motion' },
    { index: 1, rootId: 'a', kind: 'unchanged-subtree-shape' }];
  const faults = replayMotionFaults({ frames, continuity });
  assert.deepEqual(kinds(faults), ['2:b:unowned-motion']);
  assert.equal(faults[0].distance, 500);
});

// Defects 19–21: GPT-6.1 Sol, 我昨天看见的那个人走了。 Stage 0 reserves the waiting 我 and
// 昨天 at their stage-2 attachment rows; stage 1 cannot borrow that tree and lays
// them out beside its clause. Select T jumps both, the retained vP then moves at
// T + v, and 我 waits at its stage-1 slot until D + Top pulls it across.
const waitingRoots = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/waiting-root-continuity.json', import.meta.url)));
for (const [width, height] of [[1440, 900], [390, 844]]) test(`${width}px: the rule reports the waiting-root jumps of the historical record`, () => {
  const authored = JSON.stringify(waitingRoots);
  const { playbackSteps: steps } = prepareReplay({ ...waitingRoots, includePlayback: true });
  const { scenes, positions, render } = layoutReplayFrames({ steps, stages: waitingRoots.derivationStages, width, height,
    direction: 'ltr' }, { coordinates, camera, layout, display, d3 });
  const frames = scenes.map(scene => ({ kind: scene.step.replayKind, operation: scene.step.operation,
    target: scene.step.targetNodeId, points: paintedPoints(scene.nodes, display.getNodeId) }));
  const faults = replayMotionFaults({ frames, continuity: workspaceContinuityReflows(scenes, positions, render) });
  const at = (frameNumber, node) => faults.find(fault => fault.frame === frameNumber && fault.node === node);
  assert.equal(frames[15].operation, 'LexicalSelect');
  assert.equal(at(16, 'topic')?.kind, 'unowned-motion');
  assert.equal(at(16, 'yesterday')?.kind, 'unowned-motion');
  assert.deepEqual([at(17, 'relativePredicate')?.kind, at(17, 'relativePredicate')?.waiting], ['attachment-site-motion', true]);
  assert(at(17, 'relativePredicate').distance > 200, 'the vP moves a whole row when T joins it');
  assert.deepEqual([at(47, 'topic')?.kind, at(47, 'topic')?.waiting], ['attachment-site-motion', true]);
  assert(at(47, 'topic').distance > 900, '我 crosses most of the tree to reach its merge');
  assert.equal(JSON.stringify(waitingRoots), authored);
});
