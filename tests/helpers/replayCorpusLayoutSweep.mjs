/** The layout sweep of tests/replayCorpusLayoutPart*.test.mjs. Every committed
 * analysis is laid out in each reading direction with the unmeasured Replay
 * layout of scripts/replayFrameLayout.mjs, which the layout continuity tests
 * check. The contour sweep reads the left-to-right plans. The mirror check
 * compares every right-to-left frame with the left-to-right one, so a continuity
 * check that runs left to right also holds right to left wherever the mirror
 * holds; tests/helpers/rtlMirror.mjs lists where it does not.
 *
 * The analyses are split into LAYOUT_SWEEP_PARTS parts, one test file each, so
 * the test runner and CI shards spread them out. Every analysis belongs to
 * exactly one part, and each part judges its own analyses; part 1 also judges
 * listed analyses that no longer exist. */
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import test, { before } from 'node:test';
import * as d3 from 'd3';

import * as display from '../../replay/displayIdentity.ts';
import { prepareReplay } from '../../replay/prepareReplay.ts';
import * as camera from '../../replay/stageCamera.ts';
import * as coordinates from '../../replay/stageCoordinates.ts';
import * as layout from '../../replay/treeLayout.ts';
import { TREE_ROW_HEIGHT } from '../../replay/treeSpacing.ts';
import { layoutReplayFrames } from '../../scripts/replayFrameLayout.mjs';
import { loadFixtureAnalyses } from './replayInvariantCorpus.mjs';
import { MIRROR_EXCEPTIONS } from './rtlMirror.mjs';

export const LAYOUT_SWEEP_PARTS = 4;
const partFile = part => `replayCorpusLayoutPart${part}.test.mjs`;
const TESTS = new URL('../', import.meta.url);

// The analyses whose contour plans are repaired, as their established layout.
const REPAIRED = ['replay-regressions/diverse-recovery.json#/examples/5/analysis',
  'replay-regressions/es-wh-phase-edge-contour.json#', 'replay-regressions/hi-correlative-landing-contour.json#'];

// The viewports at which the continuity tests lay out committed analyses.
// Stage sizes do not depend on the viewport today, so each record is laid out
// once per direction; a record whose sizes come to differ between these
// viewports is also laid out, and mirrored, at each distinct one.
const VIEWPORTS = [[1600, 948], [1600, 1100], [1596, 1016], [1440, 900], [1408, 680], [390, 844], [386, 698]];
const modules = { coordinates, camera, layout, display, d3 };

// Each layout prepares its own Replay, as each continuity test does, so no
// plan cached for one direction can stand in for the other.
const prepare = record => prepareReplay({ ...structuredClone(record), includePlayback: true }).playbackSteps;
const frames = (steps, record, [width, height], direction) =>
  layoutReplayFrames({ steps, stages: record.derivationStages, width, height, direction }, modules);

/** One record's off-grid rows, contour plan statuses and mirror deviations. */
export function sweepRecord({ id, record }) {
  const steps = prepare(record), groups = camera.buildStageLayoutGroups(steps, record.derivationStages);
  const viewports = new Map();
  for (const viewport of VIEWPORTS) {
    const key = JSON.stringify(record.derivationStages.map((_, stage) => camera.stageTreeLayoutSize(steps, stage, ...viewport, groups)));
    if (!viewports.has(key)) viewports.set(key, viewport);
  }
  const [first, ...others] = viewports.values(), ltr = frames(steps, record, first, 'ltr');
  // The contour check matches rows by their y; it relies on the shared row grid.
  const offGrid = steps.flatMap(step => (step.replayVisibleNodeIds ?? []).flatMap(node => {
    const y = ltr.positions.get(step.replayCanvasData)?.get(node)?.y;
    return y !== undefined && Math.abs(y / TREE_ROW_HEIGHT - Math.round(y / TREE_ROW_HEIGHT)) >= 1e-9 ? [`${id}: ${node} at y=${y}`] : [];
  }));
  const statuses = coordinates.getContourPlanStatuses(steps);
  const deviations = [[first, ltr], ...others.map(viewport => [viewport, frames(prepare(record), record, viewport, 'ltr')])]
    .flatMap(([viewport, left]) => {
      const deviation = mirrorDeviation(left.scenes, frames(prepare(record), record, viewport, 'rtl').scenes);
      return deviation ? [{ viewport, ...deviation }] : [];
    });
  return { id, offGrid, statuses, deviations };
}

/** How a right-to-left Replay departs from the reflection of its left-to-right
 * Replay, or null. Reflected, every frame paints the same syntax on the same
 * rows, and x_ltr + x_rtl is one axis across the whole Replay. Kinds:
 * - `not-mirrored`: a frame paints other syntax, another row, or a reflection
 *   about more than one axis;
 * - `frame-axis`: frames of one stage are reflected about different axes, so
 *   syntax moves in one direction where it stays in the other;
 * - `stage-axis`: each stage is reflected about its own axis, so at a stage
 *   boundary the right-to-left drawing translates against the left-to-right one. */
