import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as d3 from 'd3';
import { placeCanopyAtReplayFrame, selectCanopyReplayFrame } from '../components/renderer/frameTreeLayout.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { buildDerivationCanvasData, buildRenderableCommittedCanvasData } from '../replay/replayCanvas.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { canopyFinalFrameFindings, compareCanopyToFinalFrame, layoutMeasuredScenes, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';

const corpus = loadFixtureAnalyses().records;
const recordOf = id => corpus.find(entry => entry.id === id).record;
const viewports = VIEWPORTS.filter(({ name }) => name === 'desktop' || name === 'mobile');

// The camera audit (verify:camera-offline, verify:replay-offline) checks
// canopy-final-frame on every committed analysis at desktop and mobile. These
// cover its kinds of syntax here: terminals found through aliases, unary
// terminals, right-to-left order and several roots.
const REPRESENTATIVE = {
  'aliased and unary terminals': 'normalized/mia-laughed.xbar.json#/analyses/0',
  'aliases with movement': 'normalized/what-did-mia-see.xbar.json#/analyses/0',
  'right to left': 'showcase/agreement-and-case.json#/cases/0',
  'right to left with movement': 'replay-regressions/inserted-adjunction-segment.json#',
  'several roots': 'replay-regressions/pending-source-pronunciation.json#'
};
for (const [kind, id] of Object.entries(REPRESENTATIVE)) test(`the Canopy is the last Replay frame: ${kind}`, () => {
  const visual = prepareVisualRecord(recordOf(id));
  assert(visual.prepared.playbackSteps.length, `${id} has a Replay`);
  for (const viewport of viewports) assert.deepEqual(canopyFinalFrameFindings(visual, viewport), [], `${id} at ${viewport.name}`);
});

test('control: canopy-final-frame reports a moved, a missing and an unknown Canopy node', () => {
  const visual = prepareVisualRecord(recordOf(REPRESENTATIVE['aliased and unary terminals']));
  const desktop = viewports[0], frame = layoutMeasuredScenes(visual, desktop).scenes.at(-1).nodes;
  const canopy = [...frame.values()].map(node => Object.assign(Object.create(Object.getPrototypeOf(node)), node));
  assert.deepEqual(compareCanopyToFinalFrame(canopy.map(node => Object.assign(node, { x: node.x + 40, y: node.y - 3 })), frame), [],
    'one translation is the camera');
  const tbar = canopy.find(node => getNodeId(node) === 'tbar_1');
  tbar.x += 7;
  const found = compareCanopyToFinalFrame(canopy.filter(node => getNodeId(node) !== 'vp_laughed'), frame);
  assert.deepEqual(found.map(({ subtype, subject, measure }) => [subtype, subject, measure]),
    [['moved', 'tbar_1', 7], ['unpainted', 'vp_laughed', null]]);
  const unknown = Object.assign(Object.create(Object.getPrototypeOf(tbar)), tbar, { __vizId: 'unknown' });
  assert.equal(compareCanopyToFinalFrame([...canopy, unknown], frame).find(({ subtype }) => subtype === 'unmatched')?.subject, 'unknown');
});

// Fallbacks: the Canopy is laid out fresh when there is no last Replay frame,
// when its reservation is not prepared, or when that frame does not show the
// Canopy's syntax exactly.
const mia = recordOf(REPRESENTATIVE['aliased and unary terminals']);
const desktop = viewports[0];
const canopyRoot = (forest = mia.derivationStages.at(-1).workspaceForest) => {
  const root = d3.hierarchy(buildRenderableCommittedCanvasData(buildDerivationCanvasData(structuredClone(forest))));
  applyVizIds(root);
  return root;
};
const miaFrame = () => {
  const visual = prepareVisualRecord(mia), steps = visual.prepared.playbackSteps;
  const { coordinates, groups } = layoutMeasuredScenes(visual, desktop);
  return { visual, steps, coordinates, groups, frame: selectCanopyReplayFrame(steps, coordinates, desktop, groups) };
};

test('the Canopy reads the last Replay frame only when Replay has prepared it', () => {
  const { steps, coordinates, groups, frame } = miaFrame();
  assert(frame, 'a prepared Replay supplies its last frame');
  assert.equal(frame.canvas, steps.at(-1).replayCanvasData);
  assert.equal(selectCanopyReplayFrame([], coordinates, desktop, groups), null, 'an analysis without playback');
  assert.equal(selectCanopyReplayFrame(steps, undefined, desktop, groups), null, 'a layout still being prepared');
  const stage = steps.at(-1).replayFrameIndex;
  const otherCanvas = new Map([...coordinates].map(([index, stageCoordinates]) => [index,
    index === stage ? new Map() : stageCoordinates]));
  assert.equal(selectCanopyReplayFrame(steps, otherCanvas, desktop, groups), null, 'a layout without the last canvas');
});

test('the Canopy is placed through the aliases the last frame keeps for authored terminals', () => {
  const { visual, frame } = miaFrame();
  const placed = placeCanopyAtReplayFrame(canopyRoot(), frame, visual.direction);
  assert(placed, 'leaf_mia and leaf_laughed are found through their aliases');
  assert(placed.descendants().every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
});

test('a last frame that does not show the Canopy\'s syntax exactly leaves the Canopy to the fresh layout', () => {
  const { visual, frame } = miaFrame();
  const forest = mia.derivationStages.at(-1).workspaceForest;
  const unplaced = root => {
    assert.equal(placeCanopyAtReplayFrame(root, frame, visual.direction), null);
    assert(root.descendants().every(node => node.x === undefined), 'nothing is half placed');
  };
  const extra = structuredClone(forest);
  extra[0].children.push({ id: 'unknown', label: 'AdvP', children: [] });
  unplaced(canopyRoot(extra));
  const moved = structuredClone(forest);
  const [subject, tbar] = moved[0].children;
  moved[0].children = [tbar];
  tbar.children.push(subject);
  unplaced(canopyRoot(moved));
  const hidden = { ...frame, visibleIds: new Set([...frame.visibleIds].filter(id => id !== 'vp_laughed')) };
  assert.equal(placeCanopyAtReplayFrame(canopyRoot(), hidden, visual.direction), null, 'a node the frame does not show');
});

test('the renderer lays out the Canopy and Replay frames through the shared frame layout', () => {
  const frame = readFileSync(new URL('../components/renderer/treeFrame.ts', import.meta.url), 'utf8');
  assert.match(frame, /placeCanopyAtReplayFrame\(rootHierarchy, canopyReplayFrame,/u);
  assert.match(frame, /canopyTree \?\? treeLayout\(rootHierarchy\)/u, 'an unplaced Canopy keeps the fresh layout');
  assert.doesNotMatch(frame, /alignReplayUnaryTerminalLeaves/u, 'unary alignment belongs to layoutReplayFrameTree');
  const visualizer = readFileSync(new URL('../components/TreeVisualizer.tsx', import.meta.url), 'utf8');
  assert.match(visualizer, /selectCanopyReplayFrame\(layoutPlaybackSteps, replayCoordinates,/u);
  assert.match(visualizer, /includePlayback: true/u);
  assert.match(readFileSync(new URL('../components/AsyncTreeVisualizer.tsx', import.meta.url), 'utf8'), /includePlayback: true/u);
});
