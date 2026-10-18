import * as d3 from 'd3';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fitTreeCamera } from '../components/renderer/frameCamera.ts';
import { createCameraHarness } from './helpers/cameraHarness.mjs';
import { createSvgDom } from './helpers/svgDom.mjs';

const { Element, restore } = createSvgDom();
after(restore);

// Saved GPT-6.1 Sol/high geometry for 我昨天看见的那个人走了 (spelling A/B run, analysis 6),
// [x, y, parent], at Replay frame 43 (end of stage 2) and frame 44 (stage 3, matrix
// subject movement). The relative-clause subject is reattached under subjectHigher;
// 走 (leave) and 了 (le) keep their attachment but are laid out elsewhere.
const zh = {
  frame43: {
    "topic": [2148.75, 220, null], "matrixClause": [4087.03, 220, null], "yesterday": [5450.25, 220, null],
    "topic::__leaf": [2148.75, 440, "topic"], "matrixTP": [2837.81, 440, "matrixClause"],
    "le": [5336.25, 440, "matrixClause"], "yesterday::__leaf": [5450.25, 440, "yesterday"],
    "matrixT": [2486.25, 660, "matrixTP"], "matrixVP": [3189.38, 660, "matrixTP"],
    "le::__leaf": [5336.25, 660, "le"], "leave": [2486.25, 880, "matrixVP"],
    "subjectLower": [3892.5, 880, "matrixVP"], "leave::__leaf": [2486.25, 1100, "leave"],
    "relativeClause": [3105, 1100, "subjectLower"], "demonstrativeNominal": [4680, 1100, "subjectLower"],
    "relativeHigher": [2823.75, 1320, "relativeClause"], "relativeCProjection": [3386.25, 1320, "relativeClause"],
    "that": [4286.25, 1320, "demonstrativeNominal"], "classifierPhrase": [5073.75, 1320, "demonstrativeNominal"],
    "relativeTP": [3011.25, 1540, "relativeCProjection"], "relativeC": [3761.25, 1540, "relativeCProjection"],
    "that::__leaf": [4286.25, 1540, "that"], "classifier": [4811.25, 1540, "classifierPhrase"],
    "person": [5336.25, 1540, "classifierPhrase"], "relativeT": [2823.75, 1760, "relativeTP"],
    "relativePredicate": [3198.75, 1760, "relativeTP"], "relativeC::__leaf": [3761.25, 1760, "relativeC"],
    "classifier::__leaf": [4811.25, 1760, "classifier"], "person::__leaf": [5336.25, 1760, "person"],
    "relativeSubject": [3011.25, 1980, "relativePredicate"],
    "relativeLightProjection": [3386.25, 1980, "relativePredicate"],
    "relativeLightVerb": [3198.75, 2200, "relativeLightProjection"],
    "relativeVP": [3573.75, 2200, "relativeLightProjection"], "see": [3386.25, 2420, "relativeVP"],
    "relativeLower": [3761.25, 2420, "relativeVP"], "see::__leaf": [3386.25, 2640, "see"]
  },
  frame44: {
    "yesterday": [3648.75, 880, null], "topic": [2148.75, 220, null],
    "yesterday::__leaf": [3648.75, 1100, "yesterday"], "topic::__leaf": [2148.75, 440, "topic"],
    "matrixClause": [6597.19, 440, null], "matrixTP": [5795.62, 660, "matrixClause"],
    "le": [7398.75, 660, "matrixClause"], "subjectHigher": [4717.5, 880, "matrixTP"],
    "matrixT": [6161.25, 880, "matrixTP"], "matrixVP": [6873.75, 880, "matrixTP"],
    "le::__leaf": [7398.75, 880, "le"], "relativeClause": [3930, 1100, "subjectHigher"],
    "demonstrativeNominal": [5505, 1100, "subjectHigher"], "leave": [6686.25, 1100, "matrixVP"],
    "subjectLower": [7061.25, 1100, "matrixVP"], "relativeHigher": [3648.75, 1320, "relativeClause"],
    "relativeCProjection": [4211.25, 1320, "relativeClause"], "that": [5111.25, 1320, "demonstrativeNominal"],
    "classifierPhrase": [5898.75, 1320, "demonstrativeNominal"], "leave::__leaf": [6686.25, 1320, "leave"],
    "relativeTP": [3836.25, 1540, "relativeCProjection"], "relativeC": [4586.25, 1540, "relativeCProjection"],
    "that::__leaf": [5111.25, 1540, "that"], "classifier": [5636.25, 1540, "classifierPhrase"],
    "person": [6161.25, 1540, "classifierPhrase"], "relativeT": [3648.75, 1760, "relativeTP"],
    "relativePredicate": [4023.75, 1760, "relativeTP"], "relativeC::__leaf": [4586.25, 1760, "relativeC"],
    "classifier::__leaf": [5636.25, 1760, "classifier"], "person::__leaf": [6161.25, 1760, "person"],
    "relativeSubject": [3836.25, 1980, "relativePredicate"],
    "relativeLightProjection": [4211.25, 1980, "relativePredicate"],
    "relativeLightVerb": [4023.75, 2200, "relativeLightProjection"],
    "relativeVP": [4398.75, 2200, "relativeLightProjection"], "see": [4211.25, 2420, "relativeVP"],
    "relativeLower": [4586.25, 2420, "relativeVP"], "see::__leaf": [4211.25, 2640, "see"]
  }
};