function mirrorDeviation(ltr, rtl) {
  const axes = new Map();
  for (const [index, { step, nodes: left }] of ltr.entries()) {
    const stage = step.replayFrameIndex, right = rtl[index].nodes;
    const frame = index + 1, deviation = detail => ({ kind: 'not-mirrored', frame, detail });
    const missing = [...left.keys()].filter(id => !right.has(id)), extra = [...right.keys()].filter(id => !left.has(id));
    if (missing.length || extra.length) return deviation(`paints [${missing}] only left to right and [${extra}] only right to left`);
    for (const [id, node] of left) {
      const mirror = right.get(id), axis = node.x + mirror.x;
      if (Math.abs(node.y - mirror.y) > 1e-6) return deviation(`${id} is at y ${mirror.y}, not ${node.y}`);
      if (!axes.has(stage)) axes.set(stage, { axis, frame, id });
      const first = axes.get(stage);
      if (Math.abs(axis - first.axis) <= 1e-6) continue;
      return first.frame === frame ? deviation(`${id} reflects about ${axis}, ${first.id} about ${first.axis}`)
        : { kind: 'frame-axis', frame, detail: `stage ${stage + 1} reflects about ${axis} at ${id}, about ${first.axis} at frame ${first.frame}` };
    }
  }
  const distinct = new Set([...axes.values()].map(({ axis }) => axis.toFixed(6)));
  return distinct.size > 1 ? { kind: 'stage-axis', frame: null,
    detail: `stage axes ${[...axes].map(([stage, { axis }]) => `${stage + 1}:${axis}`).join(' ')}` } : null;
}

/** The part (1-based) of each record: heaviest first by syntax nodes over its
 * stages, each to the part with the least so far, ties to the lower part. */
export function layoutSweepParts(records, parts = LAYOUT_SWEEP_PARTS) {
  const cost = ({ record }) => {
    let nodes = 0;
    const visit = node => { nodes++; (node.children ?? []).forEach(visit); };
    for (const stage of record.derivationStages) stage.workspaceForest.forEach(visit);
    return nodes;
  };
  const costs = records.map(cost), load = new Array(parts).fill(0), assigned = new Array(records.length);
  const order = records.map((_, index) => index).sort((a, b) => costs[b] - costs[a] || a - b);
  for (const index of order) {
    const lightest = load.indexOf(Math.min(...load));
    load[lightest] += costs[index];
    assigned[index] = lightest + 1;
  }
  return assigned;
}

/** Defines part `part`'s tests. */
export function defineLayoutSweepTests(part) {
  let records, own, sweep;
  before(() => {
    records = loadFixtureAnalyses().records;
    const parts = layoutSweepParts(records);
    own = new Set(records.filter((_, index) => parts[index] === part).map(({ id }) => id));
    sweep = records.filter(({ id }) => own.has(id)).map(sweepRecord);
  });
  const recordOf = key => key.slice(0, key.indexOf(' '));

  test(`the layout sweep has ${LAYOUT_SWEEP_PARTS} parts, one file each, and part ${part} sweeps its analyses`, () => {
    const files = readdirSync(TESTS).filter(file => /^replayCorpusLayoutPart\d+\.test\.mjs$/.test(file)).sort();
    assert.deepEqual(files, Array.from({ length: LAYOUT_SWEEP_PARTS }, (_, index) => partFile(index + 1)).sort());
    assert.ok(existsSync(new URL(partFile(part), TESTS)) && own.size > 0);
    const parts = layoutSweepParts(records);
    assert.ok(parts.every(value => Number.isInteger(value) && value >= 1 && value <= LAYOUT_SWEEP_PARTS));
  });

  test(`no committed fixture is left with interleaved sister contours (part ${part})`, () => {
    assert.deepEqual(sweep.flatMap(entry => entry.offGrid), []);
    assert.deepEqual(sweep.filter(entry => entry.statuses.includes('unresolved')).map(entry => entry.id), []);
    assert.deepEqual(sweep.filter(entry => !entry.statuses.includes('unresolved') && entry.statuses.includes('repaired'))
      .map(entry => entry.id).sort(), REPAIRED.filter(id => own.has(id)).sort(),
    'a newly repaired fixture changes its established layout; review it and list it in REPAIRED');
    if (part === 1) assert.deepEqual(REPAIRED.filter(id => !records.some(record => record.id === id)), [],
      'listed repaired analyses that no longer exist');
  });

  test(`right-to-left Replay is the reflection of left-to-right on every frame of every committed analysis (part ${part})`, () => {
    const found = sweep.flatMap(entry => entry.deviations.map(deviation => ({ id: entry.id, ...deviation })));
    const key = ({ id, kind, frame }) => `${id} ${kind}${frame === null ? '' : ` frame ${frame}`}`;
    const keys = new Set(found.map(key));
    assert.deepEqual(found.filter(item => !MIRROR_EXCEPTIONS.has(key(item)))
      .map(item => `${key(item)} at ${item.viewport.join('x')}: ${item.detail}`),
    [], 'new right-to-left departures from the reflected left-to-right layout');
    const ids = new Set(records.map(({ id }) => id));
    assert.deepEqual([...MIRROR_EXCEPTIONS].filter(item => own.has(recordOf(item)) ? !keys.has(item)
      : part === 1 && !ids.has(recordOf(item))), [],
    'listed departures that no longer occur; remove them from tests/helpers/rtlMirror.mjs');
  });
}
