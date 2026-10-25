import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as d3 from 'd3';
import { placeCanopyAtReplayFrame, selectCanopyReplayFrame } from '../components/renderer/frameTreeLayout.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { buildDerivationCanvasData, buildRenderableCommittedCanvasData, indexHierarchyNodesByIdAndAliases } from '../replay/replayCanvas.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { layoutCanopyVisualFrame, layoutMeasuredScenes, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';

// The Canopy is the last Replay frame without its relation marks: the same
// syntax at the same places. Only the camera may differ, because the Canopy
// fits its syntax alone; in tree units the two agree up to one translation.
const viewports = VIEWPORTS.filter(({ name }) => name === 'desktop' || name === 'mobile');

/** Each place where the Canopy differs from the last Replay frame, beyond one translation. */
function canopyDifferences(visual, viewport) {
  const last = layoutMeasuredScenes(visual, viewport).scenes.at(-1);
  const canopy = layoutCanopyVisualFrame(visual, viewport);
  if (!last || !canopy) return [`${viewport.name}: ${last ? 'no Canopy' : 'no Replay frame'}`];
  const frameNodes = indexHierarchyNodesByIdAndAliases([...last.nodes.values()]);
  const differences = [], seen = new Set();
  let offset;
  assert(canopy.painted, 'the Canopy frame records its painted syntax');
  for (const [id, point] of canopy.painted) {
    const node = frameNodes.get(id);
    if (!node) { differences.push(`${viewport.name}: ${id} is not in the last Replay frame`); continue; }
    seen.add(getNodeId(node));
    offset ??= { x: point.x - node.x, y: point.y - node.y };
    const dx = point.x - node.x - offset.x, dy = point.y - node.y - offset.y;
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01)
      differences.push(`${viewport.name}: ${id} is ${dx.toFixed(2)}, ${dy.toFixed(2)} from its last-frame place`);
  }
  for (const id of last.nodes.keys()) {
    if (!seen.has(id)) differences.push(`${viewport.name}: the Canopy does not paint ${id}`);
  }
  return differences;
}

test('the Canopy lays out every fixture analysis as its last Replay frame', () => {
  const { records } = loadFixtureAnalyses();
  assert(records.length > 100, 'the committed fixture corpus is loaded');
  const failures = [];
  for (const { id, record } of records) {
    const visual = prepareVisualRecord(record);
    if (!visual.prepared.playbackSteps.length) continue;
    const differences = viewports.flatMap(viewport => canopyDifferences(visual, viewport));
    if (differences.length) failures.push(`${id}\n    ${differences.slice(0, 3).join('\n    ')}`
      + (differences.length > 3 ? `\n    … ${differences.length - 3} more` : ''));
  }
  assert.equal(failures.length, 0, `${failures.length} of ${records.length} analyses:\n${failures.slice(0, 12).join('\n')}`);
});

// Fallbacks: the Canopy is laid out fresh when there is no last Replay frame,
// when its reservation is not prepared, or when that frame does not show the
// Canopy's syntax exactly.
const mia = loadFixtureAnalyses().records.find(entry => entry.id === 'normalized/mia-laughed.xbar.json#/analyses/0').record;
const desktop = VIEWPORTS.find(({ name }) => name === 'desktop');
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
