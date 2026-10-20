import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import * as d3 from '../node_modules/d3/src/index.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import * as coordinates from '../replay/stageCoordinates.ts';
import { alignedStageFrames } from '../replay/stageCoordinates.ts';
import * as camera from '../replay/stageCamera.ts';
import * as layout from '../replay/treeLayout.ts';
import * as display from '../replay/displayIdentity.ts';
import { layoutReplayFrames } from '../scripts/replayFrameLayout.mjs';
import { motionFrame, replayMotionFaults } from '../scripts/replayMotionContinuity.mjs';
import { carryCamera } from '../components/treeViewport.ts';
import { directionsFor } from './helpers/rtlMirror.mjs';

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

// Defects 19–21: GPT-6.1 Sol, 我昨天看见的那个人走了。 Select T jumped 我 and 昨天 (frame
// 16), T + v moved the waiting vP a row (17), the stage-2 subject movement moved 我
// and 昨天 across the clause (44), and D + Top pulled 我 across the tree (now 48). Each
// waiting piece now stands where it attaches from its first frame; 昨天, which
// attaches under the T its own External Merge inserts above matrixTP (frame 46),
// waits beside that host and descends with it. At 44 the subject movement also
// brings T′, which takes 了's clause up a row; 了 rides with it and still slides
// sideways into the raised subject's gap, a stage-crossing slide Francis accepted.
const waitingRoots = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/waiting-root-continuity.json', import.meta.url)));
// Right to left this runs only for a record whose layout is not the reflection of
// its left-to-right layout (tests/helpers/rtlMirror.mjs).
for (const [width, height] of [[1440, 900], [390, 844]]) for (const direction of directionsFor('replay-regressions/waiting-root-continuity.json#')) {
  test(`${width}px ${direction}: defects 19–21 — 我 and 昨天 keep their place in the tree from their first frame`, () => {
    const authored = JSON.stringify(waitingRoots);
    const { playbackSteps: steps } = prepareReplay({ ...waitingRoots, includePlayback: true });
    const { scenes } = layoutReplayFrames({ steps, stages: waitingRoots.derivationStages, width, height, direction },
      { coordinates, camera, layout, display, d3 });
    const frames = scenes.map(scene => motionFrame(scene.step, scene.nodes, display.getNodeId));
    const faults = replayMotionFaults({ frames });
    const pieces = ['topic', 'topic::__leaf', 'yesterday', 'yesterday::__leaf'];
    assert.deepEqual(faults.filter(fault => pieces.includes(fault.node) || [16, 17, 48].includes(fault.frame)), []);
    // The camera carry is the only motion a stage crossing may show for them; at
    // its own merge under the inserted T, 昨天 descends with its host matrixTP.
    const painted = frame => new Map(frame.points.map(item => [item.id, { x: item.x, y: item.y, parentId: item.parent }]));
    for (let index = 1; index < frames.length; index++) {
      const crossing = frames[index].stage !== frames[index - 1].stage;
      const carry = crossing ? carryCamera({ x: 0, y: 0, k: 1 }, painted(frames[index - 1]), painted(frames[index])) : { x: 0, y: 0 };
      for (const id of pieces) {
        const before = frames[index - 1].points.find(item => item.id === id), after = frames[index].points.find(item => item.id === id);
        if (!before || !after) continue;
        const host = { before: frames[index - 1].points.find(item => item.id === 'matrixTP'), after: frames[index].points.find(item => item.id === 'matrixTP') };
        const own = frames[index].points.find(item => item.id === 'yesterday'), prior = frames[index - 1].points.find(item => item.id === 'yesterday');
        const joins = id.startsWith('yesterday') && Boolean(own?.parent && !prior?.parent);
        const expected = joins ? { x: 0, y: host.after.y - host.before.y } : { x: 0, y: 0 };
        assert(Math.hypot(after.x + carry.x - before.x - expected.x, after.y + carry.y - before.y - expected.y) < 1e-6, `${id} moves at frame ${index + 1}`);
        if (joins) assert.equal(own.parent, 'timedMatrixTP');
      }
    }
    assert.deepEqual(faults.filter(fault => fault.kind !== 'shape-motion')
      .map(fault => `${fault.frame}:${fault.node}:${fault.kind}:${Math.round(fault.distance)}`), ['44:le:unowned-motion:541']);
    assert.equal(JSON.stringify(waitingRoots), authored);
  });
}

test('stage alignment offsets follow every later stage, not only the next stage size', () => {
  const sizesFor = (steps, extra) => {
    const groups = camera.buildStageLayoutGroups(steps, waitingRoots.derivationStages);
    const sizes = waitingRoots.derivationStages.map((_, stage) => camera.stageTreeLayoutSize(steps, stage, 1440, 900, groups));
    sizes[2] = [sizes[2][0] + extra, sizes[2][1]];
    return stage => sizes[stage];
  };
  const prepare = () => prepareReplay({ ...structuredClone(waitingRoots), includePlayback: true }).playbackSteps;
  const frames = (steps, sizeFor) => JSON.stringify([...alignedStageFrames(steps, 0, sizeFor(0), sizeFor)].map(([, points]) => [...points]));
  const reused = prepare();
  const narrow = frames(reused, sizesFor(reused, 0)), changed = frames(reused, sizesFor(reused, 600));
  assert.notEqual(changed, narrow, 'a wider final stage moves the earlier stages it anchors');
  const fresh = prepare();
  assert.equal(changed, frames(fresh, sizesFor(fresh, 600)), 'reused preparation matches a fresh one');
});