const extent = frame => {
  const points = Object.values(frame);
  return { minX: Math.min(...points.map(([x]) => x)), maxX: Math.max(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)), maxY: Math.max(...points.map(([, y]) => y)) };
};
const glidingWords = ['leave', 'leave::__leaf', 'le', 'le::__leaf'];

/** Paints one Replay frame as treeFrame does: the previous draw's cleanup, fresh
 * node groups and branches, the camera fit, then arming the step's glide. */
function paint(harness, uiBounds, step, stage, frame, marks = []) {
  harness.run(() => harness.session.cameraRuntime.cancel?.());
  const g = harness.group;
  g.selectAll('*').remove();
  const nodes = Object.entries(frame).map(([id, [x, y]]) => ({ __vizId: id, x, y }));
  const byId = new Map(nodes.map(node => [node.__vizId, node]));
  nodes.forEach(node => { node.parent = byId.get(frame[node.__vizId][2]) ?? null; });
  g.selectAll('path.branch').data(nodes.filter(node => node.parent).map(node => ({ source: node.parent, target: node })))
    .enter().append('path').attr('class', 'branch')
    .attr('data-source-node-id', link => link.source.__vizId).attr('data-target-node-id', link => link.target.__vizId)
    .attr('d', d3.linkVertical().x(point => point.x).y(point => point.y));
  g.selectAll('.node-group').data(nodes).enter().append('g').attr('class', 'node-group')
    .attr('data-node-group-id', node => node.__vizId).attr('transform', node => `translate(${node.x},${node.y})`);
  for (const [name, ids] of marks) g.append('g').attr('class', `vr-item ${name}`).attr('data-vr-node-ids', JSON.stringify(ids));
  harness.session.activeStepIndex = step;
  harness.run(() => fitTreeCamera({ session: harness.session, layout: {
    relationRenderPlan: null, activeDerivationFrameIndex: stage, uiBounds,
    stageCameraBounds: extent(frame), stagePlaqueContainmentBounds: null, g,
    derivationFrameFitNodes: [{}], overlayFitBounds: null, visibleNodes: nodes
  } }));
  harness.session.cameraRuntime.glide?.arm();
}
const element = (harness, selector, test) => harness.group.node().querySelectorAll(selector).find(test);
const placed = (harness, id) => {
  const [x, y] = element(harness, '.node-group', node => node.getAttribute('data-node-group-id') === id)
    .getAttribute('transform').match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g).map(Number);
  return { x, y };
};
const camera = harness => harness.session.svgRef.current.__zoom;
const onScreen = (pose, { x, y }) => ({ x: pose.x + x * pose.k, y: pose.y + y * pose.k });
const at = ([x, y]) => ({ x, y });
const close = (actual, expected, message) =>
  assert(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-6, `${message}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);

for (const [width, height, uiBounds] of [[1440, 840, { headerBottom: 57, panelTop: 564, right: 16 }],
  [390, 844, { headerBottom: 72, panelTop: 585, right: 72 }]]) {
  const harnessFor = reducedMotion => createCameraHarness(Element, { width, height, data: zh, animated: true, reducedMotion });

  test(`${width}px: Next into the matrix subject movement glides 走 and 了 instead of snapping them`, () => {
    const harness = harnessFor(false);
    paint(harness, uiBounds, 42, 1, zh.frame43);
    const before = camera(harness);
    paint(harness, uiBounds, 43, 2, zh.frame44, [['theta', ['leave']], ['agreement', ['leave', 'topic']]]);
    const start = camera(harness);
    for (const id of glidingWords) {
      close(onScreen(start, placed(harness, id)), onScreen(before, at(zh.frame43[id])), `${id} first paints where frame 43 showed it`);
    }
    for (const id of ['person', 'subjectHigher']) {
      close(placed(harness, id), at(zh.frame44[id]), `${id} appears at its step, at its new place`);
    }
    const theta = element(harness, '.vr-item', mark => mark.classList.contains('theta'));
    const agreement = element(harness, '.vr-item', mark => mark.classList.contains('agreement'));
    const [dx, dy] = theta.getAttribute('transform').match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g).map(Number);
    close({ x: zh.frame44.leave[0] + dx, y: zh.frame44.leave[1] + dy }, placed(harness, 'leave'), 'the θ-grid moves with 走');
    assert.equal(agreement.style.getPropertyValue('visibility'), 'hidden', 'a mark between nodes that travel differently waits');

    harness.advance(180);
    for (const id of glidingWords) {
      const { x, y } = placed(harness, id), from = zh.frame44[id];
      const offset = { x: x - from[0], y: y - from[1] };
      assert(Math.hypot(offset.x, offset.y) > 1, `${id} is still on its way`);
    }
    harness.advance(360);
    for (const id of Object.keys(zh.frame44)) close(placed(harness, id), at(zh.frame44[id]), `${id} ends at the frame 44 layout`);
    const branch = element(harness, 'path.branch', path => path.getAttribute('data-target-node-id') === 'leave');
    assert.equal(branch.getAttribute('d'), d3.linkVertical()({ source: zh.frame44.matrixVP, target: zh.frame44.leave }));
    assert.equal(theta.getAttribute('transform'), null);
    assert.equal(agreement.style.getPropertyValue('visibility'), '');
    assert.equal(harness.frames.size, 0);
    assert.equal(harness.session.svgRef.current.getAttribute('data-babel-camera-settled-step'), '43');
  });

  test(`${width}px: Prev midway through the glide continues from the painted layout`, () => {
    const harness = harnessFor(false);
    paint(harness, uiBounds, 42, 1, zh.frame43);
    paint(harness, uiBounds, 43, 2, zh.frame44);
    harness.advance(180);
    const midway = Object.fromEntries(glidingWords.map(id => [id, onScreen(camera(harness), placed(harness, id))]));
    paint(harness, uiBounds, 42, 1, zh.frame43);
    assert.equal(harness.frames.size, 1, 'the interrupted animation is cancelled and one new one runs');
    for (const id of glidingWords) close(onScreen(camera(harness), placed(harness, id)), midway[id], `${id} starts Prev where it was painted`);
    harness.advance(360);
    for (const id of Object.keys(zh.frame43)) close(placed(harness, id), at(zh.frame43[id]), `${id} ends at the frame 43 layout`);
    assert.equal(harness.frames.size, 0);
  });

  test(`${width}px: reduced motion and direct selection change the layout at once`, () => {
    const reduced = harnessFor(true);
    paint(reduced, uiBounds, 42, 1, zh.frame43);
    paint(reduced, uiBounds, 43, 2, zh.frame44);
    for (const id of glidingWords) close(placed(reduced, id), at(zh.frame44[id]), `${id} under reduced motion`);
    const direct = harnessFor(false);
    paint(direct, uiBounds, 40, 1, zh.frame43);
    paint(direct, uiBounds, 43, 2, zh.frame44);
    for (const id of glidingWords) close(placed(direct, id), at(zh.frame44[id]), `${id} on direct selection`);
    assert.equal(direct.frames.size, 0);
  });

  test(`${width}px: a layout change glides even where the stage camera stays still`, () => {
    const harness = harnessFor(false);
    paint(harness, uiBounds, 43, 2, zh.frame44);
    const shifted = { ...zh.frame44, leave: [zh.frame44.leave[0] + 300, zh.frame44.leave[1], 'matrixVP'] };
    const pose = camera(harness);
    paint(harness, uiBounds, 44, 2, shifted);
    assert.deepEqual(camera(harness), pose, 'one camera for the stage');
    close(placed(harness, 'leave'), at(zh.frame44.leave), '走 starts where it was');
    harness.advance(360);
    close(placed(harness, 'leave'), at(shifted.leave), '走 ends at its new place');
    assert.equal(harness.frames.size, 0);
  });
}
