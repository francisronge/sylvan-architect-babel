import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as d3 from 'd3';
import { canopyPlacesInReplayFrame, placeCanopy, selectCanopyReplayFrame } from '../components/renderer/frameTreeLayout.ts';
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

// The Canopy waits for the last Replay frame. A frame that cannot place it is
// a layout fault the view reports as Replay does; only an analysis without
// Replay is laid out fresh.
const mia = recordOf(REPRESENTATIVE['aliased and unary terminals']);
const desktop = viewports[0];
const canopyCanvas = (forest = mia.derivationStages.at(-1).workspaceForest) =>
  buildRenderableCommittedCanvasData(buildDerivationCanvasData(structuredClone(forest)));
const hierarchyOf = canvas => { const root = d3.hierarchy(structuredClone(canvas)); applyVizIds(root); return root; };
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
  const { visual, frame } = miaFrame(), canvas = canopyCanvas();
  const places = canopyPlacesInReplayFrame(canvas, frame, visual.direction);
  assert(places, 'leaf_mia and leaf_laughed are found through their aliases');
  const placed = placeCanopy(hierarchyOf(canvas), places);
  assert(placed.descendants().every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
});

test('a last frame that does not show the Canopy\'s syntax exactly cannot place it', () => {
  const { visual, frame } = miaFrame();
  const forest = mia.derivationStages.at(-1).workspaceForest;
  const extra = structuredClone(forest);
  extra[0].children.push({ id: 'unknown', label: 'AdvP', children: [] });
  assert.equal(canopyPlacesInReplayFrame(canopyCanvas(extra), frame, visual.direction), null, 'a node the frame lacks');
  const moved = structuredClone(forest);
  const [subject, tbar] = moved[0].children;
  moved[0].children = [tbar];
  tbar.children.push(subject);
  assert.equal(canopyPlacesInReplayFrame(canopyCanvas(moved), frame, visual.direction), null, 'a node under another parent');
  const hidden = { ...frame, visibleIds: new Set([...frame.visibleIds].filter(id => id !== 'vp_laughed')) };
  assert.equal(canopyPlacesInReplayFrame(canopyCanvas(), hidden, visual.direction), null, 'a node the frame does not show');
  const places = canopyPlacesInReplayFrame(canopyCanvas(), frame, visual.direction);
  assert.throws(() => placeCanopy(hierarchyOf(canopyCanvas(extra)), places), /no place for unknown/u,
    'places belong to the canvas they were made for');
});

test('the view reports a Canopy layout fault as Replay does and lays out fresh only without Replay', () => {
  const frame = readFileSync(new URL('../components/renderer/treeFrame.ts', import.meta.url), 'utf8');
  assert.match(frame, /!animated && canopyPlaces \? placeCanopy\(rootHierarchy, canopyPlaces\)/u);
  assert.match(frame, /canopyTree \?\? treeLayout\(rootHierarchy\)/u);
  assert.doesNotMatch(frame, /alignReplayUnaryTerminalLeaves/u, 'unary alignment belongs to layoutReplayFrameTree');
  const visualizer = readFileSync(new URL('../components/TreeVisualizer.tsx', import.meta.url), 'utf8');
  assert.match(visualizer, /const canopyFollowsReplay = !animated && hasDerivationFrames && /u, 'only an analysis without Replay is fresh');
  assert.match(visualizer, /canopyPlacesInReplayFrame\(canvasData, frame, treeDirection,/u);
  assert.match(visualizer, /: canopyFollowsReplay && !canopyPlaces\)\);/u, 'an unplaced Canopy is the missing-coordinates fault');
  assert.match(visualizer, /const layoutReady = settledFontText === fontText && dimensions\.width > 0 && plaqueLayoutReady && !missingReplayCoordinates;/u,
    'a layout error keeps the cover with its Retry');
  assert.match(visualizer, /\{plaqueLayoutError \|\| missingReplayCoordinates \? <div role="alert"/u);
  assert.doesNotMatch(visualizer, /console\.warn/u);
  assert.match(visualizer, /includePlayback: true/u);
  assert.match(readFileSync(new URL('../components/AsyncTreeVisualizer.tsx', import.meta.url), 'utf8'), /includePlayback: true/u);
});
